import { Copy, Download, ExternalLink, Funnel, ListChecks, Plus, RefreshCw, Sparkles, Terminal, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { acpReady } from '@shared/acp'
import { summaryDateLabel, type MeetingSummary, type SummaryError } from '@shared/meeting-summary'
import type { MeetingAttendee, MeetingCalendar } from '@shared/meetings'
import { tarefasPath } from '@shared/routes'
import { useAcp } from '../../app/acpStore'
import { useAgentLabel } from '../../app/agentLabel'
import { useSettings } from '../../app/settingsStore'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { ContactLink } from '../funil/ContactLink'
import { useProposta } from '../funil/proposalStore'
import { RetryNotice } from '../live/Notices'
import { CaixaFeito } from '../tarefas/TarefaLinha'
import { linhasDoResumo, pendentesMinhas, textoPrazoResumo } from '../tarefas/tarefasFormat'
import { useTarefas, useTarefasView } from '../tarefas/tarefasStore'
import { OpportunityCard } from './OpportunityCard'
import { OpenQuestionsSection } from './OpenQuestionsSection'
import type { AnalysesView } from './useAnalyses'
import type { SummaryView } from './useSummary'

/** Motivo curto do erro, depois de "Não foi possível gerar o resumo." */
export function summaryErrorReason(error: SummaryError, agentLabel = 'Claude'): string {
  if (error === 'not-found') return 'Configure o Claude CLI em Configurações.'
  if (error === 'timeout') return 'O Claude demorou demais.'
  if (error === 'agent') return `O agente do ${agentLabel} não abriu.`
  return 'Tente de novo.'
}

/**
 * Contrato 17: com a conexão no agente e ele não instalado, o resumo sai pela linha de comando; um aviso
 * discreto oferece instalar (nunca baixa sem o clique).
 */
function AcpFallbackNote() {
  const transport = useSettings((state) => state.settings.claudeTransport)
  const acp = useAcp((state) => state.status)
  useEffect(() => {
    if (transport === 'acp') void useAcp.getState().load()
  }, [transport])
  if (transport !== 'acp' || !acp || acpReady(acp)) return null
  return (
    <Note
      id="summary-acp-missing"
      icon={Download}
      action={
        acp.state === 'installing' ? undefined : (
          <button type="button" data-action="acp-install-from-summary" className={NOTE_ACTION_CLASS} onClick={() => void useAcp.getState().install()}>
            Instalar
          </button>
        )
      }
    >
      {acp.state === 'installing' ? `Instalando o agente do ${acp.label}… ${acp.progress}%` : `O resumo usa a linha de comando: o agente do ${acp.label} não está instalado.`}
    </Note>
  )
}

/** O agente não abriu (contrato 17, CA8): troca a conexão para a linha de comando. */
function UseCommandLine() {
  const update = useSettings((state) => state.update)
  const transport = useSettings((state) => state.settings.claudeTransport)
  if (transport === 'cli') return null
  return (
    <Button action="use-command-line" variant="secondary" icon={Terminal} onClick={() => void update({ claudeTransport: 'cli' })}>
      Usar a linha de comando
    </Button>
  )
}

/** "Perguntas em aberto" (contrato 19, CA6) no fim da aba, em qualquer estado do resumo. */
interface OpenQuestionsProps {
  meetingId: string
  view: AnalysesView
  onAnalyze: () => void
  onJump?: ((atMs: number) => void) | undefined
}

/** Coluna da aba: mesma largura e margens da transcrição, rolando sozinha. */
function Column({ children, state, questions, empty = false }: { children: ReactNode; state: string; questions?: OpenQuestionsProps | undefined; empty?: boolean }) {
  return (
    <div data-summary-scroll className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
      <div data-summary={state} aria-live="polite" className="mx-auto flex w-full max-w-[680px] flex-col gap-6 pt-5">
        <AcpFallbackNote />
        {children}
        {questions && <OpenQuestionsSection {...questions} disabled={empty} />}
      </div>
    </div>
  )
}

/**
 * Aba "Resumo" (contrato 08, CA6): o que aconteceu, as decisões e as tarefas com quem faz. Gerando, um
 * esqueleto parado (nada gira, com ou sem movimento reduzido) que vira o resumo sozinho quando o main
 * avisa. Sem resumo, "Gerar resumo"; reunião sem trecho, o botão fica desligado.
 */
export function SummaryTab({
  meetingId,
  view,
  onGenerate,
  analyses,
  onJump,
  calendar,
}: {
  meetingId: string
  view: SummaryView
  onGenerate: () => void
  /** Análises da reunião (contrato 19); sem isto a seção "Perguntas em aberto" não aparece. */
  analyses?: { view: AnalysesView; analyze: () => void } | undefined
  onJump?: ((atMs: number) => void) | undefined
  /** Contrato 116 (R35): o evento da agenda da reunião; com participantes, o bloco "Participantes". */
  calendar?: MeetingCalendar | null | undefined
}) {
  const agentLabel = useAgentLabel()
  if (view.state === 'loading') return <div className="flex-1" aria-busy="true" />
  const questions: OpenQuestionsProps | undefined = analyses ? { meetingId, view: analyses.view, onAnalyze: analyses.analyze, onJump } : undefined

  if (view.state === 'generating') {
    return (
      <Column state="generating" questions={questions}>
        <div role="status" className="flex items-center gap-2 text-13 text-text-muted">
          <Icon icon={Sparkles} className="shrink-0" />
          Gerando o resumo…
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3">
          {['w-full', 'w-11/12', 'w-4/5', 'w-2/5'].map((width) => (
            <span key={width} className={`h-3 ${width} rounded-[var(--radius-control)] bg-bg-sunken`} />
          ))}
        </div>
      </Column>
    )
  }

  if (view.state === 'none' || view.state === 'empty') {
    const empty = view.state === 'empty'
    return (
      <Column state={view.state} questions={questions} empty={empty}>
        <div className="flex flex-col items-start gap-4">
          <p className="text-13 text-pretty text-text-muted">{empty ? 'Sem transcrição para resumir.' : 'Esta reunião ainda não tem resumo.'}</p>
          <Button action="generate-summary" icon={Sparkles} onClick={onGenerate} disabled={empty}>
            Gerar resumo
          </Button>
        </div>
      </Column>
    )
  }

  const summary = view.summary
  return (
    <Column state={view.state} questions={questions}>
      {view.state === 'error' && (
        <RetryNotice id="summary-failed" text={`Não foi possível gerar o resumo. ${summaryErrorReason(view.error, agentLabel)}`} onRetry={onGenerate} />
      )}
      {view.state === 'error' && view.error === 'agent' && (
        <div className="-mt-3">
          <UseCommandLine />
        </div>
      )}
      {summary && <SummaryContent meetingId={meetingId} summary={summary} onGenerate={onGenerate} attendees={calendar?.attendees ?? []} />}
    </Column>
  )
}

/** Título de bloco com o fio de 2×20; `action` (contrato 126) fica à direita, numa linha de 28 px mesmo vazia. */
function SectionTitle({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <>
      {action === undefined ? (
        <h2 className="text-14 leading-5 font-semibold text-title">{children}</h2>
      ) : (
        <div className="flex min-h-7 items-center justify-between gap-3">
          <h2 className="text-14 leading-5 font-semibold text-title">{children}</h2>
          {action}
        </div>
      )}
      <span aria-hidden="true" className="mt-2 mb-3 block h-0.5 w-5 bg-title" />
    </>
  )
}

function SummaryContent({ meetingId, summary, onGenerate, attendees }: { meetingId: string; summary: MeetingSummary; onGenerate: () => void; attendees: readonly MeetingAttendee[] }) {
  // Contrato 116 (R39, R40): a proposta de oportunidade da reunião e o "Detectar oportunidade".
  const proposta = useProposta(meetingId)
  // Desligado já no clique (antes da resposta do canal): um duplo clique não dispara duas detecções.
  const [pedindo, setPedindo] = useState(false)
  const detectando = pedindo || (proposta.view?.detectando ?? false)
  const detectar = (): void => {
    if (detectando) return
    setPedindo(true)
    void proposta.detectar().finally(() => setPedindo(false))
  }
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const copy = (): void => {
    window.__scribeApi.invoke('scribe:summary-copy', { meetingId }).then(
      (result) => {
        setCopyState(result === 'copied' ? 'copied' : 'failed')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopyState('idle'), 2500)
      },
      () => setCopyState('failed'),
    )
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button action="copy-summary" variant="secondary" icon={Copy} onClick={copy}>
          {copyState === 'copied' ? 'Copiado' : copyState === 'failed' ? 'Não copiou' : 'Copiar resumo'}
        </Button>
        <Button action="regenerate-summary" variant="secondary" icon={RefreshCw} onClick={onGenerate}>
          Gerar de novo
        </Button>
        <Button action="funil-detectar" variant="secondary" icon={Funnel} onClick={detectar} disabled={detectando}>
          {detectando ? 'Detectando…' : 'Detectar oportunidade'}
        </Button>
      </div>
      {proposta.erro && (
        <Note id="funil-proposta-falhou" icon={TriangleAlert} role="alert" className="-mt-3">
          {proposta.erro}
        </Note>
      )}

      <section aria-label="O que aconteceu">
        <SectionTitle>O que aconteceu</SectionTitle>
        <div data-summary-overview className="flex flex-col gap-3">
          {summary.overview
            .split(/\n\s*\n/)
            .map((paragraph) => paragraph.trim())
            .filter(Boolean)
            .map((paragraph, index) => (
              <p key={index} className="text-15 leading-6 text-pretty text-text select-text">
                {paragraph}
              </p>
            ))}
        </div>
      </section>

      {summary.decisions.length > 0 && (
        <section aria-label="Decisões">
          <SectionTitle>Decisões</SectionTitle>
          <ul data-summary-decisions className="flex flex-col gap-2">
            {summary.decisions.map((decision, index) => (
              <li key={index} className="grid grid-cols-[16px_minmax(0,1fr)] text-15 leading-6 text-text select-text">
                <span aria-hidden="true" className="mt-[9px] size-1.5 bg-accent" />
                <span>{decision}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposta.view?.arquivo && <OpportunityCard key={proposta.view.arquivo.createdAt} meetingId={meetingId} view={proposta.view} aplicar={proposta.aplicar} descartar={proposta.descartar} />}

      <TasksSection meetingId={meetingId} tasks={summary.tasks} />

      {attendees.length > 0 && <Participants attendees={attendees} />}

      <p data-summary-footer className="text-12 text-text-faint">
        Gerado pelo Claude em <span className="tabular">{summaryDateLabel(summary.createdAt)}</span> · <span className="font-mono text-11">{summary.model}</span>
      </p>
    </>
  )
}

/**
 * "Tarefas" do resumo (contrato 08; contrato 126, R22, R23, artboard 10): a coluna de estado de 32 px à esquerda (a caixa
 * de feito da tarefa que veio da linha), Tarefa, Quem, Prazo (a data real e o que foi dito, em cinza) e, à direita,
 * "Adicionar" ou o ícone que abre a tarefa. A linha casa com a tarefa pelo texto, então "Gerar de novo" não desliga
 * nada. "Adicionar as minhas" no título, enquanto houver linha de "Você" sem tarefa. Nada é criado sem clique.
 */
function TasksSection({ meetingId, tasks }: { meetingId: string; tasks: MeetingSummary['tasks'] }) {
  const view = useTarefasView()
  const navigate = useNavigate()
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Sem a view (antes da primeira carga) não se sabe o que já é tarefa: nem "Adicionar" nem a caixa, para não piscar.
  const linhas = view ? linhasDoResumo(tasks, meetingId, view.tarefas) : null
  const porId = new Map((view?.tarefas ?? []).map((tarefa) => [tarefa.id, tarefa]))
  const minhas = linhas ? pendentesMinhas(tasks, linhas) : 0

  const adicionar = async (indices: number[] | 'minhas'): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useTarefas.getState().adicionarDoResumo(meetingId, indices)
    setOcupado(false)
    if (!result.ok) setErro(result.mensagem)
  }

  const acaoMinhas =
    minhas > 0 ? (
      <ActionButton icon={ListChecks} label="Adicionar as minhas" action="tarefa-resumo-minhas" disabled={ocupado} onClick={() => void adicionar('minhas')} />
    ) : null

  return (
    <section aria-label="Tarefas">
      <SectionTitle action={tasks.length > 0 ? acaoMinhas : undefined}>Tarefas</SectionTitle>
      {tasks.length === 0 ? (
        <p data-summary-no-tasks className="text-13 text-text-muted">
          Nenhuma tarefa combinada.
        </p>
      ) : (
        <table data-summary-tasks className="w-full table-fixed border-collapse text-left">
          <thead>
            <tr className="label border-b border-line-strong">
              <th scope="col" className="w-8 py-1.5 font-medium">
                <span className="sr-only">Feita</span>
              </th>
              <th scope="col" className="py-1.5 pr-4 font-medium">
                Tarefa
              </th>
              <th scope="col" className="w-36 py-1.5 pr-4 font-medium">
                Quem
              </th>
              <th scope="col" className="w-36 py-1.5 pr-4 font-medium">
                Prazo
              </th>
              <th scope="col" className="w-[100px] py-1.5 font-medium">
                <span className="sr-only">Ação</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, index) => {
              const tarefaId = linhas?.[index]?.tarefaId ?? null
              const tarefa = tarefaId === null ? undefined : porId.get(tarefaId)
              const prazo = textoPrazoResumo(task)
              return (
                <tr key={index} data-summary-task={index} data-summary-task-tarefa={tarefa?.id} className="border-b border-line align-middle text-13 text-text select-text">
                  <td className="py-1.5">
                    <span className="flex">{tarefa && <CaixaFeito tarefa={tarefa} data={{ 'data-tarefa-feito': '' }} onErro={setErro} />}</span>
                  </td>
                  <td className="py-1.5 pr-4">{task.task}</td>
                  <td className={`py-1.5 pr-4 ${task.owner ? 'font-medium' : 'text-text-muted'}`}>{task.owner ?? '—'}</td>
                  <td data-summary-task-prazo={prazo.data ?? ''} className={`py-1.5 pr-4 tabular ${prazo.data || prazo.dito ? '' : 'text-text-muted'}`}>
                    {prazo.data ? (
                      <>
                        {prazo.data}
                        {prazo.dito && <span className="text-text-muted"> {prazo.dito}</span>}
                      </>
                    ) : (
                      (prazo.dito ?? '—')
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {linhas &&
                      (tarefa ? (
                        <ActionButton icon={ExternalLink} label="Abrir tarefa" action="tarefa-resumo-abrir" iconOnly data={{ 'data-tarefa-link': tarefa.id }} onClick={() => void navigate(tarefasPath(tarefa.id))} />
                      ) : (
                        <ActionButton icon={Plus} label="Adicionar" action="tarefa-resumo-adicionar" data={{ 'data-summary-task-index': String(index) }} disabled={ocupado} onClick={() => void adicionar([index])} />
                      ))}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {erro && (
        <Note id="tarefa-resumo-erro" icon={TriangleAlert} role="alert" className="mt-3">
          {erro}
        </Note>
      )}
    </section>
  )
}

/** Contrato 116 (R35): os participantes do evento da agenda; com e-mail, o contato ligado ou "+ Contato". */
function Participants({ attendees }: { attendees: readonly MeetingAttendee[] }) {
  return (
    <section aria-label="Participantes" data-summary-participantes>
      <SectionTitle>Participantes</SectionTitle>
      <ul className="flex flex-col">
        {attendees.map((person, index) => {
          const email = person.email.trim()
          const name = person.name.trim() || email.split('@')[0] || email
          return (
            <li key={`${email}-${index}`} data-summary-participante={email} className="flex min-h-9 items-center gap-3 border-b border-line py-1 text-13">
              <span className="min-w-0 shrink truncate text-text select-text">{name}</span>
              <span className="min-w-0 flex-1 truncate text-text-muted select-text">{email}</span>
              {email && <ContactLink email={email} nome={name} origem="reuniao" />}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
