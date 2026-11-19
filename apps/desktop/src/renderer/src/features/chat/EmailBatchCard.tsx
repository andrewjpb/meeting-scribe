// Contrato 56 (CA12, quadros 13 a 17 do mockup EmailOrganizacao, D13 a D19): o cartão do lote que o Assistente moveu.
// O main o anexa no fim da resposta (nunca o modelo); aqui ele lê o lote por `scribe:email-batch-get` e se atualiza pelo
// `scribe:email-organize`. Mostra a linha por pasta destino, os totais da leitura, até 5 assuntos ("Mais N assuntos" abre
// o resto) e "Desfazer as N" (secundário, sem confirmação: só devolve o que o agente moveu). Depois do Desfazer, o
// resultado gravado na conversa e as linhas esmaecidas; desfeito em parte, uma linha por motivo e "Tentar de novo as N",
// que some só quando todas voltaram (D17). Lote que saiu do arquivo (mais de 7 dias) perde o botão.
import { ArrowRight, Check, ChevronRight, FolderInput, Info, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import type { EmailBatchAction } from '@shared/assistant'
import { emailFolderLabel, type EmailBatch, type EmailBatchItem, type EmailOrganizeEvent, type EmailOrganizeTopic, type EmailUndoError } from '@shared/email-organize'
import { emailPath, type EmailNavigationState } from '@shared/routes'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { QUIET_BUTTON } from './ChatMessages'

const CARD = 'flex max-w-[72ch] flex-col gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-3'
/** Assuntos mostrados antes do "Mais N assuntos" (D15). */
const TOPICS_SHOWN = 5

const two = (value: number): string => String(value).padStart(2, '0')
const clock = (at: number): string => {
  const date = new Date(at)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
const plural = (count: number, one: string, many: string): string => (count === 1 ? one : many)

/** As que chegaram ao destino em algum momento (movidas, de volta e as que o Desfazer não trouxe). */
const wasMoved = (item: EmailBatchItem): boolean => item.status === 'moved' || item.status === 'undone' || item.status === 'undo-failed'

/** "12 em Resolvidos, 5 em Pendentes, 1 em Clientes › ABF", a maior primeiro. */
function destinations(batch: EmailBatch): { path: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of batch.items) if (wasMoved(item)) counts.set(item.toPath, (counts.get(item.toPath) ?? 0) + 1)
  return [...counts].map(([path, count]) => ({ path, count })).sort((a, b) => b.count - a.count || a.path.localeCompare(b.path, 'pt-BR'))
}

/** "Caixa de Entrada · 200 de 231 mensagens lidas; 31 ficaram de fora (passam das 200 mais recentes) · terminou às 14:38". */
function summaryLine(batch: EmailBatch): string {
  const origins = [...new Set(batch.items.filter(wasMoved).map((item) => emailFolderLabel(item.fromPath)))]
  const { total, outOfLimit } = batch.totals
  const read = total > 0 ? (outOfLimit > 0 ? `${total} de ${total + outOfLimit} mensagens lidas; ${outOfLimit} ${plural(outOfLimit, 'ficou', 'ficaram')} de fora (passam das ${total} mais recentes)` : `${total} ${plural(total, 'mensagem lida', 'mensagens lidas')}`) : null
  // Parada (quadro 15): quantas foram lidas até o Parar e quantas ficaram sem tocar.
  if (batch.state === 'stopped') {
    const at = batch.endedAt !== null ? ` às ${clock(batch.endedAt)}` : ''
    const untouched = Math.max(0, total - batch.totals.read)
    const progress = total > 0 ? ` com ${batch.totals.read} de ${total} mensagens lidas; ${untouched === 1 ? 'a outra não foi tocada' : `as outras ${untouched} não foram tocadas`}` : ''
    return [origins.join(' e '), `parada${at}${progress}`].filter(Boolean).join(' · ')
  }
  const ended = batch.endedAt !== null ? `terminou às ${clock(batch.endedAt)}` : null
  return [origins.join(' e '), read, ended].filter(Boolean).join(' · ')
}

/** As falhas do Desfazer, uma linha por motivo e pasta (D18). */
function failureLines(batch: EmailBatch): { key: string; lead: string; text: string }[] {
  const groups = new Map<string, { code: EmailUndoError; toPath: string; fromPath: string; count: number }>()
  for (const item of batch.items) {
    if (item.status !== 'undo-failed') continue
    const code = item.undoError ?? 'server'
    const key = `${code}\n${item.toPath}\n${code === 'origin-missing' ? item.fromPath : ''}`
    const known = groups.get(key)
    if (known) known.count++
    else groups.set(key, { code, toPath: item.toPath, fromPath: item.fromPath, count: 1 })
  }
  return [...groups].map(([key, group]) => {
    const n = group.count
    const to = emailFolderLabel(group.toPath)
    if (group.code === 'folder-missing') return { key, lead: `${n} ${plural(n, 'ficou fora', 'ficaram fora')}:`, text: `a pasta ${to} não existe mais no servidor (foi apagada ou renomeada fora do app).` }
    if (group.code === 'origin-missing') return { key, lead: `${n} ${plural(n, 'ficou', 'ficaram')} em ${to}:`, text: `a pasta de onde ${plural(n, 'veio', 'vieram')}, ${emailFolderLabel(group.fromPath)}, não existe mais. O app não recria pastas.` }
    if (group.code === 'not-found') return { key, lead: `${n} não ${plural(n, 'estava', 'estavam')} mais em ${to}:`, text: `já ${plural(n, 'tinha sido tirada', 'tinham sido tiradas')} de lá.` }
    return { key, lead: `${n} não ${plural(n, 'voltou', 'voltaram')}:`, text: 'o servidor não respondeu ou recusou. Tente de novo em instantes.' }
  })
}

/** O veredito com as cores do D7: Resolvido em azul cheio, Pendente com contorno, outra pasta em cinza azulado. */
function Verdict({ topic }: { topic: EmailOrganizeTopic }) {
  const base = 'inline-flex h-5 items-center rounded-[var(--radius-control)] px-1.5 text-11 font-medium whitespace-nowrap'
  if (topic.veredito === 'resolvido') return <span className={`${base} bg-accent text-on-accent`}>Resolvido</span>
  if (topic.veredito === 'pendente') return <span className={`${base} border border-title text-title`}>Pendente</span>
  return <span className={`${base} max-w-full truncate bg-bg-sunken text-text-muted`}>{topic.destino ? emailFolderLabel(topic.destino) : 'Outra pasta'}</span>
}

function undoErrorText(error: string, account: string): string {
  if (error === 'busy') return 'Esta organização ainda está rodando. Clique em Parar e depois em Desfazer.'
  if (error === 'locked') return 'O app está bloqueado. Desbloqueie e clique em Desfazer de novo.'
  if (error === 'unavailable' || error === 'server') return `Não consegui falar com o servidor de ${account}. Nada mudou; tente de novo em instantes.`
  return 'Não foi possível desfazer agora. Tente de novo.'
}

export function EmailBatchCard({ action }: { action: EmailBatchAction }) {
  const navigate = useNavigate()
  const [batch, setBatch] = useState<EmailBatch | null>(null)
  const [view, setView] = useState<EmailOrganizeEvent | null>(null)
  const [expired, setExpired] = useState(false)
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // O lote do arquivo: ao abrir, a cada evento dele e quando o estado gravado na conversa muda (o Desfazer).
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.__scribeApi.invoke('scribe:email-batch-get', { batchId: action.batchId }).then(
        (result) => {
          if (!alive) return
          if (result.ok) {
            setBatch(result.batch)
            setView(result.view)
            setExpired(false)
          } else if (result.error === 'missing') setExpired(true)
        },
        () => undefined,
      )
    }
    load()
    const off = window.__scribeApi.on('scribe:email-organize', (event) => {
      if (event.batchId === action.batchId) load()
    })
    return () => {
      alive = false
      off()
    }
  }, [action.batchId, action.status, action.result])

  const undo = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    try {
      const result = await window.__scribeApi.invoke('scribe:email-batch-undo', { batchId: action.batchId })
      if (!result.ok) {
        if (result.error === 'missing') setExpired(true)
        else setFailure(undoErrorText(result.error, action.account))
      }
    } catch (error) {
      setFailure(undoErrorText(error instanceof Error && /locked/.test(error.message) ? 'locked' : 'failed', action.account))
    } finally {
      setBusy(false)
    }
  }

  const openEmail = (topic: EmailOrganizeTopic): void => {
    if (!topic.open) return
    const state: EmailNavigationState = { messageId: topic.open.id }
    void navigate(emailPath(topic.open.accountId, 'inbox'), { state })
  }

  const stopped = batch?.state === 'stopped'
  const undone = batch?.state === 'undone'
  const partial = batch?.state === 'partial-undo'
  const after = undone || partial
  const folders = batch ? destinations(batch) : []
  const topics = (view?.topics ?? []).filter((topic) => topic.status === 'movido')
  const shown = all ? topics : topics.slice(0, TOPICS_SHOWN)
  const undoable = batch ? batch.items.filter((item) => item.status === 'moved' || item.status === 'pending').length : 0
  const retry = batch ? batch.items.filter((item) => item.status === 'undo-failed').length : 0
  const toInbox = batch ? batch.items.filter(wasMoved).every((item) => item.fromPath.toUpperCase() === 'INBOX') : true

  return (
    <div data-chat-action="email-lote" data-chat-action-status={action.status} data-email-batch={action.batchId} data-email-batch-state={batch?.state ?? (expired ? 'expired' : 'loading')} className={CARD}>
      <p className="flex items-center gap-2 text-12 font-medium text-text-muted">
        <Icon icon={FolderInput} size={14} className="shrink-0" />
        <span data-email-batch-title>
          Organização do email · {action.account}
          {stopped ? ' · parada' : ''}
        </span>
      </p>
      {folders.length > 0 && (
        <p data-email-batch-folders className="text-13 leading-5 text-title">
          {folders.map((folder, at) => (
            <span key={folder.path}>
              {at > 0 && ', '}
              <b className="font-medium">
                {folder.count} em {emailFolderLabel(folder.path)}
              </b>
            </span>
          ))}
        </p>
      )}
      {batch && <p className="-mt-1 text-12 text-text-muted">{summaryLine(batch)}</p>}
      {shown.length > 0 && (
        <ul data-email-batch-topics className="flex flex-col">
          {shown.map((topic) => {
            const inside = (
              <>
                <span className="w-[100px] flex-none pt-px">
                  <Verdict topic={topic} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span data-email-batch-subject className="truncate text-13 text-text">
                    {topic.assunto}
                  </span>
                  <span className="truncate text-12 text-text-muted">
                    {[topic.from, `${topic.count} ${plural(topic.count, 'email', 'emails')}`, topic.motivo].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </>
            )
            // Abre a mensagem onde ela está agora; a tela Email do app ainda só abre a Caixa de Entrada (as pastas são do 55).
            const openable = !after && topic.open !== null && topic.open.mailbox.toUpperCase() === 'INBOX'
            const row = `flex w-full items-start gap-2.5 rounded-[var(--radius-control)] border-t border-line px-1 py-2 text-left ${after ? 'opacity-50' : ''}`
            return (
              <li key={topic.assunto}>
                {openable ? (
                  <button type="button" data-action="chat-email-batch-open" onClick={() => openEmail(topic)} className={`no-drag ${row} hover:bg-bg-sunken`}>
                    {inside}
                    <Icon icon={ChevronRight} size={14} className="mt-[3px] shrink-0 text-text-faint" />
                  </button>
                ) : (
                  <div className={row}>{inside}</div>
                )}
              </li>
            )
          })}
          {!all && topics.length > TOPICS_SHOWN && (
            <li>
              <button type="button" data-action="chat-email-batch-more" onClick={() => setAll(true)} className="no-drag flex w-full items-center gap-1.5 border-t border-line px-1 py-2 text-12 font-medium text-accent">
                <Icon icon={ChevronRight} size={14} className="shrink-0" />
                Mais {topics.length - TOPICS_SHOWN} {plural(topics.length - TOPICS_SHOWN, 'assunto', 'assuntos')}
              </button>
            </li>
          )}
        </ul>
      )}
      {expired ? (
        <p data-email-batch-expired className="flex items-center gap-1.5 text-12 text-text-muted">
          <Icon icon={Info} size={14} className="shrink-0" />O Desfazer deste lote expirou: ele vale por 7 dias.
        </p>
      ) : (
        <>
          {after && action.result && !partial && (
            <div className="flex flex-wrap items-center gap-3">
              <p data-chat-action-result className="flex items-center gap-1.5 text-12 text-text-muted">
                <Icon icon={Check} size={14} className="shrink-0" />
                {action.result}
              </p>
              <button type="button" data-action="chat-email-batch-view" onClick={() => void navigate(emailPath(action.accountId))} className={QUIET_BUTTON}>
                Ver no Email
              </button>
            </div>
          )}
          {partial && (
            <>
              {action.result && (
                <p data-chat-action-result className="flex items-center gap-1.5 text-12 text-text-muted">
                  <Icon icon={Check} size={14} className="shrink-0" />
                  {action.result}
                </p>
              )}
              {batch && (
                <ul data-email-batch-failures className="flex flex-col gap-1.5 border-l-3 border-title bg-bg-sunken px-2.5 py-2">
                  {failureLines(batch).map((line) => (
                    <li key={line.key} className="flex gap-2 text-12 leading-[1.45] text-text">
                      <Icon icon={X} size={14} className="mt-px shrink-0 text-title" />
                      <span>
                        <b className="font-medium text-title">{line.lead}</b> {line.text}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {batch && (partial ? retry > 0 : !after && undoable > 0) && (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button action="chat-email-batch-undo" variant="secondary" icon={Undo2} onClick={() => void undo()} disabled={busy}>
                  {partial ? `Tentar de novo as ${retry}` : `Desfazer as ${undoable}`}
                </Button>
                <button type="button" data-action="chat-email-batch-view" onClick={() => void navigate(emailPath(action.accountId))} className={QUIET_BUTTON}>
                  <Icon icon={ArrowRight} size={14} />
                  Ver no Email
                </button>
              </div>
              <p className="text-12 text-text-faint">
                {partial
                  ? `Tentar de novo só mexe ${retry === 1 ? 'na que não voltou' : `nas ${retry} que não voltaram`}. Se a pasta voltar com o mesmo nome, ${plural(retry, 'ela volta', 'elas voltam')} também.`
                  : `Devolve ${undoable === 1 ? 'a mensagem' : `as ${undoable}`} ${toInbox ? 'para a Caixa de Entrada' : 'para as pastas de onde vieram'}. Vale por 7 dias, mesmo depois de fechar o app.`}
              </p>
            </>
          )}
        </>
      )}
      {failure && (
        <p role="alert" data-chat-action-failure className="text-12 text-rec">
          {failure}
        </p>
      )}
    </div>
  )
}
