import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const PizZip = require('pizzip')
const template = require('../services/template.js')

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '</Types>'

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

function buildDocx(paragraphs) {
  const body = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join('')
  const document =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}</w:body></w:document>`

  const zip = new PizZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES)
  zip.folder('_rels').file('.rels', RELS)
  zip.folder('word').file('document.xml', document)
  return zip.generate({ type: 'nodebuffer' })
}

function documentXml(buffer) {
  return new PizZip(buffer).file('word/document.xml').asText()
}

describe('DELIMITERS', () => {
  it('usa chaves duplas', () => {
    expect(template.DELIMITERS).toEqual({ start: '{{', end: '}}' })
  })
})

describe('detectVariables', () => {
  it('lista as variáveis do documento em ordem alfabética', () => {
    const docx = buildDocx(['Contrato com {{nome}}', 'CNPJ {{cnpj}} em {{cidade}}'])
    expect(template.detectVariables(docx)).toEqual(['cidade', 'cnpj', 'nome'])
  })

  it('deduplica variável usada mais de uma vez', () => {
    const docx = buildDocx(['{{nome}}', 'Assinado por {{nome}}'])
    expect(template.detectVariables(docx)).toEqual(['nome'])
  })

  it('devolve lista vazia para documento sem variável', () => {
    expect(template.detectVariables(buildDocx(['Texto fixo sem marcação']))).toEqual([])
  })

  it('mantém tag com ponto como um nome só', () => {
    const docx = buildDocx(['{{empresa.nome}} inscrita sob {{empresa.cnpj}}'])
    expect(template.detectVariables(docx)).toEqual(['empresa.cnpj', 'empresa.nome'])
  })

  it('achata as variáveis de uma seção repetida em caminhos com ponto', () => {
    const docx = buildDocx(['Sócios:', '{{#socios}}{{nome}} - {{cpf}}{{/socios}}'])
    expect(template.detectVariables(docx)).toEqual(['socios.cpf', 'socios.nome'])
  })

  it('achata seção aninhada em mais de um nível', () => {
    const docx = buildDocx(['{{#empresa}}{{#socios}}{{nome}}{{/socios}}{{/empresa}}'])
    expect(template.detectVariables(docx)).toEqual(['empresa.socios.nome'])
  })

  it('rejeita buffer que não é um docx', () => {
    expect(() => template.detectVariables(Buffer.from('isto não é um zip'))).toThrow('invalid_docx')
  })

  it('rejeita buffer vazio com status 400', () => {
    try {
      template.detectVariables(Buffer.alloc(0))
      expect.unreachable()
    } catch (err) {
      expect(err.message).toBe('invalid_docx')
      expect(err.status).toBe(400)
    }
  })

  it('explica a tag não fechada em vez de vazar o erro do docxtemplater', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      template.detectVariables(buildDocx(['Contrato com {{nome']))
      expect.unreachable()
    } catch (err) {
      expect(err.message).toBe('invalid_template')
      expect(err.status).toBe(400)
      expect(err.details).toEqual([
        expect.objectContaining({ id: 'unclosed_tag', tag: '{nome' })
      ])
      expect(err.details[0].explanation).toContain('unclosed')
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('missingVariables', () => {
  it('aponta apenas as variáveis sem valor', () => {
    expect(template.missingVariables(['nome', 'cnpj'], { nome: 'ACME' })).toEqual(['cnpj'])
  })

  it('trata null, undefined e string em branco como ausentes', () => {
    const faltando = template.missingVariables(['a', 'b', 'c', 'd'], {
      a: null,
      b: undefined,
      c: '   ',
      d: ''
    })
    expect(faltando).toEqual(['a', 'b', 'c', 'd'])
  })

  it('considera zero e false como preenchidos', () => {
    expect(template.missingVariables(['zero', 'falso'], { zero: 0, falso: false })).toEqual([])
  })

  it('sem valores, tudo é ausente', () => {
    expect(template.missingVariables(['nome', 'cnpj'], undefined)).toEqual(['nome', 'cnpj'])
  })

  it('sem variáveis exigidas, nada é ausente', () => {
    expect(template.missingVariables([], { nome: 'ACME' })).toEqual([])
  })
})

describe('fillTemplate', () => {
  it('substitui todas as variáveis e não deixa delimitador no resultado', () => {
    const docx = buildDocx(['Contrato com {{nome}}, CNPJ {{cnpj}}'])
    const xml = documentXml(template.fillTemplate(docx, { nome: 'ACME LTDA', cnpj: '00.000.000/0001-00' }))

    expect(xml).toContain('ACME LTDA')
    expect(xml).toContain('00.000.000/0001-00')
    expect(xml).not.toContain('{{')
    expect(xml).not.toContain('}}')
  })

  it('devolve um docx que volta a abrir', () => {
    const out = template.fillTemplate(buildDocx(['{{nome}}']), { nome: 'ACME' })
    expect(Buffer.isBuffer(out)).toBe(true)
    expect(new PizZip(out).file('word/document.xml')).toBeTruthy()
  })

  it('preserva acentuação do valor', () => {
    const out = template.fillTemplate(buildDocx(['{{cidade}}']), { cidade: 'Jaraguá do Sul' })
    expect(documentXml(out)).toContain('Jaraguá do Sul')
  })

  it('escapa caractere de XML no valor, sem corromper o documento', () => {
    const out = template.fillTemplate(buildDocx(['{{nome}}']), { nome: 'A & B <tag>' })
    const xml = documentXml(out)

    expect(xml).not.toContain('<tag>')
    expect(xml).toContain('&lt;')
    expect(xml).toContain('&amp;')
    expect(new PizZip(out).file('word/document.xml')).toBeTruthy()
  })

  it('recusa geração com variável faltando e informa quais', () => {
    const docx = buildDocx(['{{nome}} {{cnpj}} {{cidade}}'])
    try {
      template.fillTemplate(docx, { nome: 'ACME' })
      expect.unreachable()
    } catch (err) {
      expect(err.message).toBe('missing_variables')
      expect(err.status).toBe(400)
      expect(err.details.missing).toEqual(['cidade', 'cnpj'])
    }
  })

  it('aceita valores extras que o template não usa', () => {
    const out = template.fillTemplate(buildDocx(['{{nome}}']), { nome: 'ACME', sobra: 'ignorado' })
    expect(documentXml(out)).toContain('ACME')
  })

  it('repete a seção para cada item do array', () => {
    const docx = buildDocx(['{{#socios}}{{nome}};{{/socios}}'])
    const out = template.fillTemplate(docx, {
      socios: [{ nome: 'Ana' }, { nome: 'Bia' }],
      'socios.nome': 'preenchido'
    })
    const xml = documentXml(out)

    expect(xml).toContain('Ana')
    expect(xml).toContain('Bia')
  })

  it('exige o caminho achatado da seção, além do array que a alimenta', () => {
    const docx = buildDocx(['{{#socios}}{{nome}}{{/socios}}'])
    try {
      template.fillTemplate(docx, { socios: [{ nome: 'Ana' }] })
      expect.unreachable()
    } catch (err) {
      expect(err.message).toBe('missing_variables')
      expect(err.details.missing).toEqual(['socios.nome'])
    }
  })

  it('gera documento sem variável sem exigir valores', () => {
    const out = template.fillTemplate(buildDocx(['Termo padrão']), {})
    expect(documentXml(out)).toContain('Termo padrão')
  })
})

describe('HttpError', () => {
  it('carrega status e detalhes', () => {
    const err = new template.HttpError(422, 'falhou', { campo: 'x' })
    expect(err).toBeInstanceOf(Error)
    expect(err.status).toBe(422)
    expect(err.message).toBe('falhou')
    expect(err.details).toEqual({ campo: 'x' })
  })

  it('omite details quando não informado', () => {
    expect(new template.HttpError(400, 'falhou').details).toBeUndefined()
  })
})
