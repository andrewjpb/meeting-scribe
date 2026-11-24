// Contrato 168 (pastas-assistente E): a resposta de email com anexos das pastas. A resolução dos ids pelo índice da
// conversa (CA1, CA2), o histórico com o cartão antigo, o "Abrir no Composer" numa pasta de verdade com um leitor falso
// (CA3, CA7) e a regra da instrução (CA6).
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as FsPromises from 'node:fs/promises'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_REPLY_ATTACHMENTS_MAX, EMAIL_REPLY_OPENED_TEXT, type ChatAction, type EmailReplyAction } from '../src/shared/assistant'
import { fileKindOf, type AssistantFolder, type FolderFileEntry } from '../src/shared/assistant-folders'
import { EMAIL_ATTACH_MAX_FILES, EMAIL_TEXT_MAX, type EmailAccountStatus, type EmailMessage } from '../src/shared/email'
import { INVOKE_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { Chat } from '../src/shared/chat'
import { actionsHistory, createChatActions, emailReplyAttachments, extractActions, type ActionResolver } from '../src/main/chat/actions'
import { folderFileId, type FolderIndex } from '../src/main/chat/folders'
import { chatActionSchema, createFileChatStore } from '../src/main/chat/store'
import { assistantSystemPrompt } from '../src/main/claude-cli/chat'
import { emailRef } from '../src/main/email/export'

// A corrida do link: o gancho roda dentro do `realpath` do `locateFolderFile`, depois do `lstat` (o arquivo trocado por um
// link entre a conferência e a leitura).
const race = vi.hoisted(() => ({ afterCheck: null as ((path: string) => void) | null }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof FsPromises>()
  return {
    ...original,
    realpath: async (path: Parameters<typeof original.realpath>[0]) => {
      const real = await original.realpath(path)
      race.afterCheck?.(String(path))
      return real
    },
  }
})

const SP = 'America/Sao_Paulo'
const NOW = Date.parse('2026-11-23T10:00:00-03:00')
const ACCOUNT = '0a1b2c3d-1111-4222-8333-444455556666'
const OWN = 'andrew@lap.example'
const CHAT = 'c1'
const MB = 1024 * 1024
const SECRET = 'CONTEUDO-SECRETO-DO-ANEXO'

const status: EmailAccountStatus = {
  account: {
    id: ACCOUNT,
    address: OWN,
    name: 'Andrew',
    username: OWN,
    incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' },
    outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' },
    deleteFromServer: false,
  },
  state: 'connected',
  error: null,
  sentMailbox: 'Sent',
}
const received: EmailMessage = {
  id: '3',
  accountId: ACCOUNT,
  mailbox: 'INBOX',
  uid: 3,
  seen: false,
  flagged: false,
  answered: false,
  from: [{ name: 'Michel Souza', address: 'michel@cliente.example' }],
  to: [{ name: null, address: OWN }],
  cc: [],
  subject: 'Documentos para o contrato',
  date: NOW - 3_600_000,
  messageId: '<m3@cliente.example>',
  inReplyTo: null,
  references: [],
}
const ref = emailRef(ACCOUNT, '3')
const block = (json: unknown): string => `\`\`\`lap-acao\n${JSON.stringify(json)}\n\`\`\``

let root: string
let pasta: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'resposta-anexos-')))
  pasta = join(root, 'Documentos LAP')
  mkdirSync(pasta)
})
afterEach(() => {
  race.afterCheck = null
  rmSync(root, { recursive: true, force: true })
})

const folder = (): AssistantFolder => ({ id: 'f1', path: pasta, addedAt: '2026-11-23T10:00:00.000Z' })

function entryOf(relPath: string, size: number): FolderFileEntry {
  const name = basename(relPath)
  const kind = fileKindOf(name)
  if (!kind) throw new Error(`tipo fora do índice: ${name}`)
  return { id: folderFileId('f1', relPath), folderId: 'f1', relPath, name, ext: name.slice(name.lastIndexOf('.') + 1).toLowerCase(), kind: kind.kind, readable: kind.readable, size, mtime: 0 }
}

/** Grava o arquivo na pasta (com `size` bytes) e devolve a entrada do índice dele. */
function put(relPath: string, size: number): FolderFileEntry {
  mkdirSync(join(pasta, relPath, '..'), { recursive: true })
  writeFileSync(join(pasta, relPath), Buffer.alloc(size, SECRET))
  return entryOf(relPath, size)
}

function indexOf(entries: readonly FolderFileEntry[]): FolderIndex {
  const map = new Map(entries.map((entry) => [entry.id, entry]))
  return {
    scans: () => Promise.resolve([]),
    markdown: () => Promise.resolve(null),
    resolve: (chatId, id) => (chatId === CHAT ? (map.get(id) ?? null) : null),
    folderOf: (entry) => (entry.folderId === 'f1' ? folder() : null),
    invalidate: () => undefined,
    forget: () => undefined,
    forgetAll: () => undefined,
  }
}

/** O resolver do cartão com o índice desta conversa (como o `extract` do main monta). */
function resolver(entries: readonly FolderFileEntry[]): ActionResolver {
  const index = indexOf(entries)
  return {
    email: (wanted) => Promise.resolve(wanted === ref ? { status, message: received, mailbox: null, pending: true } : null),
    folderFile: (id) => {
      const entry = index.resolve(CHAT, id)
      return entry ? { entry, folderLabel: 'Documentos LAP' } : null
    },
    now: () => NOW,
    timeZone: () => SP,
    newId: () => 'a1',
  }
}

const reply = async (json: Record<string, unknown>, entries: readonly FolderFileEntry[]): Promise<EmailReplyAction> => {
  const { actions } = await extractActions(block({ tipo: 'email-resposta', email: ref, texto: 'Seguem os documentos.', ...json }), resolver(entries))
  const [action] = actions
  if (action?.kind !== 'email-resposta') throw new Error('sem cartão')
  return action
}

describe('anexos resolvidos pelo índice da conversa (CA1, CA2)', () => {
  it('2 anexos válidos e 1 faltando: em ordem, com o pedido, o tamanho do índice e a pasta; o texto não muda', async () => {
    const contrato = entryOf('Contratos/Contrato-Exemplo-2026.pdf', Math.round(1.2 * MB))
    const proposta = entryOf('Propostas/Proposta-Exemplo.docx', 240 * 1024)
    const action = await reply(
      { anexos: [{ id: contrato.id, pedido: 'contrato assinado' }, { id: proposta.id, pedido: 'proposta comercial' }], faltando: ['comprovante de inscrição estadual'] },
      [contrato, proposta],
    )
    expect(action.text).toBe('Seguem os documentos.')
    expect(action.attachments).toEqual([
      { id: contrato.id, name: 'Contrato-Exemplo-2026.pdf', relPath: 'Contratos/Contrato-Exemplo-2026.pdf', folderLabel: 'Documentos LAP', bytes: contrato.size, requested: 'contrato assinado' },
      { id: proposta.id, name: 'Proposta-Exemplo.docx', relPath: 'Propostas/Proposta-Exemplo.docx', folderLabel: 'Documentos LAP', bytes: 240 * 1024, requested: 'proposta comercial' },
    ])
    expect(action.missing).toEqual(['comprovante de inscrição estadual'])
    // O cartão gravado passa no esquema do histórico.
    expect(chatActionSchema.safeParse(action).success).toBe(true)
  })

  it('sem anexos nem faltando: os dois vazios (o cartão de sempre)', async () => {
    const action = await reply({}, [])
    expect(action).toMatchObject({ attachments: [], missing: [] })
  })

  it('cartão antigo, gravado sem os campos: o histórico lê com [] nos dois', () => {
    const old = { kind: 'email-resposta', id: 'a1', status: 'proposed', result: null, accountId: ACCOUNT, account: OWN, messageId: '3', mailbox: null, inReplyTo: null, to: ['michel@cliente.example'], toLabel: 'Michel', subject: 'Re: x', text: 'Ok' }
    const parsed = chatActionSchema.parse(old)
    expect(parsed).toMatchObject({ attachments: [], missing: [] })
    // O estado novo também é aceito.
    expect(chatActionSchema.safeParse({ ...old, status: 'opened', result: EMAIL_REPLY_OPENED_TEXT }).success).toBe(true)
  })

  it('id fora do índice vira faltante; id repetido entra uma vez', async () => {
    const contrato = entryOf('Contratos/c.pdf', 1000)
    const action = await reply({ anexos: [{ id: contrato.id }, { id: contrato.id, pedido: 'de novo' }, { id: 'ffffffffffffffff', pedido: 'nota fiscal' }, { id: 'eeeeeeeeeeeeeeee' }] }, [contrato])
    expect(action.attachments.map((item) => item.id)).toEqual([contrato.id])
    expect(action.attachments[0]?.requested).toBeNull()
    expect(action.missing).toEqual(['nota fiscal (arquivo não está no índice)', 'eeeeeeeeeeeeeeee (arquivo não está no índice)'])
  })

  it('11 ids válidos: 10 anexos e o 11º faltando; 3 arquivos de 9 MB: 2 anexos e o 3º faltando', async () => {
    const many = Array.from({ length: 11 }, (_, at) => entryOf(`Docs/d${at}.pdf`, 1000))
    const eleven = await reply({ anexos: many.map((entry) => ({ id: entry.id })) }, many)
    expect(EMAIL_REPLY_ATTACHMENTS_MAX).toBe(EMAIL_ATTACH_MAX_FILES)
    expect(eleven.attachments).toHaveLength(10)
    expect(eleven.missing).toEqual(['d10.pdf (não coube no limite de 20 MB)'])
    const big = Array.from({ length: 3 }, (_, at) => entryOf(`Grandes/g${at}.pdf`, 9 * MB))
    const heavy = await reply({ anexos: big.map((entry, at) => ({ id: entry.id, pedido: `item ${at}` })) }, big)
    expect(heavy.attachments.map((item) => item.name)).toEqual(['g0.pdf', 'g1.pdf'])
    expect(heavy.missing).toEqual(['item 2 (não coube no limite de 20 MB)'])
  })

  it('12 faltantes de 200 caracteres: no máximo 10 itens de até 120 (contando os derivados)', async () => {
    const long = Array.from({ length: 12 }, (_, at) => `${at} ${'x'.repeat(198)}`)
    const action = await reply({ anexos: [{ id: '0000000000000000', pedido: 'certidão' }], faltando: long }, [])
    expect(action.missing).toHaveLength(10)
    expect(action.missing[0]).toBe('certidão (arquivo não está no índice)')
    for (const item of action.missing) expect(item.length).toBeLessThanOrEqual(120)
    // A função pura, direto.
    expect(emailReplyAttachments(undefined, undefined, undefined)).toEqual({ attachments: [], missing: [] })
  })

  it('o histórico diz o que vai anexo (o caminho dentro da pasta) e o que falta', async () => {
    const contrato = entryOf('Contratos/c.pdf', 1000)
    const action = await reply({ anexos: [{ id: contrato.id }], faltando: ['certidão'] }, [contrato])
    const history = actionsHistory([action])
    expect(history).toContain('com os anexos Documentos LAP/Contratos/c.pdf')
    expect(history).toContain('sem certidão')
    expect(history).not.toContain(root)
  })
})

describe('"Abrir no Composer" (CA3, CA7)', () => {
  async function setup(entries: readonly FolderFileEntry[], action: EmailReplyAction) {
    const store = createFileChatStore({ dir: join(root, 'conversas') })
    const chat: Chat = {
      id: CHAT,
      meetingId: null,
      title: 'Documentos do Michel',
      createdAt: new Date(NOW).toISOString(),
      messages: [
        { role: 'user', text: 'Responda ao Michel com os documentos', at: new Date(NOW).toISOString() },
        { role: 'assistant', text: 'Proponho.', at: new Date(NOW).toISOString(), actions: [action as ChatAction] },
      ],
      scope: { kind: 'all' },
      model: null,
      thinkMore: false,
    }
    await store.save(chat)
    const logs: string[] = []
    const actions = createChatActions({ store, timeZone: () => SP, now: () => NOW, folderIndex: indexOf(entries), log: (line) => logs.push(line) })
    const stateOf = async (): Promise<ChatAction | undefined> => (await store.get(CHAT))?.messages[1]?.actions?.[0]
    return { actions, logs, stateOf, store }
  }
  const at = { chatId: CHAT, index: 1, actionId: 'a1' }

  it('proposed com 2 anexos: lê os 2 arquivos, devolve o rascunho com o texto editado e marca `opened`; a segunda vez, o mesmo', async () => {
    const contrato = put('Contratos/Contrato-Exemplo-2026.pdf', 1200)
    const proposta = put('Propostas/Proposta-Exemplo.docx', 240)
    const action = await reply({ anexos: [{ id: contrato.id, pedido: 'contrato assinado' }, { id: proposta.id }], faltando: ['comprovante'] }, [contrato, proposta])
    const { actions, stateOf } = await setup([contrato, proposta], action)
    const first = await actions.emailCompose({ ...at, text: 'Seguem os documentos, Michel.' })
    expect(first).toMatchObject({ ok: true, accountId: ACCOUNT, mailbox: null, to: ['michel@cliente.example'], subject: 'Re: Documentos para o contrato', text: 'Seguem os documentos, Michel.', inReplyTo: '<m3@cliente.example>', skipped: [] })
    if (!first.ok) throw new Error('falhou')
    expect(first.attachments.map((item) => item.name)).toEqual(['Contrato-Exemplo-2026.pdf', 'Proposta-Exemplo.docx'])
    expect(first.attachments.map((item) => item.bytes.byteLength)).toEqual([1200, 240])
    expect(first.attachments[0]?.bytes).toBeInstanceOf(Uint8Array)
    // O cartão aberto guarda o texto editado (como o "Enviado"), e o histórico mostra esse texto.
    const opened = await stateOf()
    expect(opened).toMatchObject({ status: 'opened', result: 'Aberto no Composer', text: 'Seguem os documentos, Michel.' })
    expect(actionsHistory(opened ? [opened] : [])).toContain('"Seguem os documentos, Michel."')
    const second = await actions.emailCompose(at)
    expect(second).toEqual(first)
    expect(await stateOf()).toMatchObject({ status: 'opened' })
    // Texto acima do limite: recusado.
    expect(await actions.emailCompose({ ...at, text: 'x'.repeat(EMAIL_TEXT_MAX + 1) })).toEqual({ ok: false, error: 'nao-encontrado' })
    // Aberto, o cartão não se descarta nem "envia" pelo estado.
    expect(await actions.setState({ ...at, state: 'dismissed' })).toEqual({ ok: false, error: 'done' })
  })

  it('nenhum envio: as ações do chat não recebem o serviço de email e o handler não chama envio nenhum', () => {
    const source = readFileSync(join(__dirname, '../src/main/chat/actions.ts'), 'utf8')
    const handler = source.slice(source.indexOf('async emailCompose('), source.indexOf('async reminder('))
    expect(handler.length).toBeGreaterThan(100)
    for (const word of ['emailSend', '.send(', 'smtp', 'sendMail']) expect(handler).not.toContain(word)
    expect(source).not.toMatch(/from '\.\.\/email\/service'/)
  })

  it('arquivo que mudou de tamanho, sumiu ou virou link vai para `skipped`; nada do destino do link é lido', async () => {
    const ok = put('a.pdf', 100)
    const changed = put('b.pdf', 100)
    const gone = put('c.pdf', 100)
    const linked = put('d.pdf', 100)
    const action = await reply({ anexos: [{ id: ok.id }, { id: changed.id }, { id: gone.id }, { id: linked.id }] }, [ok, changed, gone, linked])
    const { actions } = await setup([ok, changed, gone, linked], action)
    writeFileSync(join(pasta, 'b.pdf'), Buffer.alloc(150, 1))
    rmSync(join(pasta, 'c.pdf'))
    writeFileSync(join(root, 'fora.pdf'), Buffer.alloc(100, 'FORA-DA-PASTA'))
    rmSync(join(pasta, 'd.pdf'))
    symlinkSync(join(root, 'fora.pdf'), join(pasta, 'd.pdf'))
    const result = await actions.emailCompose(at)
    expect(result).toMatchObject({ ok: true, skipped: ['b.pdf', 'c.pdf', 'd.pdf'] })
    if (!result.ok) throw new Error('falhou')
    expect(result.attachments.map((item) => item.name)).toEqual(['a.pdf'])
  })

  it('trocado por um link depois da conferência (`lstat`): a leitura sem seguir link falha e o item vai para `skipped`', async () => {
    const a = put('a.pdf', 100)
    const action = await reply({ anexos: [{ id: a.id }] }, [a])
    const { actions, stateOf } = await setup([a], action)
    writeFileSync(join(root, 'fora.pdf'), Buffer.alloc(100, 'FORA-DA-PASTA'))
    let swapped = false
    race.afterCheck = (path) => {
      if (swapped || path !== join(pasta, 'a.pdf')) return
      swapped = true
      rmSync(path)
      symlinkSync(join(root, 'fora.pdf'), path)
    }
    const result = await actions.emailCompose(at)
    expect(swapped).toBe(true)
    expect(result).toEqual(expect.objectContaining({ ok: true, attachments: [], skipped: ['a.pdf'] }))
    expect(JSON.stringify(result)).not.toContain('FORA')
    // Nenhum anexo lido: abre mesmo assim; quem decide é a pessoa no Composer.
    expect(await stateOf()).toMatchObject({ status: 'opened' })
  })

  it('cartão enviado ou descartado: `estado`; referência que não existe: `nao-encontrado`', async () => {
    const a = put('a.pdf', 100)
    const action = await reply({ anexos: [{ id: a.id }] }, [a])
    const sent = await setup([a], { ...action, status: 'done', result: 'Enviado às 10:05' })
    expect(await sent.actions.emailCompose(at)).toEqual({ ok: false, error: 'estado' })
    const dismissed = await setup([a], { ...action, status: 'dismissed', result: 'Descartado' })
    expect(await dismissed.actions.emailCompose(at)).toEqual({ ok: false, error: 'estado' })
    expect(await dismissed.actions.emailCompose({ ...at, actionId: 'zz' })).toEqual({ ok: false, error: 'nao-encontrado' })
    expect(await dismissed.actions.emailCompose({ ...at, chatId: 'outra' })).toEqual({ ok: false, error: 'nao-encontrado' })
    expect(await dismissed.actions.emailCompose({ ...at, index: 0 })).toEqual({ ok: false, error: 'nao-encontrado' })
    expect(await dismissed.actions.emailCompose({ chatId: CHAT })).toEqual({ ok: false, error: 'nao-encontrado' })
  })

  it('o canal existe e é recusado com o app bloqueado; nada do handler vai para log', async () => {
    expect(INVOKE_CHANNELS).toContain('scribe:chat-action-email-compose')
    expect(WHEN_LOCKED['scribe:chat-action-email-compose']).toBe('refused')
    const a = put('a.pdf', 100)
    const action = await reply({ anexos: [{ id: a.id }] }, [a])
    const { actions, logs } = await setup([a], action)
    await actions.emailCompose(at)
    for (const line of logs) {
      expect(line).not.toContain(SECRET)
      expect(line).not.toContain(root)
      expect(line).not.toContain('Seguem os documentos')
    }
  })
})

describe('a regra do email que pede documentos (CA6)', () => {
  const pastaTool = '- ler_arquivo_pasta: abre um arquivo das pastas.'
  const emailTool = '- buscar_emails: busca emails.'
  it('só com a fonte Pastas e o email na conversa', () => {
    const both = assistantSystemPrompt('all', false, false, [emailTool, pastaTool])
    for (const text of ['pede documentos', '`anexos`', '`faltando`', '20 MB', 'Nunca invente arquivo', '"anexos":[{"id":"3f9a0c1e8b2d4a6f","pedido":"contrato assinado"}', '"faltando":["comprovante de inscrição estadual"]', 'Enviar no Composer']) expect(both).toContain(text)
    // O exemplo é um bloco que o app aceita (a referência "em-…" do email, como nos outros blocos).
    expect(both).toContain('{"tipo":"email-resposta","email":"em-…"')
    for (const tools of [[pastaTool], [emailTool], []]) expect(assistantSystemPrompt('all', false, false, tools)).not.toContain('pede documentos')
  })
})
