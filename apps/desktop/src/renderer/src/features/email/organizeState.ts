// O painel "Organizando" e a faixa "O Assistente moveu N mensagens" (contrato 55, CA12 e CA13): o que desenhar a partir
// do estado inteiro do lote que o main manda (`scribe:email-organize`, contrato 56) e do pedido e das horas do lote
// (`scribe:email-batch-get`). Sem DOM: testado em test/renderer/email-organize-state.test.ts.
import { EMAIL_INBOX_MAILBOX } from '@shared/email'
import { EMAIL_ORGANIZE_READ_MAX, EMAIL_ORGANIZE_STAGES, type EmailBatch, type EmailBatchUndoResult, type EmailOrganizeEvent, type EmailOrganizeStage, type EmailUndoError, type EmailVerdict } from '@shared/email-organize'

/** O que vem do lote gravado (uma vez por `batchId`): o pedido, as horas e a pasta organizada. */
export interface BatchMeta {
  request: string
  startedAt: number
  endedAt: number | null
  /** A pasta de onde os itens saíram; `null` sem item ainda (o título diz "a Caixa de Entrada"). */
  fromPath: string | null
}

export function batchMeta(batch: Pick<EmailBatch, 'request' | 'startedAt' | 'endedAt' | 'items'>): BatchMeta {
  return { request: batch.request, startedAt: batch.startedAt, endedAt: batch.endedAt, fromPath: batch.items[0]?.fromPath ?? null }
}

/** O nome de uma pasta na tela ("Clientes › ABF"); quem chama sabe a árvore. */
export type FolderName = (path: string) => string

const two = (value: number): string => String(value).padStart(2, '0')
export const clock = (at: number): string => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
const sameDay = (a: number, b: number): boolean => {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}
const emails = (count: number): string => (count === 1 ? '1 email' : `${count} emails`)
const messages = (count: number): string => (count === 1 ? '1 mensagem' : `${count} mensagens`)

const STAGE_LABELS: Record<EmailOrganizeStage, string> = { lendo: 'Lendo', decidindo: 'Decidindo', movendo: 'Movendo' }

/** A última parte do path, sem diferenciar maiúscula ("INBOX/Resolvidos" → "resolvidos"). */
const leaf = (path: string): string => (path.split(/[/.]/).at(-1) ?? path).toLocaleLowerCase('pt-BR')

/** "a Caixa de Entrada" ou "a pasta Clientes › ABF". */
export function folderPhrase(path: string | null, name: FolderName): string {
  return path === null || path.toUpperCase() === EMAIL_INBOX_MAILBOX ? 'a Caixa de Entrada' : `a pasta ${name(path)}`
}

export interface OrganizeTopicRow {
  key: string
  veredito: EmailVerdict
  /** "Resolvido", "Pendente", ou o breadcrumb da outra pasta; "decidindo" na linha em andamento. */
  badge: string
  deciding: boolean
  assunto: string
  /** "Carla Nogueira · 4 emails" ou, decidindo, "Marina Duarte · lendo 5 emails do fio". */
  meta: string
  motivo: string
  evidencia: string
  /** Onde a mensagem mais recente do assunto está agora; `null` deixa a linha sem clique. */
  open: { accountId: string; mailbox: string; id: string } | null
}

export interface OrganizeView {
  batchId: string
  chatId: string
  accountId: string
  running: boolean
  state: EmailOrganizeEvent['state']
  /** "Organizando a Caixa de Entrada", "Organização parada"… */
  title: string
  /** "Pedido no Assistente às 14:31: “…”" (vazio enquanto o lote não chegou). */
  request: string
  stages: { id: EmailOrganizeStage; label: string; status: 'done' | 'current' | 'next' }[]
  read: number
  total: number
  moved: number
  resolved: number
  pending: number
  others: number
  /** A nota do limite N7, só quando a pasta tem mais de 200. */
  limitNote: string | null
  topics: OrganizeTopicRow[]
  /** O resumo do parado ou terminado; `null` enquanto roda. */
  summary: {
    line: string
    perFolder: string
    readLine: string
    /** "Desfazer as 18" ou "Tentar de novo"; `null` sem nada movido, rodando ou já desfeito. */
    undo: string | null
    decisions: string
  } | null
}

/** "N Resolvidos", "N Pendentes" e "N outras pastas", pela pasta de destino (D7). */
export function folderCounts(byFolder: readonly { path: string; count: number }[]): { resolved: number; pending: number; others: number } {
  let resolved = 0
  let pending = 0
  let others = 0
  for (const { path, count } of byFolder) {
    if (leaf(path) === 'resolvidos') resolved += count
    else if (leaf(path) === 'pendentes') pending += count
    else others += count
  }
  return { resolved, pending, others }
}

/** "X de Y mensagens lidas. As outras Y−X não foram tocadas; T−200 ficaram de fora por passar das 200 mais recentes." */
export function readLine(read: number, total: number, outOfLimit: number): string {
  const parts = [`${read} de ${total} mensagens lidas.`]
  const untouched = total - read
  const out = outOfLimit > 0 ? `${outOfLimit} ${outOfLimit === 1 ? 'ficou' : 'ficaram'} de fora por passar das ${EMAIL_ORGANIZE_READ_MAX} mais recentes.` : ''
  if (untouched > 0) parts.push(`As outras ${untouched} não foram tocadas${out ? `; ${out}` : '.'}`)
  else if (out) parts.push(out.charAt(0).toLocaleUpperCase('pt-BR') + out.slice(1))
  return parts.join(' ')
}

/** O painel inteiro, a partir do estado do lote. */
export function organizeView(event: EmailOrganizeEvent, meta: BatchMeta | null, name: FolderName): OrganizeView {
  const running = event.state === 'running'
  const where = folderPhrase(meta?.fromPath ?? null, name)
  const current = EMAIL_ORGANIZE_STAGES.indexOf(event.etapa)
  const stages = EMAIL_ORGANIZE_STAGES.map((id, index) => ({ id, label: STAGE_LABELS[id], status: (!running || index < current ? 'done' : index === current ? 'current' : 'next') as 'done' | 'current' | 'next' }))
  const counts = folderCounts(event.byFolder)
  const totalInFolder = event.total + event.outOfLimit
  const limitNote =
    event.outOfLimit > 0
      ? `${where.charAt(0).toLocaleUpperCase('pt-BR')}${where.slice(1)} tem ${totalInFolder} mensagens: o Assistente lê as ${EMAIL_ORGANIZE_READ_MAX} mais recentes e ${event.outOfLimit} ${event.outOfLimit === 1 ? 'fica' : 'ficam'} de fora. Na dúvida, vai para Pendentes.`
      : null
  const topics = event.topics.map((topic, index): OrganizeTopicRow => {
    const deciding = topic.status === 'decidindo'
    const badge = deciding ? 'decidindo' : topic.veredito === 'resolvido' ? 'Resolvido' : topic.veredito === 'pendente' ? 'Pendente' : topic.destino ? name(topic.destino) : 'Outra pasta'
    return {
      key: `${index}:${topic.assunto}`,
      veredito: topic.veredito,
      badge,
      deciding,
      assunto: topic.assunto || '(sem assunto)',
      meta: deciding ? `${topic.from} · lendo ${emails(topic.count)} do fio` : `${topic.from} · ${emails(topic.count)}`,
      motivo: deciding ? '' : topic.motivo,
      evidencia: deciding ? '' : topic.evidencia,
      open: topic.open,
    }
  })
  const titles: Record<EmailOrganizeEvent['state'], string> = {
    running: `Organizando ${where}`,
    stopped: 'Organização parada',
    done: 'Organização concluída',
    undone: 'Organização desfeita',
    'partial-undo': 'Organização desfeita em parte',
  }
  const ended = meta?.endedAt ?? null
  const summary = running
    ? null
    : {
        line: event.state === 'stopped' ? `Você parou${ended ? ` às ${clock(ended)}` : ''}. O que já foi movido ficou onde está.` : ended ? `Terminou às ${clock(ended)}.` : 'Terminou.',
        perFolder: event.byFolder.length ? event.byFolder.map((item) => `${item.count} em ${name(item.path)}`).join(', ') : 'Nenhuma mensagem foi movida.',
        readLine: readLine(event.read, event.total, event.outOfLimit),
        undo: event.moved > 0 && event.state !== 'undone' ? (event.state === 'partial-undo' ? 'Tentar de novo' : `Desfazer as ${event.moved}`) : null,
        decisions: `${event.topics.length === 1 ? '1 assunto' : `${event.topics.length} assuntos`}, ${messages(event.moved)}`,
      }
  return {
    batchId: event.batchId,
    chatId: event.chatId,
    accountId: event.accountId,
    running,
    state: event.state,
    title: titles[event.state],
    request: meta ? `Pedido no Assistente às ${clock(meta.startedAt)}: “${meta.request}”` : '',
    stages,
    read: event.read,
    total: event.total,
    moved: event.moved,
    ...counts,
    limitNote,
    topics,
    summary,
  }
}

/** O que o painel sabe dos lotes: o que roda, os de hoje e o que a tela já viu (`live`) ou fechou. */
export interface OrganizeSnapshot {
  running: EmailOrganizeEvent | null
  today: readonly EmailOrganizeEvent[]
}

/**
 * O lote do painel de uma conta: o que roda nela; depois de parar ou terminar, o mesmo lote (agora resumo) até o
 * "Fechar", só se esta sessão o viu rodando (reabrir o app no outro dia mostra só a faixa). Evento de outra conta não
 * mexe no painel desta.
 */
export function panelBatch(snapshot: OrganizeSnapshot, accountId: string, live: ReadonlySet<string>, closed: ReadonlySet<string>): EmailOrganizeEvent | null {
  if (snapshot.running?.accountId === accountId) return snapshot.running
  const seen = snapshot.today.filter((event) => event.accountId === accountId && live.has(event.batchId) && !closed.has(event.batchId))
  return seen.at(-1) ?? null
}

export interface OrganizeBanner {
  batchId: string
  /** A pasta organizada: a faixa fica no topo da lista dela. */
  path: string
  title: string
  detail: string
  /** Lote `partial-undo`: o Desfazer só do que sobrou. */
  retry: boolean
  /** O resultado do Desfazer pela faixa: fica 5 s no lugar do título, mesmo com o lote já `undone`. */
  result: BannerResult | null
}

export interface BannerResult {
  text: string
  failed: boolean
}

/** A faixa fica à vista depois do Desfazer pela frase do resultado (5 s; com falha, até o ×). */
export const BANNER_RESULT_MS = 5000

/**
 * A faixa no topo da lista (CA13, D7): lote parado ou terminado, com algo movido, de hoje (até a meia-noite local) e não
 * fechado no ×. Lote rodando não tem Desfazer; desfeito, nada.
 */
export function organizeBanner(event: EmailOrganizeEvent, meta: BatchMeta | null, now: number, dismissed: ReadonlySet<string>, results: Readonly<Record<string, BannerResult>> = {}): OrganizeBanner | null {
  if (dismissed.has(event.batchId)) return null
  const result = results[event.batchId] ?? null
  // Desfeito pela faixa: a frase do resultado fica no lugar (o lote já é `undone`, e sem isto a faixa sumiria na hora).
  if (!result && (event.state === 'running' || event.state === 'undone' || event.moved === 0)) return null
  const at = meta?.endedAt ?? meta?.startedAt ?? null
  if (!result && (at === null || !sameDay(at, now))) return null
  const how = event.state === 'stopped' ? 'parado por você' : event.state === 'done' ? 'concluído' : 'desfeito em parte'
  return {
    batchId: event.batchId,
    path: meta?.fromPath ?? EMAIL_INBOX_MAILBOX,
    title: `O Assistente moveu ${messages(event.moved)}`,
    detail: at === null ? how : `hoje, ${clock(at)} · ${how}`,
    retry: event.state === 'partial-undo',
    result,
  }
}

const UNDO_REASONS: Record<EmailUndoError, string> = {
  'folder-missing': 'a pasta de destino sumiu',
  'origin-missing': 'a pasta de origem não existe mais (o app não recria)',
  'not-found': 'já tinham saído da pasta',
  server: 'o servidor recusou',
  unavailable: 'sem conexão com o servidor',
  invalid: 'a pasta mudou no servidor',
}

/** O resultado do Desfazer (CA13), em frase; `ok: false` quando nada voltou por causa do pedido. */
export function undoResultText(result: EmailBatchUndoResult, where: string): { text: string; failed: boolean } {
  if (!result.ok) {
    const text =
      result.error === 'busy'
        ? 'O Assistente ainda está organizando. Desfaça depois que ele terminar.'
        : result.error === 'unavailable'
          ? 'Sem conexão com o servidor. Nada voltou; tente de novo.'
          : result.error === 'missing'
            ? 'Este lote não existe mais.'
            : 'Não foi possível desfazer agora. Tente de novo.'
    return { text, failed: true }
  }
  const failed = result.failed.reduce((sum, item) => sum + item.count, 0)
  if (failed === 0) return { text: `Desfeito: ${result.undone === 1 ? '1 mensagem voltou' : `${result.undone} mensagens voltaram`} para ${where}.`, failed: false }
  const reasons = result.failed.map((item) => `${item.count} porque ${UNDO_REASONS[item.code]}`).join('; ')
  return { text: `${result.undone === 1 ? 'Voltou 1 mensagem' : `Voltaram ${result.undone} mensagens`}; ${failed === 1 ? '1 não voltou' : `${failed} não voltaram`}: ${reasons}.`, failed: true }
}
