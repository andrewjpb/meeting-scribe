// Triagem do WhatsApp (contrato 159): o agente das Automações "Triagem do WhatsApp" etiqueta cada conversa que recebe
// mensagem em dois eixos, urgente (sim ou não) e âmbito (pessoal ou profissional). A etiqueta é local
// (`userData/whatsapp/triagem.json`), reversível, e a escolha do dono prevalece sobre a do agente. Aqui ficam os
// tipos, os limites e as regras puras; o esquema zod fica em `triagem-schema.ts`, para o renderer não carregar o zod.
// Sem Node e sem Electron: roda no main, no renderer e nos testes.

export const TRIAGEM_VERSION = 1

export const TRIAGEM_AGENT_NAME = 'Triagem do WhatsApp'
/** Mensagens da conversa que vão ao agente, as mais recentes. */
export const TRIAGEM_MENSAGENS_MAX = 12
/** Teto de caracteres do pedido montado com essas mensagens. */
export const TRIAGEM_CHARS_MAX = 4000
export const TRIAGEM_TIMEOUT_MS = 30_000
/** Triagens por dia, fora do limite diário das tarefas agendadas. */
export const TRIAGEM_TETO_DIARIO = 300
/** Mensagem mais velha que isto (chegou com o app fechado) não dispara triagem. */
export const TRIAGEM_MAX_AGE_MS = 5 * 60_000
/** Triagens rodando ao mesmo tempo. */
export const TRIAGEM_SIMULTANEAS = 2
export const TRIAGEM_MOTIVO_MAX = 160
/** "Espera depois da última mensagem", em segundos. */
export const TRIAGEM_ESPERA_SEG = { min: 5, max: 600, padrao: 30 } as const
/** Etiquetas guardadas no arquivo; as mais antigas (por `at`) saem. */
export const TRIAGEM_ETIQUETAS_MAX = 2000

export type TriagemAmbito = 'pessoal' | 'profissional'
export const TRIAGEM_AMBITOS = ['pessoal', 'profissional'] as const satisfies readonly TriagemAmbito[]

export interface Etiqueta {
  urgente: boolean
  ambito: TriagemAmbito | null
  /** Âmbito escolhido à mão: o agente não altera. "Nenhum" à mão limpa o âmbito e este flag. */
  ambitoFixo: boolean
  /** Urgente marcado ou desmarcado à mão depois da última mensagem recebida: o agente não altera até chegar mensagem nova. */
  urgenteFixo: boolean
  origem: 'agente' | 'manual'
  /** id da última mensagem recebida (não `fromMe`) considerada; `null` quando só houve ação manual. */
  lastMessageId: string | null
  /** No máximo `TRIAGEM_MOTIVO_MAX`; só vem do agente. */
  motivo: string | null
  /** ms. */
  at: number
}

export type EtiquetaPatch = { urgente?: boolean; ambito?: TriagemAmbito | null }

/** O que o agente devolve para uma conversa. */
export interface TriagemResultado {
  urgente: boolean
  ambito: TriagemAmbito | 'indefinido'
  motivo: string
}

export type TriagemAba = 'todas' | 'nao-lidas' | 'urgentes' | 'pessoal' | 'profissional'
export const TRIAGEM_ABAS: readonly TriagemAba[] = ['todas', 'nao-lidas', 'urgentes', 'pessoal', 'profissional']

/** O arquivo: a chave das etiquetas é o `chatId`. */
export interface TriagemFile {
  version: 1
  etiquetas: Record<string, Etiqueta>
}

export function etiquetaVazia(now: number): Etiqueta {
  return { urgente: false, ambito: null, ambitoFixo: false, urgenteFixo: false, origem: 'manual', lastMessageId: null, motivo: null, at: now }
}

/** A escolha do dono: o eixo que vier no pedido fica fixo (âmbito `null` à mão solta o âmbito). */
export function aplicarManual(atual: Etiqueta | null, patch: EtiquetaPatch, now: number): Etiqueta {
  const next: Etiqueta = { ...(atual ?? etiquetaVazia(now)), origem: 'manual', at: now }
  if (patch.urgente !== undefined) {
    next.urgente = patch.urgente
    next.urgenteFixo = true
  }
  if (patch.ambito !== undefined) {
    next.ambito = patch.ambito
    next.ambitoFixo = patch.ambito !== null
  }
  return next
}

/** A resposta do agente, sem mexer no eixo que o dono fixou. */
export function aplicarAgente(atual: Etiqueta | null, r: TriagemResultado, lastMessageId: string, now: number): Etiqueta {
  return {
    urgente: atual?.urgenteFixo ? atual.urgente : r.urgente,
    ambito: atual?.ambitoFixo ? atual.ambito : r.ambito === 'indefinido' ? null : r.ambito,
    ambitoFixo: atual?.ambitoFixo ?? false,
    urgenteFixo: atual?.urgenteFixo ?? false,
    origem: 'agente',
    lastMessageId,
    motivo: r.motivo.slice(0, TRIAGEM_MOTIVO_MAX),
    at: now,
  }
}

/** Chegou mensagem nova: o agente volta a poder reavaliar a urgência. */
export function mensagemRecebida(atual: Etiqueta | null): Etiqueta | null {
  return atual ? { ...atual, urgenteFixo: false } : null
}

/** O dono respondeu (`fromMe`): a urgência acaba; o âmbito fica. */
export function respostaDoDono(atual: Etiqueta | null, now: number): Etiqueta | null {
  return atual ? { ...atual, urgente: false, urgenteFixo: false, at: now } : null
}

/** A mensagem ainda não foi considerada pelo agente. */
export function precisaTriar(atual: Etiqueta | null, messageId: string): boolean {
  return atual?.lastMessageId !== messageId
}

/** "Não lidas" é determinística (`unread > 0`); as outras abas vêm da etiqueta. */
export function naAba(chat: { unread: number }, etiqueta: Etiqueta | null, aba: TriagemAba): boolean {
  switch (aba) {
    case 'todas':
      return true
    case 'nao-lidas':
      return chat.unread > 0
    case 'urgentes':
      return etiqueta?.urgente === true
    case 'pessoal':
    case 'profissional':
      return etiqueta?.ambito === aba
  }
}

/** As contagens que aparecem nas abas Não lidas e Urgentes. */
export function contagensAbas(chats: readonly { id: string; unread: number }[], etiquetas: Record<string, Etiqueta>): { naoLidas: number; urgentes: number } {
  let naoLidas = 0
  let urgentes = 0
  for (const chat of chats) {
    const etiqueta = etiquetas[chat.id] ?? null
    if (naAba(chat, etiqueta, 'nao-lidas')) naoLidas++
    if (naAba(chat, etiqueta, 'urgentes')) urgentes++
  }
  return { naoLidas, urgentes }
}

const AMBITO_LABELS: Readonly<Record<TriagemAmbito, string>> = { pessoal: 'Pessoal', profissional: 'Profissional' }

/** As etiquetas de uma linha: "Urgente" primeiro, depois o âmbito; no máximo duas. */
export function chipsDe(etiqueta: Etiqueta | null): string[] {
  if (!etiqueta) return []
  const chips: string[] = []
  if (etiqueta.urgente) chips.push('Urgente')
  if (etiqueta.ambito) chips.push(AMBITO_LABELS[etiqueta.ambito])
  return chips.slice(0, 2)
}

/** As `max` etiquetas mais recentes por `at`. */
export function podarEtiquetas(etiquetas: Record<string, Etiqueta>, max: number = TRIAGEM_ETIQUETAS_MAX): Record<string, Etiqueta> {
  const entradas = Object.entries(etiquetas)
  if (entradas.length <= max) return { ...etiquetas }
  return Object.fromEntries(entradas.sort(([, a], [, b]) => b.at - a.at).slice(0, max))
}
