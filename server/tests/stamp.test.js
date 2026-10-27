import { beforeAll, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { PDFDocument, PDFName } = require('pdf-lib')
const stamp = require('../services/stamp.js')

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PNG = fs.readFileSync(path.join(FIXTURES, 'stamp.png'))
const JPG = fs.readFileSync(path.join(FIXTURES, 'stamp.jpg'))

const POSICAO = { xFrac: 0.1, yFracTop: 0.1, widthFrac: 0.2 }

let pdfDuasPaginas

beforeAll(async () => {
  const pdf = await PDFDocument.create()
  pdf.addPage([600, 800])
  pdf.addPage([600, 800])
  pdfDuasPaginas = Buffer.from(await pdf.save())
})

async function paginasComImagem(buffer) {
  const pdf = await PDFDocument.load(buffer)
  return pdf
    .getPages()
    .map((page, i) => {
      const recursos = page.node.Resources()
      return recursos && recursos.get(PDFName.of('XObject')) ? i : -1
    })
    .filter((i) => i >= 0)
}

describe('stampImage', () => {
  it('devolve um PDF com a chancela aplicada', async () => {
    const out = await stamp.stampImage(pdfDuasPaginas, PNG, POSICAO)

    expect(Buffer.isBuffer(out)).toBe(true)
    expect(out.subarray(0, 4).toString()).toBe('%PDF')
    expect(out.length).toBeGreaterThan(pdfDuasPaginas.length)
  })

  it('preserva o número de páginas do documento', async () => {
    const out = await stamp.stampImage(pdfDuasPaginas, PNG, POSICAO)
    const pdf = await PDFDocument.load(out)
    expect(pdf.getPageCount()).toBe(2)
  })

  it('sem pageIndex, carimba a última página', async () => {
    const out = await stamp.stampImage(pdfDuasPaginas, PNG, POSICAO)
    expect(await paginasComImagem(out)).toEqual([1])
  })

  it('carimba a página indicada por pageIndex', async () => {
    const out = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, pageIndex: 0 })
    expect(await paginasComImagem(out)).toEqual([0])
  })

  it('aceita JPEG além de PNG', async () => {
    const out = await stamp.stampImage(pdfDuasPaginas, JPG, POSICAO)
    expect(out.subarray(0, 4).toString()).toBe('%PDF')
    expect(await paginasComImagem(out)).toEqual([1])
  })

  it('aceita buffer com offset interno, como os que o Node agrupa em pool', async () => {
    const pool = Buffer.concat([JPG])
    expect(pool.byteOffset).toBeGreaterThan(0)

    const out = await stamp.stampImage(pdfDuasPaginas, pool, POSICAO)
    expect(out.subarray(0, 4).toString()).toBe('%PDF')
  })

  it('é determinístico para a mesma entrada', async () => {
    const a = await stamp.stampImage(pdfDuasPaginas, PNG, POSICAO)
    const b = await stamp.stampImage(pdfDuasPaginas, PNG, POSICAO)
    expect(a.equals(b)).toBe(true)
  })
})

describe('limites das frações de posição', () => {
  it('fração acima de 1 é tratada como 1', async () => {
    const acima = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, xFrac: 5 })
    const limite = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, xFrac: 1 })
    expect(acima.equals(limite)).toBe(true)
  })

  it('fração negativa é tratada como 0', async () => {
    const negativa = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, xFrac: -3 })
    const zero = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, xFrac: 0 })
    expect(negativa.equals(zero)).toBe(true)
  })

  it('fração não numérica é tratada como 0', async () => {
    const texto = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, yFracTop: 'abc' })
    const zero = await stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, yFracTop: 0 })
    expect(texto.equals(zero)).toBe(true)
  })
})

describe('entradas inválidas', () => {
  it.each([
    ['GIF', Buffer.from('GIF89a')],
    ['PDF', Buffer.from('%PDF-1.7')],
    ['buffer curto', Buffer.from([0x89])],
    ['buffer vazio', Buffer.alloc(0)]
  ])('recusa imagem %s', async (_rotulo, imagem) => {
    await expect(stamp.stampImage(pdfDuasPaginas, imagem, POSICAO)).rejects.toMatchObject({
      code: 'invalid_image',
      status: 400
    })
  })

  it.each([
    ['além da última', 9],
    ['negativa', -1],
    ['fracionária', 1.5]
  ])('recusa página %s', async (_rotulo, pageIndex) => {
    await expect(
      stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, pageIndex })
    ).rejects.toMatchObject({ code: 'invalid_page', status: 400 })
  })

  it.each([
    ['zero', 0],
    ['negativa', -1],
    ['não numérica', 'abc']
  ])('recusa largura %s', async (_rotulo, widthFrac) => {
    await expect(
      stamp.stampImage(pdfDuasPaginas, PNG, { ...POSICAO, widthFrac })
    ).rejects.toMatchObject({ code: 'invalid_size', status: 400 })
  })

  it('recusa PDF ilegível', async () => {
    await expect(stamp.stampImage(Buffer.from('não é pdf'), PNG, POSICAO)).rejects.toThrow()
  })
})

describe('HttpError', () => {
  it('usa o código como mensagem', () => {
    const err = new stamp.HttpError(400, 'invalid_image')
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(400)
    expect(err.code).toBe('invalid_image')
    expect(err.message).toBe('invalid_image')
  })
})
