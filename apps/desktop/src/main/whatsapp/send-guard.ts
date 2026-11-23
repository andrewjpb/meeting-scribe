// Token de clique do envio (contrato 24, CA4). O preload gera um token no clique da pessoa em "Enviar" (só com
// a ativação do usuário viva no frame) e registra aqui por `scribe:whatsapp-click`; o canal `whatsapp-send` só
// envia com um token registrado pela mesma janela, há no máximo 10 s, e uma vez só. A prova (`SendProof`) só sai
// de `consume`, e o cliente do serviço só envia com ela: agentes, chat, análises e resumo não têm como chegar ao
// envio, porque nada fora do registro do IPC recebe este guarda. O diálogo nativo "Enviar para <nome>?" que vinha
// depois do token foi removido a pedido do dono do projeto em 18/11/2026 (contrato 33): o clique e este token bastam.
import { WHATSAPP_CLICK_TTL_MS } from '../../shared/whatsapp'

const PROOF = Symbol('whatsapp-send-proof')

/** Prova de um clique de verdade, de uso único. Só `SendGuard.consume` cria. */
export interface SendProof {
  readonly [PROOF]: true
  readonly chatId: string
}

export interface SendGuard {
  /** O clique registrado pelo preload: token novo daquela janela. Token repetido ou malformado é ignorado. */
  register(senderId: number, token: unknown): void
  /** Gasta o token: a prova de envio, ou `null` (não registrado, de outra janela, vencido ou já usado). */
  consume(senderId: number, token: unknown, chatId: string): SendProof | null
  /** A janela fechou: os tokens dela saem. */
  forget(senderId: number): void
}

const TOKEN = /^[0-9a-f-]{36}$/

export function isSendProof(value: unknown): value is SendProof {
  return typeof value === 'object' && value !== null && (value as Partial<SendProof>)[PROOF] === true
}

export function createSendGuard(now: () => number = Date.now, ttlMs = WHATSAPP_CLICK_TTL_MS): SendGuard {
  const tokens = new Map<string, { senderId: number; at: number }>()
  const used = new Set<string>()

  const sweep = (): void => {
    const limit = now() - ttlMs
    for (const [token, entry] of tokens) if (entry.at < limit) tokens.delete(token)
    if (used.size > 1000) used.clear()
  }

  return {
    register(senderId, token) {
      sweep()
      if (typeof token !== 'string' || !TOKEN.test(token) || tokens.has(token) || used.has(token)) return
      // Poucos cliques vivos por vez: um renderer não enche a memória.
      if (tokens.size >= 20) return
      tokens.set(token, { senderId, at: now() })
    },

    consume(senderId, token, chatId) {
      sweep()
      if (typeof token !== 'string') return null
      const entry = tokens.get(token)
      tokens.delete(token)
      // Tentativa com um token registrado o gasta, mesmo recusada: ele não volta a valer.
      if (entry) used.add(token)
      if (!entry || entry.senderId !== senderId || now() - entry.at > ttlMs) return null
      return Object.freeze({ [PROOF]: true as const, chatId })
    },

    forget(senderId) {
      for (const [token, entry] of tokens) if (entry.senderId === senderId) tokens.delete(token)
    },
  }
}

// Contrato 141: a prova de envio do agente de atendimento, a única exceção ao "nenhuma IA envia" (decisão do dono em
// 23/11/2026, só para as conversas marcadas). A autoridade é criada uma vez, na montagem do app, e entregue só ao
// serviço de atendimento; cada prova vale para uma conversa, uma vez e por 30 s. Grupo nunca recebe prova. As provas
// emitidas ficam num `WeakMap` deste módulo: objeto parecido, prova vencida, já usada ou de outra conversa não envia.

/** Validade de uma `AgentSendProof`. */
export const AGENT_PROOF_TTL_MS = 30_000

const AGENT_PROOF = Symbol('whatsapp-agent-send-proof')

/** Prova de envio do agente de atendimento, de uso único. Só `AgentSendAuthority.issue` cria. */
export interface AgentSendProof {
  readonly [AGENT_PROOF]: true
  readonly chatId: string
}

export interface AgentSendAuthority {
  /** A prova para um envio do agente nesta conversa, ou `null` (grupo ou id inválido). */
  issue(chatId: string): AgentSendProof | null
}

/** As provas do agente ainda não gastas: o relógio da autoridade que emitiu e quando vencem. */
const agentProofs = new WeakMap<object, { now: () => number; expiresAt: number }>()

export function isAgentSendProof(value: unknown): value is AgentSendProof {
  return typeof value === 'object' && value !== null && (value as Partial<AgentSendProof>)[AGENT_PROOF] === true
}

export function createAgentSendAuthority(now: () => number = Date.now, ttlMs = AGENT_PROOF_TTL_MS): AgentSendAuthority {
  return {
    issue(chatId) {
      if (typeof chatId !== 'string' || !chatId.includes('@') || chatId.endsWith('@g.us')) return null
      const proof: AgentSendProof = Object.freeze({ [AGENT_PROOF]: true as const, chatId })
      agentProofs.set(proof, { now, expiresAt: now() + ttlMs })
      return proof
    },
  }
}

/** Gasta a prova do agente: `true` só se foi emitida pela autoridade, não venceu, não foi usada e é desta conversa. */
export function spendAgentSendProof(proof: unknown, chatId: string): boolean {
  if (!isAgentSendProof(proof)) return false
  const entry = agentProofs.get(proof)
  if (!entry) return false
  // Tentativa com uma prova emitida a gasta, mesmo recusada.
  agentProofs.delete(proof)
  return entry.now() <= entry.expiresAt && proof.chatId === chatId
}
