import { beforeEach, describe, expect, it } from 'vitest'
import { errorCode, errorMessage, isSessionExpired } from './errors'
import i18n from '@/i18n'
import pt from '@/i18n/locales/pt.json'
import en from '@/i18n/locales/en.json'

beforeEach(async () => {
  await i18n.changeLanguage('pt')
})

const t = ((...args: unknown[]) => i18n.t(...(args as [string]))) as never

describe('errorCode', () => {
  it('extrai o código de um Error vindo da API', () => {
    expect(errorCode(new Error('onedrive_not_connected'))).toBe('onedrive_not_connected')
  })

  it('aceita o código como string solta', () => {
    expect(errorCode('invalid_cnpj')).toBe('invalid_cnpj')
  })

  it.each([
    ['mensagem com espaços', new Error('Erro 500')],
    ['vazio', new Error('')],
    ['objeto qualquer', { algo: 1 }],
    ['nulo', null],
    ['indefinido', undefined]
  ])('devolve nulo para %s', (_rotulo, entrada) => {
    expect(errorCode(entrada)).toBeNull()
  })

  it('não confunde texto humano com código', () => {
    expect(errorCode(new Error('Não foi possível carregar'))).toBeNull()
  })
})

describe('errorMessage', () => {
  it('traduz o código conhecido para uma frase', () => {
    const msg = errorMessage(t, new Error('onedrive_not_connected'), 'manage.loadError')

    expect(msg).toContain('OneDrive')
    expect(msg).not.toContain('onedrive_not_connected')
  })

  it('usa a mensagem padrão para código desconhecido', () => {
    const msg = errorMessage(t, new Error('codigo_que_nao_existe'), 'manage.loadError')

    expect(msg).toBe(i18n.t('manage.loadError'))
  })

  it('usa a mensagem padrão quando não há código', () => {
    const msg = errorMessage(t, new Error('Erro 503'), 'manage.loadError')

    expect(msg).toBe(i18n.t('manage.loadError'))
  })

  it('nunca devolve a chave crua quando a tradução existe', () => {
    for (const codigo of Object.keys(pt.errors)) {
      const msg = errorMessage(t, new Error(codigo), 'manage.loadError')
      expect(msg).not.toContain('errors.')
      expect(msg.length).toBeGreaterThan(10)
    }
  })

  it('acompanha a troca de idioma', async () => {
    const emPortugues = errorMessage(t, new Error('invalid_cnpj'), 'manage.loadError')

    await i18n.changeLanguage('en')
    const emIngles = errorMessage(t, new Error('invalid_cnpj'), 'manage.loadError')

    expect(emIngles).not.toBe(emPortugues)
    expect(emIngles).toContain('CNPJ')
  })
})

describe('isSessionExpired', () => {
  it.each([['invalid_token'], ['missing_token']])('reconhece %s', (codigo) => {
    expect(isSessionExpired(new Error(codigo))).toBe(true)
  })

  it('não confunde com outros erros', () => {
    expect(isSessionExpired(new Error('forbidden'))).toBe(false)
    expect(isSessionExpired(new Error('Erro 500'))).toBe(false)
  })
})

describe('dicionário de erros', () => {
  it('tem as mesmas chaves em português e inglês', () => {
    expect(Object.keys(pt.errors).sort()).toEqual(Object.keys(en.errors).sort())
  })

  it('nenhuma mensagem está vazia', () => {
    for (const [idioma, dict] of [['pt', pt.errors], ['en', en.errors]] as const) {
      for (const [codigo, texto] of Object.entries(dict)) {
        expect(String(texto).trim(), `${idioma}.${codigo}`).not.toBe('')
      }
    }
  })

  it('nenhuma mensagem é apenas o código repetido', () => {
    for (const [codigo, texto] of Object.entries(pt.errors)) {
      expect(String(texto)).not.toBe(codigo)
    }
  })
})
