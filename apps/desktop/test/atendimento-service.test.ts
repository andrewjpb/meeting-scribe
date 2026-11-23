// Contrato 141 (whatsapp-agentes, CA1 a CA22): o serviço do atendimento com relógio, temporizador, motor e WhatsApp
// falsos (o store e o histórico em memória), a prova de envio do agente no cliente HTTP contra um serviço local falso,
// o envio do agente sem a correção, a prova estática de quem emite a prova e os canais recusados com o app bloqueado.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createVault } from '../src/main/accounts/vault'
import { memorySafeStorage } from '../src/main/secrets'
import type { ReplyInput, ReplyOutcome } from '../src/main/whatsapp/atendimento/reply'
import { createAtendimentoScheduler, type AtendimentoScheduler, type SchedulerDeps } from '../src/main/whatsapp/atendimento/scheduler'
import { createAtendimentoService, typingDelayMs, type AtendimentoNotice } from '../src/main/whatsapp/atendimento/service'
import { createBridgeClient } from '../src/main/whatsapp/client'
import { AGENT_PROOF_TTL_MS, createAgentSendAuthority, spendAgentSendProof, type AgentSendAuthority, type AgentSendProof } from '../src/main/whatsapp/send-guard'
import { createWhatsAppService } from '../src/main/whatsapp/service'
import { ATENDIMENTO_BINDING_DEFAULTS, type AtendimentoAgent, type AtendimentoBinding, type AtendimentoLogEntry, type AtendimentoState } from '../src/shared/atendimento'
import { INVOKE_CHANNELS, MAIN_EVENT_CHANNELS, WHEN_LOCKED } from '../src/shared/ipc'
import type { WhatsAppMessage, WhatsAppSendRequest, WhatsAppSendResult } from '../src/shared/whatsapp'

const ANA = '5511911110000@s.whatsapp.net'
const BETO = '5511922220000@s.whatsapp.net'
const GRUPO = '120363000000000001@g.us'
const MINUTE = 60_000
/** Segunda, 23/11/2026, 10:00 na hora local. */
const START = new Date(2026, 10, 23, 10, 0).getTime()
const CLICK = '11111111-2222-4333-8444-555555555555'
const SEGREDO = 'INSTRUCOES-SECRETAS: nunca fale de preço'
const TEXTO_CONTATO = 'Oi, quanto custa o plano anual?'

/** O primeiro atendimento do estado (o teste sempre tem um). */
const primeiro = (state: AtendimentoState): AtendimentoBinding => {
  const binding = state.bindings[0]
  if (!binding) throw new Error('sem atendimento')
  return binding
}

/** A prova do agente para uma conversa individual (nunca `null` nos testes). */
const prova = (authority: AgentSendAuthority, chatId: string): AgentSendProof => {
  const proof = authority.issue(chatId)
  if (!proof) throw new Error('sem prova')
  return proof
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((done) => setImmediate(done))
}

const agente = (extra: Partial<AtendimentoAgent> = {}): AtendimentoAgent => ({
  id: 'ag-1',
  name: 'Bia',
  instructions: SEGREDO,
  tone: '',
  never: '',
  model: 'haiku',
  createdAt: new Date(START).toISOString(),
  updatedAt: new Date(START).toISOString(),
  ...extra,
})

const atendimentoDe = (chatId: string, extra: Partial<AtendimentoBinding> = {}): AtendimentoBinding => ({
  ...ATENDIMENTO_BINDING_DEFAULTS,
  chatId,
  agentId: 'ag-1',
  mode: 'auto',
  delayMinMinutes: 0,
  delayMaxMinutes: 0,
  typing: false,
  updatedAt: new Date(START).toISOString(),
  ...extra,
})

interface Options {
  bindings?: AtendimentoBinding[]
  outcome?: ReplyOutcome | ((input: ReplyInput) => ReplyOutcome | Promise<ReplyOutcome>)
  locked?: boolean
  history?: AtendimentoLogEntry[]
  messages?: (chatId: string) => WhatsAppMessage[]
  agentSend?: (proof: AgentSendProof, chatId: string, text: string) => Promise<WhatsAppSendResult>
  clickSend?: (request: WhatsAppSendRequest, onText?: (text: string) => void) => Promise<WhatsAppSendResult>
}

/** O serviço com tudo falso: relógio e temporizadores controlados, store e histórico em memória, motor e WhatsApp registrando. */
function harness(options: Options = {}) {
  let now = START
  let nextTimer = 1
  const timers = new Map<number, { fn: () => void; at: number }>()
  const state: AtendimentoState = { agents: [agente()], bindings: options.bindings ?? [atendimentoDe(ANA)], pausedAll: false, riskAcceptedAt: new Date(START).toISOString() }
  const history: AtendimentoLogEntry[] = [...(options.history ?? [])]
  const paused: { chatId: string; iso: string | null }[] = []
  const sent: { chatId: string; text: string; valid: boolean; at: number }[] = []
  const presence: { chatId: string; state: string; at: number }[] = []
  const clicks: { senderId: number; request: WhatsAppSendRequest }[] = []
  const tokens = new Set([CLICK])
  const replies: ReplyInput[] = []
  const notices: AtendimentoNotice[] = []
  const changed: string[] = []
  const logs: string[] = []
  const lastMessagesCalls: { chatId: string; max: number }[] = []
  const recorded: string[] = []
  const incoming: string[] = []
  const lock = { locked: options.locked ?? false }
  let sentCount = 0
  let schedulerRef: AtendimentoScheduler | null = null

  const service = createAtendimentoService({
    store: {
      state: () => Promise.resolve(structuredClone(state)),
      setPausedUntil: (chatId, iso) => {
        paused.push({ chatId, iso })
        const binding = state.bindings.find((item) => item.chatId === chatId)
        if (!binding) return Promise.resolve(false)
        binding.pausedUntil = iso
        return Promise.resolve(true)
      },
    },
    history: {
      append: (entry) => {
        history.push(entry)
        return Promise.resolve(true)
      },
      read: () => Promise.resolve([...history]),
    },
    whatsapp: {
      lastMessages: (chatId, max) => {
        lastMessagesCalls.push({ chatId, max })
        return Promise.resolve(options.messages?.(chatId) ?? [mensagem('m1', { chatId, text: TEXTO_CONTATO })])
      },
      agentSend:
        options.agentSend ??
        ((proof, chatId, text) => {
          sent.push({ chatId, text, valid: spendAgentSendProof(proof, chatId), at: now })
          sentCount++
          return Promise.resolve({ ok: true, id: `env-${sentCount}` })
        }),
      agentPresence: (chatId, value) => {
        presence.push({ chatId, state: value, at: now })
        return Promise.resolve(true)
      },
      clickSend: (senderId, request, onText) => {
        clicks.push({ senderId, request })
        if (options.clickSend) return options.clickSend(request, onText)
        onText?.(request.text)
        if (!tokens.delete(request.clickToken)) return Promise.resolve({ ok: false, error: 'click' })
        return Promise.resolve({ ok: true, id: `clique-${clicks.length}` })
      },
      ownerName: () => 'Andrea',
    },
    authority: createAgentSendAuthority(() => now),
    reply: (input) => {
      replies.push(input)
      const outcome = options.outcome ?? { acao: 'responder', texto: 'Oi, Ana! Já te respondo.' }
      return Promise.resolve(typeof outcome === 'function' ? outcome(input) : outcome)
    },
    notify: (notice) => notices.push(notice),
    appName: () => 'Meeting Scribe',
    locked: () => lock.locked,
    changed: (chatId) => changed.push(chatId),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimer++
      timers.set(id, { fn, at: now + ms })
      return id
    },
    clearTimer: (handle) => void timers.delete(handle as number),
    random: () => 0,
    createScheduler: (deps: SchedulerDeps) => {
      const scheduler = createAtendimentoScheduler(deps)
      schedulerRef = scheduler
      return {
        ...scheduler,
        onIncoming: (input) => {
          incoming.push(input.messageId)
          return scheduler.onIncoming(input)
        },
        recordSent: (chatId) => {
          recorded.push(chatId)
          scheduler.recordSent(chatId)
        },
      }
    },
    log: (line) => logs.push(line),
  })

  /** Avança o relógio disparando os temporizadores vencidos, em ordem, e deixando as promessas andarem. */
  const advance = async (ms: number): Promise<void> => {
    const target = now + ms
    await flush()
    for (;;) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      timers.delete(next[0])
      now = next[1].at
      next[1].fn()
      await flush()
    }
    now = target
    await flush()
  }

  function mensagem(id: string, extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
    return { id, chatId: ANA, author: 'Ana Souza', fromMe: false, at: now, type: 'text', text: TEXTO_CONTATO, media: null, ...extra }
  }

  const receive = async (message: WhatsAppMessage, chatName = 'Ana Souza'): Promise<void> => {
    await service.onMessage(message, chatName)
    await flush()
  }

  return {
    service,
    state,
    history,
    paused,
    sent,
    presence,
    clicks,
    tokens,
    replies,
    notices,
    changed,
    logs,
    lastMessagesCalls,
    recorded,
    incoming,
    timers,
    lock,
    advance,
    mensagem,
    receive,
    now: () => now,
    setNow: (value: number) => void (now = value),
    scheduler: () => schedulerRef,
    actions: (chatId = ANA) => history.filter((entry) => entry.chatId === chatId).map((entry) => entry.action),
  }
}

describe('serviço do atendimento (contrato 141)', () => {
  it('CA1: conversa sem atendimento não chama agendador, motor nem WhatsApp, e não grava histórico', async () => {
    const h = harness({ bindings: [] })
    await h.receive(h.mensagem('m1'))
    await h.receive(h.mensagem('m2', { chatId: GRUPO }))
    await h.advance(10 * MINUTE)
    expect(h.incoming).toEqual([])
    expect(h.replies).toEqual([])
    expect(h.sent).toEqual([])
    expect(h.lastMessagesCalls).toEqual([])
    expect(h.presence).toEqual([])
    expect(h.history).toEqual([])
    expect(h.changed).toEqual([])
  })

  it('CA2: automático com atraso 0 e "responder": um envio com o texto do motor, linha sent com o id e recordSent', async () => {
    const h = harness()
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.sent).toEqual([{ chatId: ANA, text: 'Oi, Ana! Já te respondo.', valid: true, at: START }])
    expect(h.history).toEqual([{ at: new Date(START).toISOString(), chatId: ANA, agentId: 'ag-1', action: 'sent', messageId: 'env-1' }])
    expect(h.recorded).toEqual([ANA])
  })

  it('CA3: "digitando" ligado espera 1 s a cada 15 caracteres (2 a 12 s) e encerra; desligado, nenhuma presença', async () => {
    expect([typingDelayMs('x'.repeat(60)), typingDelayMs('oi'), typingDelayMs('x'.repeat(1000))]).toEqual([4000, 2000, 12_000])
    const texto = 'x'.repeat(60)
    const h = harness({ bindings: [atendimentoDe(ANA, { typing: true })], outcome: { acao: 'responder', texto } })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.presence).toEqual([{ chatId: ANA, state: 'composing', at: START }])
    expect(h.sent).toEqual([])
    await h.advance(3999)
    expect(h.sent).toEqual([])
    await h.advance(1)
    expect(h.sent.map((item) => item.at)).toEqual([START + 4000])
    expect(h.presence).toEqual([
      { chatId: ANA, state: 'composing', at: START },
      { chatId: ANA, state: 'paused', at: START + 4000 },
    ])

    const off = harness()
    await off.receive(off.mensagem('m1'))
    await off.advance(0)
    expect(off.sent).toHaveLength(1)
    expect(off.presence).toEqual([])
  })

  it('CA4: depois do "digitando", relê o estado: desligado, pausado, rascunho ou "Pausar todos" não envia e registra cancelled', async () => {
    const mudancas: ((state: AtendimentoState, now: number) => void)[] = [
      (state) => void (primeiro(state).enabled = false),
      (state, now) => void (primeiro(state).pausedUntil = new Date(now + 30 * MINUTE).toISOString()),
      (state) => void (primeiro(state).mode = 'draft'),
      (state) => void (state.pausedAll = true),
    ]
    for (const muda of mudancas) {
      const h = harness({ bindings: [atendimentoDe(ANA, { typing: true })] })
      await h.receive(h.mensagem('m1'))
      await h.advance(0)
      expect(h.presence.map((item) => item.state)).toEqual(['composing'])
      muda(h.state, h.now())
      await h.advance(12_000)
      expect(h.sent).toEqual([])
      expect(h.actions()).toEqual(['cancelled'])
    }
  })

  it('CA5: modo rascunho guarda a proposta (a nova substitui), registra drafted, avisa e o runtime devolve', async () => {
    let n = 0
    const h = harness({ bindings: [atendimentoDe(ANA, { mode: 'draft' })], outcome: () => ({ acao: 'responder', texto: `Proposta ${++n}` }) })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.sent).toEqual([])
    expect(h.actions()).toEqual(['drafted'])
    expect(h.changed).toContain(ANA)
    expect((await h.service.runtime())[ANA]).toEqual({ dueAt: null, draft: { text: 'Proposta 1', at: new Date(START).toISOString(), agentId: 'ag-1' }, handedOffAt: null })
    await h.advance(MINUTE)
    await h.receive(h.mensagem('m2'))
    await h.advance(0)
    expect((await h.service.runtime())[ANA]?.draft?.text).toBe('Proposta 2')
    expect(h.actions()).toEqual(['drafted', 'drafted'])
    expect(h.sent).toEqual([])
  })

  it('CA6: enviar a proposta usa o caminho de clique com o texto editado; sem token, recusado e mantida; descartar limpa', async () => {
    const h = harness({ bindings: [atendimentoDe(ANA, { mode: 'draft' })] })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    // Sem token válido: recusado, a proposta fica, nada no histórico além do drafted.
    expect(await h.service.draftSend(7, { chatId: ANA, text: 'Editado', clickToken: '99999999-2222-4333-8444-555555555555' })).toEqual({ ok: false, error: 'click' })
    expect((await h.service.runtime())[ANA]?.draft).not.toBeNull()
    expect(h.actions()).toEqual(['drafted'])
    // Com o clique: o texto editado vai pelo envio de clique, a proposta sai e fica a linha draft-sent com o id.
    expect(await h.service.draftSend(7, { chatId: ANA, text: 'Texto editado pela pessoa', clickToken: CLICK })).toEqual({ ok: true, id: 'clique-2' })
    expect(h.clicks.at(-1)).toEqual({ senderId: 7, request: { chatId: ANA, text: 'Texto editado pela pessoa', clickToken: CLICK } })
    expect(h.sent).toEqual([])
    expect((await h.service.runtime())[ANA]?.draft).toBeNull()
    expect(h.history.at(-1)).toMatchObject({ action: 'draft-sent', messageId: 'clique-2', agentId: 'ag-1' })
    // Sem proposta: nada sai.
    expect(await h.service.draftSend(7, { chatId: ANA, text: 'de novo', clickToken: CLICK })).toEqual({ ok: false, error: 'no-draft' })
    // Descartar.
    await h.advance(MINUTE)
    await h.receive(h.mensagem('m2'))
    await h.advance(0)
    expect(await h.service.draftDiscard({ chatId: ANA })).toEqual({ ok: true })
    expect((await h.service.runtime())[ANA]?.draft).toBeNull()
    expect(h.actions().at(-1)).toBe('draft-discarded')
    expect(await h.service.draftDiscard({ chatId: ANA })).toEqual({ ok: false, error: 'not-found' })
    expect(await h.service.draftDiscard({ chatId: 'x' })).toEqual({ ok: false, error: 'invalid' })
  })

  it('CA7: "passar" não envia, registra handed-off com o motivo, notifica e marca handedOffAt', async () => {
    const h = harness({ outcome: { acao: 'passar', motivo: 'pediu desconto' } })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.sent).toEqual([])
    expect(h.history).toEqual([{ at: new Date(START).toISOString(), chatId: ANA, agentId: 'ag-1', action: 'handed-off', reason: 'pediu desconto' }])
    expect(h.notices).toEqual([{ chatId: ANA, title: 'Ana Souza', body: 'Bia passou a conversa com Ana Souza para você' }])
    expect((await h.service.runtime())[ANA]?.handedOffAt).toBe(new Date(START).toISOString())
  })

  it('CA8: "falhou" (ou o motor lançando) não envia, registra failed e notifica como no CA7', async () => {
    for (const outcome of [{ acao: 'falhou', motivo: 'o Claude não respondeu a tempo' } as ReplyOutcome, () => Promise.reject(new Error('quebrou'))]) {
      const h = harness({ outcome: outcome as NonNullable<Options['outcome']> })
      await h.receive(h.mensagem('m1'))
      await h.advance(0)
      expect(h.sent).toEqual([])
      expect(h.actions()).toEqual(['failed'])
      expect(h.notices).toEqual([{ chatId: ANA, title: 'Ana Souza', body: 'Bia passou a conversa com Ana Souza para você' }])
    }
  })

  it('CA9: resposta minha cancela a pendência, descarta a proposta, pausa pelo tempo configurado e zera a passagem', async () => {
    const h = harness({ bindings: [atendimentoDe(ANA, { delayMinMinutes: 2, delayMaxMinutes: 2 }), atendimentoDe(BETO, { mode: 'draft', pauseOnMyReplyMinutes: 0 })], outcome: { acao: 'passar', motivo: 'outro assunto' } })
    await h.receive(h.mensagem('m1'))
    await h.advance(2 * MINUTE)
    expect((await h.service.runtime())[ANA]?.handedOffAt).not.toBeNull()
    await h.receive(h.mensagem('m2'))
    expect((await h.service.runtime())[ANA]?.dueAt).not.toBeNull()
    await h.receive(h.mensagem('eu-1', { fromMe: true }))
    expect(h.actions()).toEqual(['handed-off', 'cancelled', 'paused'])
    expect(h.paused).toEqual([{ chatId: ANA, iso: new Date(h.now() + 60 * MINUTE).toISOString() }])
    expect((await h.service.runtime())[ANA]).toEqual({ dueAt: null, draft: null, handedOffAt: null })
    await h.advance(10 * MINUTE)
    expect(h.replies).toHaveLength(1)
    // Com a pausa em 0, nada é gravado; a proposta sai igual.
    const b = harness({ bindings: [atendimentoDe(BETO, { mode: 'draft', pauseOnMyReplyMinutes: 0 })] })
    await b.receive(b.mensagem('m1', { chatId: BETO }), 'Beto')
    await b.advance(0)
    expect((await b.service.runtime())[BETO]?.draft).not.toBeNull()
    await b.receive(b.mensagem('eu-1', { chatId: BETO, fromMe: true }), 'Beto')
    expect(b.paused).toEqual([])
    expect((await b.service.runtime())[BETO]?.draft).toBeNull()
    expect(b.actions(BETO)).toEqual(['drafted'])
  })

  it('CA10: o eco do envio do próprio atendimento não pausa, chegue depois (id conhecido) ou antes do retorno (enviando)', async () => {
    const h = harness()
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    await h.receive(h.mensagem('env-1', { fromMe: true }))
    expect(h.paused).toEqual([])
    expect(h.actions()).toEqual(['sent'])

    // O eco que chega antes de o envio voltar.
    let release: (value: WhatsAppSendResult) => void = () => undefined
    const early = harness({ agentSend: () => new Promise((done) => (release = done)) })
    await early.receive(early.mensagem('m1'))
    await early.advance(0)
    await early.receive(early.mensagem('eco-cedo', { fromMe: true, text: 'Oi, Ana! Já te respondo.' }))
    release({ ok: true, id: 'eco-cedo' })
    await early.advance(0)
    expect(early.paused).toEqual([])
    expect(early.actions()).toEqual(['sent'])

    // O eco da proposta enviada com o clique também não pausa.
    const draft = harness({ bindings: [atendimentoDe(ANA, { mode: 'draft' })] })
    await draft.receive(draft.mensagem('m1'))
    await draft.advance(0)
    expect(await draft.service.draftSend(1, { chatId: ANA, text: 'ok', clickToken: CLICK })).toMatchObject({ ok: true, id: 'clique-1' })
    await draft.receive(draft.mensagem('clique-1', { fromMe: true }))
    expect(draft.paused).toEqual([])
    // Uma resposta minha de verdade depois disso pausa.
    await draft.receive(draft.mensagem('eu-2', { fromMe: true }))
    expect(draft.paused).toHaveLength(1)
  })

  it('CA9/CA10: resposta minha durante o "digitando" cancela a resposta e pausa', async () => {
    const h = harness({ bindings: [atendimentoDe(ANA, { typing: true })] })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.presence.map((item) => item.state)).toEqual(['composing'])
    await h.receive(h.mensagem('eu-1', { fromMe: true, text: 'Deixa que eu respondo' }))
    await h.advance(12_000)
    expect(h.sent).toEqual([])
    expect(h.actions()).toEqual(['cancelled', 'paused'])
    expect(h.paused).toHaveLength(1)
    expect(h.presence.map((item) => item.state)).toEqual(['composing', 'paused'])
  })

  it('CA9/CA10: na janela do envio, só o texto idêntico é eco, um por envio; outra mensagem minha pausa', async () => {
    const janela = async () => {
      let release: (value: WhatsAppSendResult) => void = () => undefined
      const h = harness({ outcome: { acao: 'responder', texto: 'Oi, Ana!' }, agentSend: () => new Promise((done) => (release = done)) })
      await h.receive(h.mensagem('m1'))
      await h.advance(0)
      return { h, release: (id: string) => release({ ok: true, id }) }
    }
    // (ii) texto diferente durante o envio: é resposta do dono.
    const diferente = await janela()
    await diferente.h.receive(diferente.h.mensagem('eu-1', { fromMe: true, text: 'Ana, já te ligo' }))
    expect(diferente.h.paused).toHaveLength(1)
    diferente.release('env-1')
    await diferente.h.advance(0)
    expect(diferente.h.actions()).toEqual(['paused', 'sent'])
    // (iii) texto idêntico (com espaços nas pontas) durante o envio: eco, não pausa.
    const igual = await janela()
    await igual.h.receive(igual.h.mensagem('eco-1', { fromMe: true, text: '  Oi, Ana!  ' }))
    expect(igual.h.paused).toEqual([])
    igual.release('eco-1')
    await igual.h.advance(0)
    expect(igual.h.actions()).toEqual(['sent'])
    // (iv) o mesmo texto de novo, com o eco já consumido: é resposta do dono.
    const duas = await janela()
    await duas.h.receive(duas.h.mensagem('eco-1', { fromMe: true, text: 'Oi, Ana!' }))
    await duas.h.receive(duas.h.mensagem('eu-2', { fromMe: true, text: 'Oi, Ana!' }))
    expect(duas.h.paused).toHaveLength(1)
    // Depois do retorno, vale o id: o eco atrasado pelo id não pausa.
    duas.release('env-9')
    await duas.h.advance(0)
    await duas.h.receive(duas.h.mensagem('env-9', { fromMe: true, text: 'qualquer' }))
    expect(duas.h.paused).toHaveLength(1)
  })

  it('CA10: na proposta enviada com clique, o texto pedido ou o corrigido é eco (um só); outro texto pausa', async () => {
    let release: (value: WhatsAppSendResult) => void = () => undefined
    const h = harness({
      bindings: [atendimentoDe(ANA, { mode: 'draft' })],
      clickSend: (_request, onText) => {
        onText?.('Texto corrigido.')
        return new Promise((done) => (release = done))
      },
    })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    const pending = h.service.draftSend(1, { chatId: ANA, text: 'texto corrigido', clickToken: CLICK })
    await h.advance(0)
    await h.receive(h.mensagem('eco', { fromMe: true, text: 'Texto corrigido.' }))
    expect(h.paused).toEqual([])
    await h.receive(h.mensagem('eu-1', { fromMe: true, text: 'texto corrigido' }))
    expect(h.paused).toHaveLength(1)
    release({ ok: true, id: 'eco' })
    expect(await pending).toEqual({ ok: true, id: 'eco' })
  })

  it('CA11: fora do horário e limite por hora viram linha (uma por conversa a cada 10 min); os outros motivos não', async () => {
    const fechado = { days: [0], start: '08:00', end: '09:00' }
    const h = harness({ bindings: [atendimentoDe(ANA, { hours: fechado })] })
    await h.receive(h.mensagem('m1'))
    await h.advance(5 * MINUTE)
    await h.receive(h.mensagem('m2'))
    expect(h.actions()).toEqual(['out-of-hours'])
    await h.advance(5 * MINUTE)
    await h.receive(h.mensagem('m3'))
    expect(h.actions()).toEqual(['out-of-hours', 'out-of-hours'])

    const r = harness({ bindings: [atendimentoDe(ANA, { maxPerHour: 1 })] })
    await r.receive(r.mensagem('m1'))
    await r.advance(0)
    await r.receive(r.mensagem('m2'))
    await r.receive(r.mensagem('m3'))
    expect(r.actions()).toEqual(['sent', 'rate-limited'])

    const outros = harness({ bindings: [atendimentoDe(ANA, { enabled: false }), atendimentoDe(BETO, { pausedUntil: new Date(START + 60 * MINUTE).toISOString() })] })
    outros.state.pausedAll = false
    await outros.receive(outros.mensagem('m1'))
    await outros.receive(outros.mensagem('m2', { chatId: BETO }), 'Beto')
    outros.state.pausedAll = true
    await outros.receive(outros.mensagem('m3', { chatId: BETO }), 'Beto')
    expect(outros.history).toEqual([])
  })

  it('CA12: "Pausar todos" cancela toda pendência (uma linha por conversa) e nada novo é agendado; retomar não responde o que chegou', async () => {
    const h = harness({ bindings: [atendimentoDe(ANA, { delayMinMinutes: 2, delayMaxMinutes: 2 }), atendimentoDe(BETO, { delayMinMinutes: 2, delayMaxMinutes: 2 })] })
    await h.receive(h.mensagem('m1'))
    await h.receive(h.mensagem('m2', { chatId: BETO }), 'Beto')
    h.state.pausedAll = true
    h.service.stateChanged(structuredClone(h.state))
    await h.advance(0)
    expect(h.actions(ANA)).toEqual(['cancelled'])
    expect(h.actions(BETO)).toEqual(['cancelled'])
    await h.receive(h.mensagem('m3'))
    expect(h.scheduler()?.pending(ANA)).toBeNull()
    h.state.pausedAll = false
    h.service.stateChanged(structuredClone(h.state))
    await h.advance(30 * MINUTE)
    expect(h.replies).toEqual([])
    expect(h.sent).toEqual([])
    // Depois de retomar, a próxima mensagem volta a ser respondida.
    await h.receive(h.mensagem('m4'))
    await h.advance(2 * MINUTE)
    expect(h.sent).toHaveLength(1)
  })

  it('CA13: desligar ou apagar o atendimento, ou excluir o agente, descarta a pendência e a proposta', async () => {
    const mudancas: ((state: AtendimentoState) => void)[] = [
      (state) => void (primeiro(state).enabled = false),
      (state) => void (state.bindings = state.bindings.filter((item) => item.chatId !== ANA)),
      (state) => {
        state.agents = []
        state.bindings = state.bindings.map((item) => ({ ...item, enabled: false }))
      },
    ]
    for (const muda of mudancas) {
      const h = harness({ bindings: [atendimentoDe(ANA, { mode: 'draft', delayMinMinutes: 2, delayMaxMinutes: 2 })] })
      await h.receive(h.mensagem('m1'))
      await h.advance(2 * MINUTE)
      await h.receive(h.mensagem('m2'))
      const before = await h.service.runtime()
      expect(before[ANA]?.draft).not.toBeNull()
      expect(before[ANA]?.dueAt).not.toBeNull()
      muda(h.state)
      h.service.stateChanged(structuredClone(h.state))
      expect(h.scheduler()?.pending(ANA)).toBeNull()
      await h.advance(10 * MINUTE)
      expect(h.replies).toHaveLength(1)
      expect(h.actions()).toEqual(['drafted', 'cancelled'])
      h.state.bindings = [atendimentoDe(ANA, { mode: 'draft' })]
      expect((await h.service.runtime())[ANA]?.draft).toBeNull()
    }
  })

  it('CA14: mensagem de antes do serviço começar, ou mais velha que 5 minutos, é ignorada', async () => {
    const h = harness()
    await h.receive(h.mensagem('antiga', { at: START - 1000 }))
    await h.advance(10 * MINUTE)
    await h.receive(h.mensagem('velha', { at: h.now() - 6 * MINUTE }))
    await h.advance(MINUTE)
    expect(h.incoming).toEqual([])
    expect(h.sent).toEqual([])
    await h.receive(h.mensagem('nova', { at: h.now() - 4 * MINUTE }))
    await h.advance(0)
    expect(h.sent).toHaveLength(1)
  })

  it('CA15: o pedido leva as últimas 50 mensagens lidas na hora, o primeiro do dia pelo histórico e o nome da conta', async () => {
    const muitas = (chatId: string): WhatsAppMessage[] => Array.from({ length: 60 }, (_, index) => ({ id: `h${index}`, chatId, author: 'Ana Souza', fromMe: index % 2 === 1, at: START - (60 - index) * 1000, type: 'text', text: `t${index}`, media: null }))
    const ontem = new Date(START - 24 * 60 * MINUTE).toISOString()
    const h = harness({ messages: muitas, history: [{ at: ontem, chatId: ANA, agentId: 'ag-1', action: 'sent', messageId: 'velho' }] })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.lastMessagesCalls).toEqual([{ chatId: ANA, max: 50 }])
    const first = h.replies[0]
    expect(first?.history).toHaveLength(50)
    expect(first?.history[0]?.id).toBe('h10')
    expect(first?.history.at(-1)).toEqual({ id: 'h59', fromMe: true, author: 'Ana Souza', at: new Date(START - 1000).toISOString(), type: 'text', text: 't59' })
    expect(first).toMatchObject({ ownerName: 'Andrea', contactName: 'Ana Souza', pendingIds: ['m1'], firstReplyToday: true })
    await h.advance(MINUTE)
    await h.receive(h.mensagem('m2'))
    await h.advance(0)
    expect(h.replies[1]?.firstReplyToday).toBe(false)
    // A proposta enviada hoje também conta.
    const d = harness({ history: [{ at: new Date(START - MINUTE).toISOString(), chatId: ANA, agentId: 'ag-1', action: 'draft-sent', messageId: 'x' }] })
    await d.receive(d.mensagem('m1'))
    await d.advance(0)
    expect(d.replies[0]?.firstReplyToday).toBe(false)
  })

  it('CA16: o envio do agente não passa pela correção ao enviar; o envio com clique continua passando', async () => {
    const bridge = await fakeBridge()
    const root = mkdtempSync(join(tmpdir(), 'scribe-atend-'))
    dirs.push(root)
    try {
      const safe = memorySafeStorage()
      createVault(join(root, 'service.bin'), safe, (raw) => raw).write({ token: TOKEN, port: bridge.port, on: true, instanceId: INSTANCE })
      mkdirSync(join(root, 'venv', 'bin'), { recursive: true })
      writeFileSync(join(root, 'venv', 'bin', 'python'), '')
      writeFileSync(join(root, 'installed.json'), '{}')
      const corrected: string[] = []
      const whatsapp = createWhatsAppService({
        root,
        bridgeSource: root,
        bridgeFiles: [],
        backend: 'fake',
        index: { kind: 'local', dir: root },
        pythonCandidates: [],
        exec: () => Promise.resolve({ ok: false, stderr: '' }),
        safeStorage: safe,
        baseEnv: {},
        draft: () => Promise.resolve({ ok: false, error: 'failed' }),
        correct: (text) => {
          corrected.push(text)
          return Promise.resolve(`${text} (corrigido)`)
        },
        meeting: () => Promise.resolve(null),
        onStatus: () => undefined,
        onMessage: () => undefined,
      })
      await whatsapp.init()
      const authority = createAgentSendAuthority()
      expect(await whatsapp.agentSend(prova(authority, ANA), ANA, 'resposta do agente')).toEqual({ ok: true, id: 'enviada-1' })
      expect(corrected).toEqual([])
      whatsapp.registerClick(1, CLICK)
      expect(await whatsapp.send(1, { chatId: ANA, text: 'minha', clickToken: CLICK })).toEqual({ ok: true, id: 'enviada-2' })
      expect(corrected).toEqual(['minha'])
      expect(bridge.sent).toEqual(['resposta do agente', 'minha (corrigido)'])
      // O "digitando…" do agente não depende do interruptor da tela.
      expect(await whatsapp.agentPresence(ANA, 'composing')).toBe(true)
      expect(bridge.requests.filter((request) => request.path.endsWith('/presence')).map((request) => request.body)).toEqual(['{"state":"composing"}'])
      await whatsapp.dispose()
    } finally {
      bridge.server.close()
    }
  })

  it('CA17: o cliente recusa sem prova, com a prova vencida, já usada ou de outra conversa; grupo nunca recebe prova', async () => {
    const bridge = await fakeBridge()
    try {
      let now = START
      const authority = createAgentSendAuthority(() => now)
      const client = createBridgeClient(bridge.port, TOKEN)
      expect(authority.issue(GRUPO)).toBeNull()
      await expect(client.send(undefined as never, ANA, 'sem prova')).rejects.toThrow(/click/)
      await expect(client.send({ chatId: ANA } as never, ANA, 'objeto parecido')).rejects.toThrow(/click/)
      const late = prova(authority, ANA)
      now += AGENT_PROOF_TTL_MS + 1
      await expect(client.send(late, ANA, 'vencida')).rejects.toThrow(/click/)
      const other = prova(authority, BETO)
      await expect(client.send(other, ANA, 'outra conversa')).rejects.toThrow(/click/)
      // A tentativa recusada gasta a prova: nem para a conversa certa ela vale depois.
      await expect(client.send(other, BETO, 'depois de recusada')).rejects.toThrow(/click/)
      const good = prova(authority, ANA)
      await expect(client.send(good, ANA, 'vale', 'm1')).rejects.toThrow(/click/)
      const proof = prova(authority, ANA)
      expect(await client.send(proof, ANA, 'uma vez')).toBe('enviada-1')
      await expect(client.send(proof, ANA, 'duas vezes')).rejects.toThrow(/click/)
      // Anexo e reação continuam só com o clique.
      const media = prova(authority, ANA)
      await expect(client.sendMedia(media as never, ANA, { name: 'a.png', mime: 'image/png', bytes: new Uint8Array([1]) })).rejects.toThrow(/click/)
      await expect(client.react(prova(authority, ANA) as never, ANA, 'm1', '')).rejects.toThrow(/click/)
      expect(bridge.sent).toEqual(['uma vez'])
    } finally {
      bridge.server.close()
    }
  })

  it('CA18: a função que emite a prova do agente só aparece na guarda e na montagem; o serviço recebe só a autoridade', () => {
    const SRC = resolve(import.meta.dirname, '../src')
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [join(dir, entry.name)] : []))
    const all = files(SRC).map((file) => ({ file: relative(SRC, file), text: readFileSync(file, 'utf8') }))
    const allowed = ['main/index.ts', 'main/whatsapp/atendimento/service.ts', 'main/whatsapp/send-guard.ts']
    const emitters = all.filter(({ text }) => /createAgentSendAuthority|AgentSendAuthority\b/.test(text)).map(({ file }) => file)
    expect(emitters.every((file) => allowed.includes(file))).toBe(true)
    expect(all.filter(({ text }) => /createAgentSendAuthority\(/.test(text)).map(({ file }) => file).sort()).toEqual(['main/index.ts', 'main/whatsapp/send-guard.ts'])
    // Na montagem, uma vez, dentro do serviço de atendimento.
    const index = all.find(({ file }) => file === 'main/index.ts')?.text ?? ''
    expect(index.match(/createAgentSendAuthority\(/g)).toHaveLength(1)
    expect(index).toContain('authority: createAgentSendAuthority(),')
    // Quem emite de fato (`.issue(`) é só o serviço de atendimento.
    expect(all.filter(({ file, text }) => /authority\.issue\(/.test(text) && file !== 'main/whatsapp/send-guard.ts').map(({ file }) => file)).toEqual(['main/whatsapp/atendimento/service.ts'])
    // O envio do agente no serviço do WhatsApp só é chamado pelo atendimento, montado no main.
    expect(all.filter(({ text }) => /\.agentSend\(/.test(text)).map(({ file }) => file).sort()).toEqual(['main/index.ts', 'main/whatsapp/atendimento/service.ts'])
    // Automações, tarefas agendadas, chat e Assistente continuam sem acesso a nada disso.
    const outside = all.filter(({ file }) => /^main\/(agents|schedules|tray|chat|assistant|meetings|acp|claude-cli|tasks)\//.test(file) || /^renderer\//.test(file))
    expect(outside.length).toBeGreaterThan(20)
    for (const { file, text } of outside) expect(`${file}: ${/AgentSendProof|AgentSendAuthority|agentSend|atendimento\/service/.test(text)}`).toBe(`${file}: false`)
  })

  it('CA19: "Testar agente" devolve a decisão e não grava, não agenda, não envia nem notifica', async () => {
    const h = harness({ outcome: { acao: 'passar', motivo: 'pediu preço' } })
    const request = { agent: { id: null, name: 'Bia', instructions: SEGREDO, model: 'haiku' }, about: 'Cliente antiga', message: 'Quanto custa?' }
    expect(await h.service.testAgent(request)).toEqual({ ok: true, decision: { acao: 'passar', motivo: 'pediu preço' } })
    expect(h.replies[0]).toMatchObject({ ownerName: 'Andrea', pendingIds: ['teste'], binding: { about: 'Cliente antiga' }, agent: { name: 'Bia', instructions: SEGREDO } })
    expect(h.replies[0]?.history.map((message) => message.text)).toEqual(['Quanto custa?'])
    expect(h.history).toEqual([])
    expect(h.incoming).toEqual([])
    expect(h.sent).toEqual([])
    expect(h.notices).toEqual([])
    expect(h.timers.size).toBe(0)
    expect(await h.service.testAgent({ ...request, message: '  ' })).toEqual({ ok: false, error: 'invalid' })
    const failing = harness({ outcome: { acao: 'falhou', motivo: 'x' } })
    expect(await failing.service.testAgent(request)).toEqual({ ok: false, error: 'failed' })
    expect(failing.notices).toEqual([])
  })

  it('CA20: bloqueado, recebe, agenda e responde; não avisa as janelas; a notificação sem o nome no título; canais recusados', async () => {
    const h = harness({ locked: true, bindings: [atendimentoDe(ANA), atendimentoDe(BETO)] })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    expect(h.sent).toHaveLength(1)
    expect(h.actions()).toEqual(['sent'])
    expect(h.changed).toEqual([])
    const passa = harness({ locked: true, outcome: { acao: 'passar', motivo: TEXTO_CONTATO } })
    await passa.receive(passa.mensagem('m1'))
    await passa.advance(0)
    expect(passa.notices).toEqual([{ chatId: ANA, title: 'Meeting Scribe', body: 'Bia passou a conversa com Ana Souza para você' }])
    expect(JSON.stringify(passa.notices)).not.toContain(TEXTO_CONTATO)
    expect(passa.changed).toEqual([])
    for (const channel of ['scribe:atendimento-runtime', 'scribe:atendimento-agent-test', 'scribe:atendimento-draft-send', 'scribe:atendimento-draft-discard'] as const) {
      expect(INVOKE_CHANNELS).toContain(channel)
      expect(WHEN_LOCKED[channel]).toBe('refused')
    }
    expect(MAIN_EVENT_CHANNELS).toContain('scribe:atendimento-changed')
    // O main só manda o evento com o app desbloqueado.
    const index = readFileSync(resolve(import.meta.dirname, '../src/main/index.ts'), 'utf8')
    expect(index).toContain("if (!lockService?.isLocked()) broadcast(appWindows(), 'scribe:atendimento-changed', { chatId })")
  })

  it('CA21: dispose limpa temporizadores e propostas, e nada é enviado depois', async () => {
    const h = harness({ bindings: [atendimentoDe(ANA, { typing: true }), atendimentoDe(BETO, { delayMinMinutes: 3, delayMaxMinutes: 3 }), atendimentoDe('5511933330000@s.whatsapp.net', { mode: 'draft' })] })
    await h.receive(h.mensagem('m1'))
    await h.receive(h.mensagem('m2', { chatId: BETO }), 'Beto')
    await h.receive(h.mensagem('m3', { chatId: '5511933330000@s.whatsapp.net' }), 'Caio')
    await h.advance(0)
    expect(h.presence.map((item) => item.state)).toEqual(['composing'])
    expect((await h.service.runtime())['5511933330000@s.whatsapp.net']?.draft).not.toBeNull()
    h.service.dispose()
    expect(h.timers.size).toBe(0)
    await h.advance(60 * MINUTE)
    expect(h.sent).toEqual([])
    const runtime = await h.service.runtime()
    expect(Object.values(runtime).every((entry) => entry.draft === null && entry.dueAt === null)).toBe(true)
    await h.receive(h.mensagem('m4'))
    await h.advance(MINUTE)
    expect(h.sent).toEqual([])
    expect(await h.service.draftSend(1, { chatId: '5511933330000@s.whatsapp.net', text: 'x', clickToken: CLICK })).toEqual({ ok: false, error: 'no-draft' })
  })

  it('CA22: nenhum log leva o texto da mensagem, da resposta ou das regras do agente', async () => {
    const resposta = 'RESPOSTA-PRIVADA para a Ana'
    const h = harness({ outcome: { acao: 'responder', texto: resposta } })
    await h.receive(h.mensagem('m1'))
    await h.advance(0)
    const p = harness({ outcome: { acao: 'passar', motivo: 'MOTIVO-PRIVADO' } })
    await p.receive(p.mensagem('m1'))
    await p.advance(0)
    const logs = [...h.logs, ...p.logs].join('\n')
    expect(logs.length).toBeGreaterThan(0)
    for (const secret of [resposta, TEXTO_CONTATO, SEGREDO, 'MOTIVO-PRIVADO']) expect(logs).not.toContain(secret)
  })
})

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const TOKEN = '0123456789abcdef'.repeat(4)
const INSTANCE = 'a1b2c3d4'.repeat(4)

/** Serviço HTTP falso do WhatsApp: saúde, conversas, envio e presença; guarda o que recebeu. */
function fakeBridge(): Promise<{ server: Server; port: number; requests: { path: string; body: string }[]; sent: string[] }> {
  const requests: { path: string; body: string }[] = []
  const sent: string[] = []
  const server = createServer((req: IncomingMessage, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')))
    req.on('end', () => {
      requests.push({ path: req.url ?? '', body })
      const json = (status: number, value: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(value))
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname === '/health' && req.headers.authorization !== `Bearer ${TOKEN}`) return json(200, { id: INSTANCE })
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: 'unauthorized' })
      if (url.pathname === '/health') return json(200, { version: '0.1.0', state: 'connected', me: { name: 'Andrea', phone: '+5511900000000' }, id: INSTANCE, pid: 999_999 })
      if (url.pathname === '/chats') return json(200, { chats: [{ id: ANA, name: 'Ana Souza', kind: 'person', unread: 0, lastMessage: null }] })
      if (url.pathname.endsWith('/send')) {
        sent.push((JSON.parse(body) as { text: string }).text)
        return json(200, { id: `enviada-${sent.length}` })
      }
      if (url.pathname.endsWith('/presence')) return json(200, { ok: true })
      if (url.pathname === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`event: state\ndata: ${JSON.stringify({ version: '0.1.0', state: 'connected', me: { name: 'Andrea', phone: '+5511900000000' } })}\n\n`)
        return undefined
      }
      return json(404, { error: 'not-found' })
    })
  })
  return new Promise((done) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      done({ server, port: typeof address === 'object' && address ? address.port : 0, requests, sent })
    }),
  )
}
