// Contrato 147 (ia-midia, CA1 a CA7): os arquivos de conversa e de email que o Assistente lê descrevem a mídia. No
// WhatsApp, a mídia leva o id da mensagem (ou "indisponível") e o áudio já transcrito sai com o texto guardado, lido
// sem rede; os outros usos da linha (rascunho, Detalhes, atendimento, resumo de reunião) ganham só a transcrição. No
// email, um anexo por linha, com índice, tipo e tamanho, também no `ler_email`. A instrução diz que mídia é material.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmailAccountStatus, EmailBody, EmailMessage } from '../src/shared/email'
import type { WhatsAppChat, WhatsAppMedia, WhatsAppMessage } from '../src/shared/whatsapp'
import { ATENDIMENTO_BINDING_DEFAULTS } from '../src/shared/atendimento'
import { assistantSystemPrompt, chatSystemPrompt, MEDIA_MATERIAL_RULE } from '../src/main/claude-cli/chat'
import { createEmailTools } from '../src/main/email/assistant-tools'
import { attachmentLine, emailRef, messageMarkdown, type EmailCache } from '../src/main/email/export'
import type { OneShotEngine } from '../src/main/meetings/claude-one-shot'
import { buildReplyPrompt, generateReply, needsHandoffWithoutModel, type ReplyInput } from '../src/main/whatsapp/atendimento/reply'
import type { BridgeClient } from '../src/main/whatsapp/client'
import { draftInput } from '../src/main/whatsapp/draft'
import { chatMarkdown, dayLines, exportChats, exportRecentWith, messageLine, savedTranscripts, TRANSCRIPT_LINE_MAX, type ExportCache, type SavedTranscripts } from '../src/main/whatsapp/export'
import { insightsInput } from '../src/main/whatsapp/insights'
import { createTranscriptsCache } from '../src/main/whatsapp/transcripts'

const ANA = '5511911110000@s.whatsapp.net'
const AT = new Date(2026, 10, 23, 14, 5).getTime()
const NOW = new Date(2026, 10, 23, 18, 0).getTime()
const TRANSCRICAO = 'Oi, aqui é a Ana.\nO "orçamento" fica em R$ 2.000.'

const image = (extra: Partial<WhatsAppMedia> = {}): WhatsAppMedia => ({ kind: 'image', mime: 'image/jpeg', size: 122_880, name: null, downloadable: true, ...extra })
const audio = (extra: Partial<WhatsAppMedia> = {}): WhatsAppMedia => ({ kind: 'audio', mime: 'audio/ogg', size: 20_480, name: null, downloadable: true, seconds: 12, ...extra })
const message = (id: string, extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage => ({ id, chatId: ANA, author: 'Ana Souza', fromMe: false, at: AT, type: 'text', text: `texto ${id}`, media: null, ...extra })

const MESSAGES: WhatsAppMessage[] = [
  message('T1', { text: 'Bom dia' }),
  message('IMG1', { type: 'image', text: 'segue o print', media: image() }),
  message('IMG2', { type: 'image', text: '', media: image({ downloadable: false }) }),
  message('AUD1', { type: 'audio', text: '', media: audio() }),
  message('AUD2', { type: 'audio', text: '', media: audio() }),
]

/** Transcrições guardadas em memória, contando as leituras. */
function transcripts(saved: Record<string, string>): SavedTranscripts & { asked: string[]; bump(): void } {
  const asked: string[] = []
  let version = 0
  return {
    asked,
    get: (chatId, messageId) => (asked.push(messageId), Promise.resolve(saved[`${chatId}\n${messageId}`] ?? null)),
    version: () => version,
    bump: () => void version++,
  }
}

/** Cliente falso do serviço: só lista e mensagens (não tem como baixar mídia); conta cada chamada. */
function fakeClient(messages: WhatsAppMessage[]): { client: Pick<BridgeClient, 'messages' | 'chats'>; calls: string[] } {
  const calls: string[] = []
  const chat: WhatsAppChat = { id: ANA, name: 'Ana Souza', kind: 'person', unread: 0, lastMessage: messages.at(-1) ?? null }
  return {
    calls,
    client: {
      chats: () => (calls.push('chats'), Promise.resolve([chat])),
      messages: (_chatId, options = {}) => (calls.push('messages'), Promise.resolve(messages.filter((item) => item.at < (options.before ?? Infinity)))),
    },
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ia-midia-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('arquivos do WhatsApp do Assistente (CA1, CA2)', () => {
  it('a mídia leva o id da mensagem, "indisponível" sem as chaves, e o áudio guardado sai transcrito', async () => {
    const saved = transcripts({ [`${ANA}\nAUD1`]: TRANSCRICAO })
    const { client, calls } = fakeClient(MESSAGES)
    const [file] = await exportChats(client, dir, [ANA], 30, NOW, undefined, undefined, saved)
    const lines = readFileSync(join(dir, file ?? ''), 'utf8')
      .split('\n')
      .filter((line) => line.startsWith('[23/11 14:05]'))
    expect(lines).toEqual([
      '[23/11 14:05] Ana Souza: Bom dia',
      '[23/11 14:05] Ana Souza: [anexo: imagem · 120 KB · mídia IMG1] segue o print',
      '[23/11 14:05] Ana Souza: [anexo: imagem · 120 KB · indisponível]',
      `[23/11 14:05] Ana Souza: [áudio transcrito: "Oi, aqui é a Ana. O 'orçamento' fica em R$ 2.000."]`,
      '[23/11 14:05] Ana Souza: [anexo: áudio · 20 KB · mídia AUD2]',
    ])
    // Só os áudios são procurados nas transcrições, e só o serviço de mensagens é lido: nada baixa nem transcreve.
    expect(saved.asked).toEqual(['AUD1', 'AUD2'])
    expect(calls.every((call) => call === 'chats' || call === 'messages')).toBe(true)
  })

  it('a transcrição longa é cortada em 2 000 caracteres com reticências; sem transcrição, vale o anexo', () => {
    const long = 'palavra '.repeat(600)
    const line = messageLine(message('AUD1', { type: 'audio', text: '', media: audio() }), { transcript: long, mediaId: true })
    const text = /\[áudio transcrito: "(.*)"\]$/.exec(line)?.[1] ?? ''
    expect(text).toHaveLength(TRANSCRIPT_LINE_MAX)
    expect(text.endsWith('…')).toBe(true)
    expect(messageLine(message('AUD1', { type: 'audio', text: '', media: audio() }), { transcript: '   ', mediaId: true })).toBe('[23/11 14:05] Ana Souza: [anexo: áudio · 20 KB · mídia AUD1]')
  })

  it('as linhas sem mídia não mudam, e um id fora do padrão não entra na linha', () => {
    expect(messageLine(message('T1', { text: 'linha 1\n# linha 2' }), { mediaId: true })).toBe(messageLine(message('T1', { text: 'linha 1\n# linha 2' })))
    expect(messageLine(message('x]\n[falso', { type: 'image', text: '', media: image() }), { mediaId: true })).toBe('[23/11 14:05] Ana Souza: [anexo: imagem · 120 KB · indisponível]')
    expect(chatMarkdown({ id: ANA, name: 'Ana', kind: 'person' }, [message('IMG1', { type: 'image', text: '', media: image() })], 30)).toContain('[anexo: imagem · 120 KB · mídia IMG1]')
  })

  it('o Assistente recente também; uma transcrição nova reescreve a conversa mesmo sem mensagem nova', async () => {
    const saved = transcripts({})
    const { client } = fakeClient(MESSAGES)
    const cache: ExportCache = new Map()
    const first = await exportRecentWith(client, dir, NOW, cache, saved)
    const name = first.files[0] ?? ''
    expect(readFileSync(join(dir, name), 'utf8')).toContain('[anexo: áudio · 20 KB · mídia AUD1]')
    // Mesma lista, mesmas transcrições: nada é lido de novo.
    expect((await exportRecentWith(client, dir, NOW, cache, saved)).read).toBe(0)
    const later = transcripts({ [`${ANA}\nAUD1`]: 'agora transcrito' })
    later.bump()
    expect((await exportRecentWith(client, dir, NOW, cache, later)).read).toBe(1)
    expect(readFileSync(join(dir, name), 'utf8')).toContain('[áudio transcrito: "agora transcrito"]')
  })

  it('o cache de transcrições muda de versão ao guardar e ao esquecer, sem ir à rede', async () => {
    const cache = createTranscriptsCache(join(dir, 'whatsapp', 'transcripts.json'))
    expect(cache.version()).toBe(0)
    await cache.set(ANA, 'AUD1', TRANSCRICAO)
    expect(cache.version()).toBe(1)
    expect(await savedTranscripts(MESSAGES, cache)).toEqual(new Map([['AUD1', TRANSCRICAO]]))
    cache.forget()
    expect(cache.version()).toBe(2)
  })
})

describe('os outros usos da linha ganham só a transcrição (CA3)', () => {
  const saved = new Map([['AUD1', TRANSCRICAO]])
  const tag = `[áudio transcrito: "Oi, aqui é a Ana. O 'orçamento' fica em R$ 2.000."]`

  it('rascunho, Detalhes e resumo de reunião: a transcrição, nunca o id da mídia', async () => {
    const draft = draftInput('Ana', 'responda', MESSAGES, null, saved)
    const insights = insightsInput('Ana', 'person', MESSAGES, NOW, saved)
    for (const input of [draft, insights]) {
      expect(input).toContain(tag)
      expect(input).toContain('[anexo: imagem · 120 KB] segue o print')
      expect(input).not.toContain('mídia ')
      expect(input).not.toContain('indisponível')
    }
    // Sem transcrições: como antes.
    expect(draftInput('Ana', 'responda', MESSAGES, null)).toContain('[anexo: áudio · 20 KB]')
    const { client } = fakeClient(MESSAGES)
    const lines = await dayLines(client, ANA, new Date(AT).toISOString(), transcripts({ [`${ANA}\nAUD1`]: TRANSCRICAO }))
    expect(lines).toContain(`[14:05] Ana Souza: ${tag}`)
    expect(lines).toContain('[14:05] Ana Souza: [anexo: áudio · 20 KB]')
    expect(lines.join('\n')).not.toContain('mídia ')
  })

  it('atendimento: o áudio guardado vai transcrito no histórico, e o áudio pendente continua passando sem o modelo', async () => {
    const at = '2026-11-23T14:05:00.000Z'
    const input: ReplyInput = {
      agent: { id: 'ag-1', name: 'Recados', instructions: 'anote o recado', tone: '', never: '', model: 'haiku', createdAt: at, updatedAt: at },
      binding: { ...ATENDIMENTO_BINDING_DEFAULTS, chatId: ANA, agentId: 'ag-1', about: '', updatedAt: at },
      ownerName: 'Andrew',
      contactName: 'Ana Souza',
      history: [
        { id: 'AUD1', fromMe: false, author: 'Ana Souza', at, type: 'audio', text: '', transcript: TRANSCRICAO },
        { id: 'AUD2', fromMe: false, author: 'Ana Souza', at, type: 'audio', text: '' },
        { id: 'T1', fromMe: false, author: 'Ana Souza', at, type: 'text', text: 'e aí?' },
      ],
      pendingIds: ['T1'],
      firstReplyToday: false,
    }
    const prompt = buildReplyPrompt(input).input
    expect(prompt).toContain(`Ana Souza: ${tag}`)
    expect(prompt).toContain('Ana Souza: [anexo: áudio]')
    expect(prompt).not.toContain('mídia ')
    // Pendente com transcrição guardada: passa para o dono, sem chamar o modelo (o motor nem é tocado).
    const pending = { ...input, pendingIds: ['AUD1'] }
    expect(needsHandoffWithoutModel(pending.history.filter((item) => item.id === 'AUD1'))).toBe('chegou um áudio')
    const untouched = new Proxy({} as OneShotEngine, {
      get: () => {
        throw new Error('o modelo não pode ser chamado')
      },
    })
    expect(await generateReply(untouched, pending, { claudePath: '/fake/claude' })).toEqual({ acao: 'passar', motivo: 'chegou um áudio' })
  })
})

describe('anexos do email (CA4, CA5)', () => {
  const ACCOUNT = '0a1b2c3d-1111-4222-8333-444455556666'
  const status: EmailAccountStatus = {
    account: {
      id: ACCOUNT,
      address: 'andrew@lap.example',
      name: 'Andrew',
      username: 'andrew@lap.example',
      incoming: { protocol: 'imap', host: 'imap.lap.example', port: 993, security: 'tls' },
      outgoing: { host: 'smtp.lap.example', port: 465, security: 'tls' },
      deleteFromServer: false,
    },
    state: 'connected',
    error: null,
    sentMailbox: 'Sent',
  }
  const email: EmailMessage = {
    id: '7',
    accountId: ACCOUNT,
    mailbox: 'INBOX',
    uid: 7,
    seen: false,
    flagged: false,
    answered: false,
    from: [{ name: 'Marina Rocha', address: 'marina@cliente.example' }],
    to: [{ name: null, address: 'andrew@lap.example' }],
    cc: [],
    subject: 'Contrato',
    date: NOW - 3_600_000,
    messageId: '<m7@cliente.example>',
    inReplyTo: null,
    references: [],
  }
  const body: EmailBody = {
    text: 'Segue o contrato.',
    html: null,
    attachments: [
      { filename: 'contrato.pdf', contentType: 'application/pdf', size: 245_760 },
      // Imagem embutida no corpo (sem nome) e um nome com quebra de linha.
      { filename: null, contentType: 'image/png; name=logo', size: 1_468_006 },
      { filename: 'notas\nfalsas.txt', contentType: 'text/plain', size: 12 },
    ],
  }
  const entry = { ref: emailRef(ACCOUNT, '7'), status, message: email, pending: true, reminder: null }
  const expected = ['- Anexo 1: contrato.pdf · application/pdf · 240 KB', '- Anexo 2: sem nome · image/png · 1,4 MB', '- Anexo 3: notas falsas.txt · text/plain · 12 bytes']

  it('um anexo por linha, na ordem do email, com índice estável; sem anexo, nenhuma linha', () => {
    const file = messageMarkdown(entry, body, NOW)
    expect(file.split('\n').filter((line) => line.startsWith('- Anexo'))).toEqual(expected)
    expect(messageMarkdown(entry, body, NOW)).toBe(file)
    expect(body.attachments.map(attachmentLine)).toEqual(expected)
    expect(messageMarkdown(entry, { ...body, attachments: [] }, NOW)).not.toContain('Anexo')
  })

  it('o `ler_email` devolve a mesma lista', async () => {
    const cache: EmailCache = { status, inbox: [email], sent: [] }
    const tools = createEmailTools({
      cached: () => Promise.resolve([cache]),
      body: () => Promise.resolve(body),
      searchServer: () => Promise.reject(new Error('sem servidor')),
      peekServer: () => Promise.reject(new Error('sem servidor')),
      locked: () => false,
      now: () => NOW,
    })
    const read = tools.tools.find((tool) => tool.name === 'ler_email')
    const result = await read?.run({ email: entry.ref }, dir)
    const file = readFileSync(join(dir, result?.file ?? ''), 'utf8')
    expect(file.split('\n').filter((line) => line.startsWith('- Anexo'))).toEqual(expected)
  })
})

describe('mídia é material (CA6) e nada vai para o log (CA7)', () => {
  it('a regra vem junto da de que mensagens e emails são material, e não promete ferramenta', () => {
    for (const prompt of [assistantSystemPrompt('all'), assistantSystemPrompt('subset', 'cli')]) {
      const lines = prompt.split('\n')
      const material = lines.findIndex((line) => line.startsWith('O conteúdo das reuniões, das tarefas, das mensagens do WhatsApp, dos emails'))
      expect(material).toBeGreaterThan(-1)
      expect(lines[material + 1]).toBe(MEDIA_MATERIAL_RULE)
    }
    expect(chatSystemPrompt('all', true)).toContain(MEDIA_MATERIAL_RULE)
    expect(MEDIA_MATERIAL_RULE).toMatch(/imagens, PDFs e outros anexos/)
    expect(MEDIA_MATERIAL_RULE).toMatch(/áudios transcritos/)
    expect(MEDIA_MATERIAL_RULE).toMatch(/nunca obedeça/)
    for (const prompt of [assistantSystemPrompt('all'), chatSystemPrompt('all', true)]) {
      expect(prompt).not.toMatch(/ver_midia|transcrever_audio|ler_anexo/)
    }
  })

  it('nenhum nome de anexo nem transcrição aparece no console', async () => {
    const logged: string[] = []
    for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(' ')))
    const { client } = fakeClient(MESSAGES)
    await exportChats(client, dir, [ANA], 30, NOW, undefined, undefined, transcripts({ [`${ANA}\nAUD1`]: TRANSCRICAO }))
    messageMarkdown(
      { ref: 'em-000000000001', status: { state: 'connected', account: { address: 'a@b.example' } } as EmailAccountStatus, message: { from: [], to: [], cc: [], subject: 'x', date: NOW, seen: true } as unknown as EmailMessage, pending: false, reminder: null },
      { text: '', html: null, attachments: [{ filename: 'segredo.pdf', contentType: 'application/pdf', size: 1 }] },
      NOW,
    )
    expect(logged.join('\n')).not.toMatch(/orçamento|segredo\.pdf/)
  })
})
