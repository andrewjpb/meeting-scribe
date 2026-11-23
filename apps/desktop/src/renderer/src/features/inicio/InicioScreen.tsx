import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import { formatElapsed } from '../../audio/clock'
import { useRecording } from '../live/recordingStore'
import { useElapsed } from '../live/useElapsed'
import { useMeetingsOverview } from '../meetings/useMeetingsOverview'
import { AgendaDia } from './AgendaDia'
import { CartaoAutomacoes } from './CartaoAutomacoes'
import { CartaoPendencias } from './CartaoPendencias'
import { CartaoTarefas } from './CartaoTarefas'
import { CartaoUltimaReuniao } from './CartaoUltimaReuniao'
import { dataPorExtenso, horaMinuto, INICIO_LINK_CLASS, saudacao } from './inicioFormat'
import { useInicioView } from './inicioStore'

/** O relógio da tela, relido na virada de cada minuto (a marca "agora", o "faltam N min" e a saudação). */
function useAgora(): number {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    let intervalo: ReturnType<typeof setInterval> | undefined
    const tick = (): void => setAgora(Date.now())
    const espera = setTimeout(() => {
      tick()
      intervalo = setInterval(tick, 60_000)
    }, 60_000 - (Date.now() % 60_000))
    return () => {
      clearTimeout(espera)
      if (intervalo) clearInterval(intervalo)
    }
  }, [])
  return agora
}

/**
 * "Gravando agora — 14:32" no cabeçalho (artboard 02, escolha D5): o padrão da tela de bloqueio e do `RecordingNow`
 * (quadrado de 8 em --rec, pulsando só gravando), o título, o tempo gravado ao vivo e "Abrir gravação".
 */
function FaixaGravando() {
  const session = useRecording((state) => state.session)
  const title = useRecording((state) => state.title)
  const startedAt = useRecording((state) => state.startedAt)
  const phase = useRecording((state) => state.capture?.phase ?? 'idle')
  const elapsed = useElapsed(session?.clock ?? null, phase === 'recording')
  if (!session) return null
  return (
    <div data-inicio-gravando role="status" className="mt-3 flex h-10 items-center gap-3 rounded-[var(--radius-panel)] border border-line-strong px-3">
      <span aria-hidden="true" className={`size-2 shrink-0 ${phase === 'recording' ? 'bg-rec rec-pulse' : 'bg-text-faint'}`} />
      <span className="shrink-0 text-13 font-medium whitespace-nowrap text-rec">
        Gravando agora{startedAt && <> — <span className="tabular">{horaMinuto(startedAt)}</span></>}
      </span>
      <span className="min-w-0 flex-1 truncate text-13 font-medium text-title">{title}</span>
      <span className="shrink-0 text-12 text-text-muted tabular" aria-label="Tempo gravado">
        {formatElapsed(elapsed)}
      </span>
      <Link to={ROUTE_PATHS.gravacao} draggable={false} data-inicio-abrir-gravacao="faixa" className={INICIO_LINK_CLASS}>
        Abrir gravação
      </Link>
    </div>
  )
}

/**
 * Tela Início (contrato 135, D1, D9, D11, D12; artboards 01 e 02): o dashboard do dia, só de leitura. Cabeçalho com a
 * saudação e a data por extenso (e a faixa da gravação em andamento); duas colunas (escolha D1): a agenda de hoje em 380
 * px à esquerda e os cartões à direita, na ordem da PRD (Tarefas, Pendências, Última reunião, Automações). Toda ação é um
 * clique explícito: concluir tarefa, abrir uma tela, começar a transcrever. Contrato 136 (D13): o bloco desligado em
 * Configurações › Geral › Início não aparece (sem a agenda, os cartões ocupam a largura toda).
 */
export function InicioScreen() {
  const view = useInicioView()
  const agora = useAgora()
  const { list: reunioes } = useMeetingsOverview()
  const gravando = useRecording((state) => state.session !== null)
  const blocos = useSettings((state) => state.settings.inicio.blocos)
  const duracoes = useMemo(() => new Map((reunioes ?? []).map((entry) => [entry.meeting.id, entry.meeting.durationMs])), [reunioes])
  return (
    <div data-inicio-screen className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-[var(--page-x)] pt-[var(--page-top)]">
        <header className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 data-inicio-saudacao className="truncate text-20 font-bold tracking-[-0.3px] text-title">
              {saudacao(new Date(agora), view?.saudacaoNome ?? null)}
            </h1>
            <p className="text-13 text-text-muted">{dataPorExtenso(new Date(agora))}</p>
          </div>
        </header>
        <FaixaGravando />
      </div>
      <div className={`flex min-h-0 flex-1 gap-6 px-[var(--page-x)] pb-5 ${gravando ? 'pt-3' : 'pt-4'}`}>
        {blocos.agenda && <AgendaDia view={view} agora={agora} duracoes={duracoes} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto">
          {blocos.tarefas && <CartaoTarefas />}
          {blocos.pendencias && <CartaoPendencias pendencias={view?.pendencias ?? null} />}
          {blocos.ultimaReuniao && <CartaoUltimaReuniao reunioes={reunioes} agora={agora} />}
          {blocos.automacoes && <CartaoAutomacoes agora={agora} />}
        </div>
      </div>
    </div>
  )
}
