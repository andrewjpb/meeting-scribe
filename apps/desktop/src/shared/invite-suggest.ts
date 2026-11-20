// Contrato 64 (convites-agenda, R11): o "Sugerir evento" num email sem `.ics`. No clique, com a opção ligada, o Claude
// (sempre o Haiku) lê só o texto do email aberto e devolve título, data, hora, duração e link; o cartão "Sugestão —
// confira" mostra os campos editáveis e só grava no clique de "Pôr na agenda". Ninguém recebe resposta. Aqui ficam os
// tipos, o esquema da resposta do Claude, os pedidos e resultados dos canais e as frases do cartão. Puro: nada de
// `node:*`, `electron` nem `main/`.
// Sem o zod (ele testa `new Function` e a CSP do renderer recusa): os esquemas ficam em `invite-suggest-schema.ts`.
import type { InviteEventAddResult } from './invite-state'

/** Caracteres do texto do email mandados ao Claude (C8). */
export const INVITE_SUGGEST_TEXT_MAX = 12_000
export const INVITE_SUGGEST_TITLE_MAX = 200
export const INVITE_SUGGEST_DURATION_MIN = 5
export const INVITE_SUGGEST_DURATION_MAX = 1440
/** Sem duração na sugestão, o cartão começa com 1 h. */
export const INVITE_SUGGEST_DEFAULT_DURATION = 60

export interface InviteSuggestion {
  title: string
  /** AAAA-MM-DD, no fuso do Mac. */
  date: string
  /** HH:MM, no fuso do Mac; `null`: o email não diz a hora. */
  time: string | null
  durationMinutes: number | null
  url: string | null
}

export const INVITE_SUGGEST_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
export const INVITE_SUGGEST_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

/** A mesma identificação do `scribe:email-get-body`; o `clickToken` o preload acrescenta. */
export interface InviteSuggestRequest {
  accountId: string
  /** `EmailMessage.id`. */
  id: string
  clickToken: string
}

/**
 * `off`: a opção está desligada; `click`: sem clique de verdade (token); `missing`: conta ou mensagem que não existe;
 * `no-body`: o corpo não foi baixado; `has-invite`: o email já tem convite; `empty`: sem texto; `busy`: já há uma sugestão
 * em andamento; `no-claude`: o `claude` não está instalado; `not-found`: o Claude não achou data de reunião; `format`: a
 * resposta veio fora do formato; `timeout`: passou o prazo; `failed`: o Claude falhou; `invalid`: pedido fora do formato;
 * `refused`: o app foi bloqueado enquanto o Claude respondia.
 */
export type InviteSuggestError = 'off' | 'click' | 'missing' | 'no-body' | 'has-invite' | 'empty' | 'busy' | 'no-claude' | 'not-found' | 'format' | 'timeout' | 'failed' | 'invalid' | 'refused'
export type InviteSuggestResult = { ok: true; suggestion: InviteSuggestion } | { ok: false; error: InviteSuggestError }

/** Gravar a sugestão (só no clique de "Pôr na agenda" do cartão; local, sem token). O esquema fica em `invite-suggest-schema.ts`. */
export interface InviteSuggestAddRequest {
  accountId: string
  id: string
  event: { title: string; date: string; time: string; durationMinutes: number; url: string | null; calendarId: string }
}
/** O resultado do `addEvent` do 62, com a frase fixa no `message`. */
export type InviteSuggestAddResult = InviteEventAddResult

/** As frases do cartão (nunca o texto do Claude). */
export const INVITE_SUGGEST_ERRORS: Readonly<Record<InviteSuggestError, string>> = Object.freeze({
  'not-found': 'O Claude não achou data de reunião neste email.',
  'no-claude': 'O Claude não está instalado neste Mac.',
  timeout: 'O Claude não respondeu a tempo. Tente de novo.',
  format: 'Não deu para ler a sugestão. Tente de novo.',
  failed: 'Não deu para ler a sugestão. Tente de novo.',
  busy: 'Já há uma sugestão sendo feita.',
  off: 'Ligue “Sugerir evento” em Configurações › Email › Convites.',
  'no-body': 'Abra o email inteiro antes de sugerir.',
  'has-invite': 'Este email já tem convite.',
  empty: 'O email não tem texto.',
  click: 'Não deu para sugerir agora.',
  invalid: 'Não deu para sugerir agora.',
  missing: 'Não deu para sugerir agora.',
  refused: 'Não deu para sugerir agora.',
})
