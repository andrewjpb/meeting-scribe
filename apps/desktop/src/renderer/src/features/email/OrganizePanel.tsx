import { ArrowLeft, Check, ChevronRight, Info, Sparkles, Square, Undo2, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { useChat } from '../chat/chatStore'
import { useEmail } from './emailStore'
import { undoResultText, type OrganizeBanner as BannerView, type OrganizeTopicRow, type OrganizeView } from './organizeState'

/** "Voltar para a lista": só na janela estreita, quando a lista e a leitura se alternam. */
const NARROW_ONLY = 'min-[900px]:hidden'

/** O veredito (D7): Resolvido em `--accent` cheio, Pendente com contorno, outra pasta em cinza azulado; raio 4, sem pílula. */
function Verdict({ row }: { row: OrganizeTopicRow }) {
  const base = 'inline-flex h-5 shrink-0 items-center rounded-[var(--radius-control)] px-1.5 text-12 font-medium whitespace-nowrap'
  if (row.deciding) return <span className={`${base} text-text-muted italic`}>decidindo</span>
  if (row.veredito === 'resolvido') return <span className={`${base} border border-accent bg-accent text-on-accent`}>{row.badge}</span>
  if (row.veredito === 'pendente') return <span className={`${base} border border-accent text-accent`}>{row.badge}</span>
  return <span className={`${base} bg-bg-sunken text-text-muted`}>{row.badge}</span>
}

function TopicRow({ row, onOpen }: { row: OrganizeTopicRow; onOpen: (row: OrganizeTopicRow) => void }) {
  const content = (
    <>
      <span className="w-[112px] shrink-0 pt-0.5">
        <Verdict row={row} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-13 font-bold text-title">{row.assunto}</span>
        <span className="truncate text-12 text-text-muted">{row.meta}</span>
        {row.motivo && <span className="text-13 text-text">{row.motivo}</span>}
        {row.evidencia && (
          <span className="flex items-start gap-1.5 text-12 text-text-muted">
            <Icon icon={Info} size={14} className="mt-px shrink-0" />
            <span>{row.evidencia}</span>
          </span>
        )}
      </span>
      {row.open && <Icon icon={ChevronRight} size={14} className="mt-0.5 shrink-0 text-text-faint" />}
    </>
  )
  return (
    <li data-email-organize-topic={row.deciding ? 'decidindo' : row.veredito} className="border-t border-line first:border-t-0">
      {row.open ? (
        <button type="button" data-action="email-organize-open" onClick={() => onOpen(row)} className="no-drag flex w-full items-start gap-3 px-1 py-3 text-left hover:bg-bg-sunken">
          {content}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-1 py-3">{content}</div>
      )}
    </li>
  )
}

interface OrganizePanelProps {
  view: OrganizeView
  onOpen: (row: OrganizeTopicRow) => void
  /** "a Caixa de Entrada": para onde as mensagens voltam no Desfazer. */
  where: string
  /** Janela estreita: volta para a lista. */
  onBack: () => void
}

/**
 * Painel "Organizando" (contrato 55, CA12 e CA13, telas 07 e 08): toma a área da leitura da conta que o Assistente está
 * organizando. Enquanto roda: o pedido, Parar, as etapas, os contadores, a barra, a nota do limite e as decisões por
 * assunto (a nova é anunciada). Parado ou terminado: o resumo do lote, "Desfazer as N", "Abrir no Assistente" e Fechar.
 */
export function OrganizePanel({ view, onOpen, where, onBack }: OrganizePanelProps) {
  const navigate = useNavigate()
  const [undo, setUndo] = useState<{ busy: boolean; text: string | null; failed: boolean }>({ busy: false, text: null, failed: false })
  // Região viva: só a decisão nova (o texto muda só quando sai uma decisão, não a cada contador).
  const last = view.topics.filter((row) => !row.deciding).at(-1)
  const announce = last ? `${last.badge}: ${last.assunto}` : ''

  const stop = (): void => void useChat.getState().stop(view.chatId)
  const runUndo = (): void => {
    setUndo({ busy: true, text: null, failed: false })
    void useEmail
      .getState()
      .undoBatch(view.batchId)
      .then((result) => setUndo({ busy: false, ...undoResultText(result, where) }))
  }
  const openChat = (): void => {
    useChat.getState().select(null, view.chatId)
    void navigate(ROUTE_PATHS.assistente)
  }
  const bar = view.total > 0 ? Math.min(100, Math.round((view.read / view.total) * 100)) : 0

  return (
    <section data-email-organize={view.state} data-email-organize-batch={view.batchId} aria-label={view.title} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-7 py-5">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
        <header className="flex items-start gap-3">
          <button type="button" data-action="email-organize-back" onClick={onBack} aria-label="Voltar para a lista" className={`no-drag inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-title hover:bg-bg-sunken ${NARROW_ONLY}`}>
            <Icon icon={ArrowLeft} />
          </button>
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent text-on-accent">
            <Icon icon={Sparkles} />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h2 data-email-organize-title className="text-17 font-bold text-title">
              {view.title}
            </h2>
            <p className="text-12 text-text-muted">{view.running ? view.request : view.summary?.line}</p>
          </div>
          {view.running ? (
            <button type="button" data-action="email-organize-stop" onClick={stop} className="no-drag inline-flex h-8 shrink-0 items-center gap-2 rounded-[var(--radius-control)] border border-rec px-3 text-13 font-medium text-rec hover:bg-bg-sunken">
              <span aria-hidden="true" className="size-2 bg-rec" />
              Parar
            </button>
          ) : (
            <button type="button" data-action="email-organize-close" onClick={() => useEmail.getState().closePanel(view.batchId)} className="no-drag inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-13 font-medium text-title hover:bg-bg-sunken">
              <Icon icon={X} size={14} />
              Fechar
            </button>
          )}
        </header>

        {view.running ? (
          <>
            <ol aria-label="Etapas" className="flex items-center gap-2 text-12">
              {view.stages.map((stage, index) => (
                <li key={stage.id} data-email-organize-stage={stage.id} data-status={stage.status} aria-current={stage.status === 'current' ? 'step' : undefined} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden="true" className="h-px w-6 bg-line-strong" />}
                  {stage.status === 'done' ? <Icon icon={Check} size={14} className="text-accent" /> : stage.status === 'current' ? <Icon icon={Square} size={14} className="fill-accent text-accent" /> : null}
                  <span className={stage.status === 'current' ? 'font-bold text-title' : stage.status === 'done' ? 'text-text' : 'text-text-muted'}>{stage.label}</span>
                </li>
              ))}
            </ol>
            <dl data-email-organize-counts className="grid grid-cols-5 gap-4">
              {[
                [view.read, `de ${view.total} lidos`, 'read'],
                [view.moved, 'movidos', 'moved'],
                [view.resolved, 'Resolvidos', 'resolved'],
                [view.pending, 'Pendentes', 'pending'],
                [view.others, 'outras pastas', 'others'],
              ].map(([value, label, key]) => (
                <div key={key} data-email-organize-count={key} className="flex flex-col">
                  <dt className="sr-only">{label}</dt>
                  <dd className="text-20 font-bold tabular text-title">{value}</dd>
                  <dd aria-hidden="true" className="text-12 text-text-muted">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
            <div role="progressbar" aria-label="Mensagens lidas" aria-valuemin={0} aria-valuemax={view.total} aria-valuenow={view.read} className="h-1 w-full bg-bg-sunken">
              <div className="h-1 bg-accent transition-[width] duration-[var(--duration-base)] ease-[var(--ease-out)]" style={{ width: `${bar}%` }} />
            </div>
            {view.limitNote && <p className="text-12 text-text-muted">{view.limitNote}</p>}
          </>
        ) : (
          view.summary && (
            <div data-email-organize-summary className="flex flex-col gap-3 border-l-3 border-title bg-bg-sunken px-4 py-4">
              <p className="text-15 font-bold text-title">{view.summary.perFolder}</p>
              <p className="text-12 text-text-muted">{view.summary.readLine}</p>
              {undo.text && (
                <p role="status" data-email-organize-undo-result className={`text-13 ${undo.failed ? 'text-rec' : 'text-text'}`}>
                  {undo.text}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {view.summary.undo && (
                  <Button action="email-organize-undo" variant="secondary" icon={Undo2} onClick={runUndo} disabled={undo.busy}>
                    {undo.busy ? 'Desfazendo…' : view.summary.undo}
                  </Button>
                )}
                <button type="button" data-action="email-organize-chat" onClick={openChat} className="no-drag inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] px-3 text-13 font-medium text-title hover:bg-bg-raised">
                  <Icon icon={Sparkles} />
                  Abrir no Assistente
                </button>
              </div>
            </div>
          )
        )}

        <div className="flex flex-col">
          <h3 className="caps text-text-muted">{view.summary ? `Decisões por assunto · ${view.summary.decisions}` : 'Decisões por assunto'}</h3>
          <p aria-live="polite" className="sr-only" data-email-organize-live>
            {announce}
          </p>
          <ul data-email-organize-topics className="mt-2 flex flex-col">
            {view.topics.map((row) => (
              <TopicRow key={row.key} row={row} onOpen={onOpen} />
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/**
 * A faixa no topo da lista da pasta organizada (contrato 55, CA13, D7): "O Assistente moveu N mensagens", quando, Desfazer
 * e fechar (×). Desfeito, vira a frase do resultado e some em 5 s; com falha, "Tentar de novo".
 */
export function OrganizeBanner({ banner, where }: { banner: BannerView; where: string }) {
  const [busy, setBusy] = useState(false)
  const result = banner.result
  const run = (): void => {
    setBusy(true)
    void useEmail
      .getState()
      .undoFromBanner(banner.batchId, where)
      .finally(() => setBusy(false))
  }
  const state = { busy, text: result?.text ?? null, failed: result?.failed ?? false }
  const retry = banner.retry || state.failed
  return (
    <div data-email-organize-banner={banner.batchId} role="status" className="mx-2 mb-1 flex items-start gap-2.5 border-l-3 border-title bg-bg-sunken px-3 py-2.5">
      <Icon icon={Sparkles} className="mt-0.5 shrink-0 text-title" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {state.text ? (
          <p data-email-organize-banner-result className={`text-12 ${state.failed ? 'text-rec' : 'text-text'}`}>
            {state.text}
          </p>
        ) : (
          <>
            <p className="text-12 font-bold text-title">{banner.title}</p>
            <p className="text-12 text-text-muted">{banner.detail}</p>
          </>
        )}
      </div>
      {(!state.text || state.failed) && (
        <button type="button" data-action="email-organize-banner-undo" onClick={run} disabled={state.busy} className="no-drag inline-flex shrink-0 items-center gap-1 text-12 font-medium text-accent disabled:opacity-50">
          <Icon icon={Undo2} size={14} />
          {state.busy ? 'Desfazendo…' : retry ? 'Tentar de novo' : 'Desfazer'}
        </button>
      )}
      <button type="button" data-action="email-organize-banner-close" aria-label="Fechar o aviso" onClick={() => useEmail.getState().dismissBanner(banner.batchId)} className="no-drag inline-flex size-5 shrink-0 items-center justify-center text-text-muted hover:text-title">
        <Icon icon={X} size={14} />
      </button>
    </div>
  )
}
