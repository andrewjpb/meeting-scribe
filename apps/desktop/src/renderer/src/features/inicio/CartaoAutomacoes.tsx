import { Clock, TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router'
import type { ScheduledTask } from '@shared/automations'
import { ROUTE_PATHS } from '@shared/routes'
import { Icon } from '../../design/Icon'
import { useAutomations } from '../agents/automationsStore'
import { INICIO_CARTAO_CABECALHO_CLASS, INICIO_CARTAO_CLASS, INICIO_CARTAO_TITULO_CLASS, INICIO_LINK_CLASS, textoFalha, textoQuandoVai } from './inicioFormat'

/** O agendamento cuja última execução falhou (erro ou tempo esgotado) mais recente; `null` sem nenhum. */
export function ultimaFalha(tasks: readonly ScheduledTask[]): ScheduledTask | null {
  let falha: ScheduledTask | null = null
  for (const task of tasks) {
    if (task.lastStatus !== 'error' && task.lastStatus !== 'timeout') continue
    if (!falha || Date.parse(task.lastRunAt ?? '') > Date.parse(falha.lastRunAt ?? '')) falha = task
  }
  return falha
}

/**
 * Automações (D9, artboard 01): só quando há agendamento, a próxima execução e, se a última de algum agendamento falhou,
 * o aviso em --rec com "Ver histórico" (Automações › Execuções). Sem próxima nem falha, o cartão não aparece.
 */
export function CartaoAutomacoes({ agora }: { agora: number }) {
  const navigate = useNavigate()
  const proxima = useAutomations((state) => state.status.next[0] ?? null)
  const falha = useAutomations((state) => ultimaFalha(state.tasks))
  useEffect(() => {
    void useAutomations.getState().load()
  }, [])
  if (!proxima && !falha) return null
  const verHistorico = (): void => {
    useAutomations.getState().setTab('execucoes')
    void navigate(ROUTE_PATHS.automacoes)
  }
  return (
    <section data-inicio-cartao="automacoes" aria-label="Automações" className={INICIO_CARTAO_CLASS}>
      <header className={INICIO_CARTAO_CABECALHO_CLASS}>
        <h2 className={INICIO_CARTAO_TITULO_CLASS}>Automações</h2>
      </header>
      {proxima && (
        <p data-inicio-automacao="proxima" className="flex min-h-8 items-center gap-2.5 text-13 text-text">
          <Icon icon={Clock} size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate">
            Próxima: <b className="font-medium text-title">{proxima.name}</b>
          </span>
          <span className="shrink-0 text-12 text-text-muted tabular">{textoQuandoVai(new Date(proxima.at), new Date(agora))}</span>
        </p>
      )}
      {falha && (
        <p data-inicio-automacao="falha" className={`flex min-h-8 items-center gap-2.5 text-13 text-rec ${proxima ? 'border-t border-line' : ''}`}>
          <Icon icon={TriangleAlert} size={14} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            {textoFalha(falha.name, falha.lastRunAt, agora)}
          </span>
          <button type="button" onClick={verHistorico} data-inicio-abrir="execucoes" className={INICIO_LINK_CLASS}>
            Ver histórico
          </button>
        </p>
      )}
    </section>
  )
}
