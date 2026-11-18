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
