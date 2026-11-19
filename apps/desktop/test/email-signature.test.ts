// Contrato 54: a assinatura por conta. CA1 (no `settings.json`, ao lado das contas, e sai com a conta), CA2 (os pedidos
// do IPC) e CA3/CA5 (`withSignature`: escape de HTML, links, vazio, interruptores, sem duplicar, acima da citação).
// O rascunho com a assinatura (CA4) está em test/renderer/email-signature-draft.test.ts. Nenhuma rede.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createEmailService } from '../src/main/email/service'
import type { SafeStorageLike } from '../src/main/secrets'
import { createFileSettingsStore, SETTINGS_FILE } from '../src/main/settings/store'
import { DEFAULT_EMAIL_SIGNATURE, EMAIL_SIGNATURE_MAX, withSignature, type EmailSignature } from '../src/shared/email-signature'

const SIGNATURE: EmailSignature = { text: 'Andrew Pereira\nLAP Software', onNew: true, onReply: true }
const QUOTE = '\n\nEm qua., 19/11/2026 14:05, Marina <marina@cliente.example> escreveu:\n> Oi\n> Tudo certo?'

describe('withSignature (CA3, CA5)', () => {
  it('mensagem nova: depois do texto, com o separador "-- "', () => {
    expect(withSignature({ text: '', quote: '' }, SIGNATURE, 'new').text).toBe('\n\n-- \nAndrew Pereira\nLAP Software')
    expect(withSignature({ text: 'Olá', quote: '' }, SIGNATURE, 'new').text).toBe('Olá\n\n-- \nAndrew Pereira\nLAP Software')
  })

  it('resposta e encaminhamento: a assinatura fica acima da citação', () => {
    const { text, html } = withSignature({ text: '', quote: QUOTE }, SIGNATURE, 'reply')
    expect(text).toBe(`\n\n-- \nAndrew Pereira\nLAP Software${QUOTE}`)
    expect(text.indexOf('-- \n')).toBeLessThan(text.indexOf('escreveu:'))
    expect(html.indexOf('<div class="signature">')).toBeLessThan(html.indexOf('escreveu:'))
    expect(html).toContain('&gt; Oi<br>&gt; Tudo certo?')
    expect(withSignature({ text: '', quote: QUOTE }, SIGNATURE, 'forward').text).toBe(`\n\n-- \nAndrew Pereira\nLAP Software${QUOTE}`)
  })

  it('HTML: texto escapado (`<script>` vira texto) e quebras em <br>', () => {
    const { html } = withSignature({ text: '<b>oi</b>', quote: '' }, { ...SIGNATURE, text: '<script>alert("x")</script>\nA & B \'aspas\'' }, 'new')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>')
    expect(html).toContain('<div class="signature">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;<br>A &amp; B &#39;aspas&#39;</div>')
    expect(html.startsWith('&lt;b&gt;oi&lt;/b&gt;<br><br>-- <br>')).toBe(true)
  })

  it('links: http(s) e emails viram <a> com rel="noopener noreferrer"; pontuação final fica fora', () => {
    const text = 'Site: https://lap.com.br/contato?a=1&b=2.\nhttp://exemplo.com\nandrew@lap.com.br; javascript:alert(1)'
    const { html } = withSignature({ text: '', quote: '' }, { ...SIGNATURE, text }, 'new')
    expect(html).toContain('<a href="https://lap.com.br/contato?a=1&amp;b=2" rel="noopener noreferrer">https://lap.com.br/contato?a=1&amp;b=2</a>.')
    expect(html).toContain('<a href="http://exemplo.com" rel="noopener noreferrer">http://exemplo.com</a>')
    expect(html).toContain('<a href="mailto:andrew@lap.com.br" rel="noopener noreferrer">andrew@lap.com.br</a>;')
    expect(html).not.toContain('href="javascript')
    expect(html.match(/<a /g)).toHaveLength(3)
  })

  it('um link não abre atributo: aspas e < terminam o endereço', () => {
    const { html } = withSignature({ text: '', quote: '' }, { ...SIGNATURE, text: 'https://x.com/"onmouseover="alert(1)<img>' }, 'new')
    expect(html).toContain('<a href="https://x.com/" rel="noopener noreferrer">https://x.com/</a>&quot;onmouseover=&quot;alert(1)&lt;img&gt;')
  })

  it('assinatura vazia (ou só espaços): o corpo como veio', () => {
    for (const text of ['', '  \n\t ']) {
      expect(withSignature({ text: 'Olá', quote: QUOTE }, { ...SIGNATURE, text }, 'reply').text).toBe(`Olá${QUOTE}`)
      expect(withSignature({ text: 'Olá', quote: '' }, { ...SIGNATURE, text }, 'new').html).not.toContain('signature')
    }
  })

  it('interruptores: "em mensagens novas" vale para nova; "em respostas" para responder e encaminhar', () => {
    const offNew = { ...SIGNATURE, onNew: false }
    const offReply = { ...SIGNATURE, onReply: false }
    expect(withSignature({ text: '', quote: '' }, offNew, 'new').text).toBe('')
    expect(withSignature({ text: '', quote: QUOTE }, offNew, 'reply').text).toContain('-- \nAndrew')
    expect(withSignature({ text: '', quote: QUOTE }, offReply, 'reply').text).toBe(QUOTE)
    expect(withSignature({ text: '', quote: QUOTE }, offReply, 'forward').text).toBe(QUOTE)
    expect(withSignature({ text: '', quote: '' }, offReply, 'new').text).toContain('-- \nAndrew')
  })

  it('sem duplicar: a mesma assinatura já no texto não entra de novo', () => {
    const once = withSignature({ text: '', quote: QUOTE }, SIGNATURE, 'reply').text
    const again = withSignature({ text: once, quote: '' }, SIGNATURE, 'new').text
    expect(again).toBe(once)
    expect(again.split('-- \n')).toHaveLength(2)
    // A assinatura citada da mensagem do outro (com "> ") não conta como já presente.
    const quoted = `${QUOTE}\n> -- \n> Andrew Pereira\n> LAP Software`
    expect(withSignature({ text: '', quote: quoted }, SIGNATURE, 'reply').text).toBe(`\n\n-- \nAndrew Pereira\nLAP Software${quoted}`)
  })

  it('sem duplicar compara o bloco inteiro: uma assinatura que só começa igual não conta', () => {
    const short = { ...SIGNATURE, text: 'Andrew' }
    const long = withSignature({ text: '', quote: '' }, SIGNATURE, 'new').text
    expect(withSignature({ text: long, quote: '' }, short, 'new').text).toBe(`${long}\n\n-- \nAndrew`)
    // O bloco no meio de uma linha também não conta.
    expect(withSignature({ text: 'x-- \nAndrew', quote: '' }, short, 'new').text).toBe('x-- \nAndrew\n\n-- \nAndrew')
    // Inteiro, seguido de outra linha: conta.
    expect(withSignature({ text: '-- \nAndrew\nObrigado', quote: '' }, short, 'new').text).toBe('-- \nAndrew\nObrigado')
  })

  it('parênteses: o `)` do link só sai sem par (Wikipedia fica inteira)', () => {
    const text = 'https://pt.wikipedia.org/wiki/Foo_(bar)\n(veja https://lap.com.br)\nhttps://x.com/a_(b)).'
    const { html } = withSignature({ text: '', quote: '' }, { ...SIGNATURE, text }, 'new')
    expect(html).toContain('<a href="https://pt.wikipedia.org/wiki/Foo_(bar)" rel="noopener noreferrer">https://pt.wikipedia.org/wiki/Foo_(bar)</a><br>')
    expect(html).toContain('(veja <a href="https://lap.com.br" rel="noopener noreferrer">https://lap.com.br</a>)<br>')
    expect(html).toContain('<a href="https://x.com/a_(b)" rel="noopener noreferrer">https://x.com/a_(b)</a>).')
  })

  it('a parte local do email não leva `/`', () => {
    const { html } = withSignature({ text: '', quote: '' }, { ...SIGNATURE, text: 'Contato/andrew@lap.com.br' }, 'new')
    expect(html).toContain('Contato/<a href="mailto:andrew@lap.com.br" rel="noopener noreferrer">andrew@lap.com.br</a>')
  })

  it('CRLF vira LF e o fim da assinatura não leva espaços', () => {
    expect(withSignature({ text: '', quote: '' }, { ...SIGNATURE, text: 'Linha 1\r\nLinha 2\r\n\r\n' }, 'new').text).toBe('\n\n-- \nLinha 1\nLinha 2')
  })
})

const fakeSafeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from([...Buffer.from(plain, 'utf8')].reverse().map((byte) => byte ^ 0x5a)),
  decryptString: (sealed) => Buffer.from([...sealed].map((byte) => byte ^ 0x5a).reverse()).toString('utf8'),
}

const input = (address: string) => ({
  address,
  password: 'Senha-42!',
  incoming: { protocol: 'imap', host: 'imap.exemplo.com.br', port: 993, security: 'tls' },
  outgoing: { host: 'smtp.exemplo.com.br', port: 587, security: 'starttls' },
})

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'scribe-signature-'))
  const settings = createFileSettingsStore({ dir })
  const service = createEmailService({
    root: join(dir, 'email'),
    settings,
    safeStorage: fakeSafeStorage,
    fetch: () => Promise.reject(new Error('sem rede no teste')),
    // A conta não precisa conectar: a assinatura é só do settings.
    imap: () => Promise.reject(new Error('sem IMAP neste teste')),
    onStatus: () => undefined,
    onMessage: () => undefined,
    retryMs: 3_600_000,
  })
  cleanups.push(async () => {
    await service.dispose()
    rmSync(dir, { recursive: true, force: true })
  })
  const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8')) as Record<string, unknown>
  return { dir, settings, service, onDisk }
}

async function addAccount(service: ReturnType<typeof setup>['service'], address: string): Promise<string> {
  const added = await service.addAccount(input(address))
  if (!added.ok) throw new Error(`conta não entrou: ${added.error}`)
  return added.status.account.id
}

describe('assinatura no settings e no IPC (CA1, CA2)', () => {
  it('padrão: vazia e com os dois interruptores ligados', async () => {
    const { service } = setup()
    const id = await addAccount(service, 'ana@exemplo.com.br')
    expect(await service.signatureGet({ accountId: id })).toEqual({ ok: true, signature: { text: '', onNew: true, onReply: true } })
    expect(DEFAULT_EMAIL_SIGNATURE).toEqual({ text: '', onNew: true, onReply: true })
  })

  it('gravar e ler: fica no settings.json ao lado das contas, por id, e outra instância lê', async () => {
    const { dir, service, onDisk } = setup()
    const id = await addAccount(service, 'ana@exemplo.com.br')
    expect(await service.signatureSet({ accountId: id, signature: SIGNATURE })).toEqual({ ok: true, signature: SIGNATURE })
    expect(await service.signatureGet({ accountId: id })).toEqual({ ok: true, signature: SIGNATURE })
    expect(onDisk()['emailSignatures']).toEqual({ [id]: SIGNATURE })
    expect((onDisk()['settings'] as Record<string, unknown>)['emailSignatures']).toBeUndefined()
    expect(await createFileSettingsStore({ dir }).getEmailSignatures()).toEqual({ [id]: SIGNATURE })
  })

  it('zod estrito: texto acima de 2000, campo a mais, tipo errado e caractere de controle são recusados', async () => {
    const { service, settings } = setup()
    const id = await addAccount(service, 'ana@exemplo.com.br')
    const max = 'a'.repeat(EMAIL_SIGNATURE_MAX)
    expect((await service.signatureSet({ accountId: id, signature: { ...SIGNATURE, text: max } })).ok).toBe(true)
    for (const signature of [
      { ...SIGNATURE, text: `${max}a` },
      { ...SIGNATURE, extra: true },
      { ...SIGNATURE, onNew: 'sim' },
      { text: 'x', onNew: true },
      { ...SIGNATURE, text: 'a\u0000b' },
    ]) {
      expect(await service.signatureSet({ accountId: id, signature })).toEqual({ ok: false, error: 'invalid' })
    }
    expect(await service.signatureSet({ accountId: id, signature: SIGNATURE, outro: 1 })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.signatureGet({ accountId: id, outro: 1 })).toEqual({ ok: false, error: 'invalid' })
    expect(await service.signatureGet({ accountId: 'x' })).toEqual({ ok: false, error: 'invalid' })
    expect((await settings.getEmailSignatures())[id]?.text).toBe(max)
  })

  it('conta inexistente: `missing`, nada gravado', async () => {
    const { service, settings } = setup()
    const ghost = '0b8f5a52-6f6c-4f0e-9a51-6c1f0f7e9d10'
    expect(await service.signatureGet({ accountId: ghost })).toEqual({ ok: false, error: 'missing' })
    expect(await service.signatureSet({ accountId: ghost, signature: SIGNATURE })).toEqual({ ok: false, error: 'missing' })
    expect(await settings.setEmailSignature(ghost, SIGNATURE)).toBe(false)
    expect(await settings.getEmailSignatures()).toEqual({})
  })

  it('remover a conta remove a assinatura; a da outra conta fica', async () => {
    const { service, settings, onDisk } = setup()
    const ana = await addAccount(service, 'ana@exemplo.com.br')
    const bia = await addAccount(service, 'bia@exemplo.com.br')
    await service.signatureSet({ accountId: ana, signature: SIGNATURE })
    await service.signatureSet({ accountId: bia, signature: { ...SIGNATURE, text: 'Bia' } })
    expect(await service.removeAccount({ accountId: ana })).toBe(true)
    expect(await settings.getEmailSignatures()).toEqual({ [bia]: { ...SIGNATURE, text: 'Bia' } })
    expect(Object.keys(onDisk()['emailSignatures'] as object)).toEqual([bia])
    expect(await service.removeAccount({ accountId: bia })).toBe(true)
    expect(Object.keys(onDisk())).toEqual(['version', 'settings'])
  })

  it('falha do disco ao gravar ou ler: `storage`, não `invalid`', async () => {
    const { dir, service } = setup()
    const id = await addAccount(service, 'ana@exemplo.com.br')
    const real = createFileSettingsStore({ dir })
    const broken = createEmailService({
      root: join(dir, 'email'),
      settings: {
        get: () => real.get(),
        getEmailAccounts: () => real.getEmailAccounts(),
        setEmailAccounts: (accounts) => real.setEmailAccounts(accounts),
        getEmailSignatures: () => Promise.reject(new Error('EIO')),
        setEmailSignature: () => Promise.reject(new Error('ENOSPC')),
      },
      safeStorage: fakeSafeStorage,
      fetch: () => Promise.reject(new Error('sem rede no teste')),
      imap: () => Promise.reject(new Error('sem IMAP neste teste')),
      onStatus: () => undefined,
      onMessage: () => undefined,
      retryMs: 3_600_000,
    })
    cleanups.push(() => broken.dispose())
    await broken.init()
    expect(broken.accounts().map((status) => status.account.id)).toEqual([id])
    expect(await broken.signatureSet({ accountId: id, signature: SIGNATURE })).toEqual({ ok: false, error: 'storage' })
    expect(await broken.signatureGet({ accountId: id })).toEqual({ ok: false, error: 'storage' })
    // Fora do formato continua `invalid`, antes de tocar no disco.
    expect(await broken.signatureSet({ accountId: id, signature: { ...SIGNATURE, text: 1 } })).toEqual({ ok: false, error: 'invalid' })
  })

  it('no arquivo: assinatura inválida ou de conta que não existe sai sozinha', async () => {
    const { dir, service } = setup()
    const id = await addAccount(service, 'ana@exemplo.com.br')
    const file = JSON.parse(readFileSync(join(dir, SETTINGS_FILE), 'utf8')) as Record<string, unknown>
    const ghost = '0b8f5a52-6f6c-4f0e-9a51-6c1f0f7e9d10'
    writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify({ ...file, emailSignatures: { [id]: SIGNATURE, [ghost]: SIGNATURE, x: SIGNATURE } }))
    expect(await createFileSettingsStore({ dir }).getEmailSignatures()).toEqual({ [id]: SIGNATURE })
    writeFileSync(join(dir, SETTINGS_FILE), JSON.stringify({ ...file, emailSignatures: { [id]: { ...SIGNATURE, text: 1 } } }))
    expect(await createFileSettingsStore({ dir }).getEmailSignatures()).toEqual({})
  })
})
