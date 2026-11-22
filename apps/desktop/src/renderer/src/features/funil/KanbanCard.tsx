import { Clock } from 'lucide-react'
import { useEffect, useRef, type DragEvent } from 'react'
import type { Oportunidade, ProximoPassoDerivado } from '@shared/funil'
import { diasNaEtapa, formatarBRL, passoVencido, previsaoVencida } from '@shared/funil-logic'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { diaCurto, textoProximoPasso } from './funilFormat'

/** Tipo do dado arrastado (D6): o id da oportunidade. */
export const FUNIL_CARD_DRAG_TYPE = 'application/x-lap-funil-card'

/** Cartão do kanban: fundo --bg-raised, fio --line, raio 6; em edição (nova, motivo), o fio --accent (artboards 01b e 02). */
export const CARD_CLASS = 'flex min-w-0 flex-col gap-1 rounded-[var(--radius-panel)] border bg-bg-raised p-2.5'

/** "Cancelar" dos formulários do cartão: só o texto, como nos artboards 01b e 02 (o cartão é estreito demais para dois contornos). */
export const CANCELAR_CLASS =
  'no-drag inline-flex h-8 shrink-0 items-center rounded-[var(--radius-control)] px-2 text-13 font-medium text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title disabled:pointer-events-none disabled:opacity-50'

/** O motivo da perda pedido no próprio cartão, ainda na coluna de origem (R24, artboard 01b). */
export interface PerdaPendente {
  etapaNome: string
  motivo: string
  salvando: boolean
  onMotivo: (motivo: string) => void
  onSalvar: () => void
  onCancelar: () => void
}

interface KanbanCardProps {
  oportunidade: Oportunidade
  /** Contrato 124 (D9): `view.proximosPassos[oportunidade.id] ?? null`, o passo derivado das tarefas. */
  proximoPasso: ProximoPassoDerivado | null
  empresa: string | null
  /** `esfriada()` com a última interação da view e `funil.diasEsfriar` (R7). */
  esfriou: boolean
  now: number
  /** `AAAA-MM-DD` de hoje no fuso do Mac. */
  hoje: string
  /** Editar etapas: o cartão fica apagado e não arrasta (artboard 03). */
  apagado: boolean
  arrastando: boolean
  perda: PerdaPendente | null
  onAbrir: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}

/**
 * Cartão de uma oportunidade no kanban (contrato 112, R23): título em uma linha, empresa (ou "Sem empresa"), valor,
 * próximo passo com a data (em --rec quando venceu), a previsão quando venceu e, no rodapé, "há N d nesta etapa" e
 * "esfriou". O clique (sem arrasto) abre a oportunidade; arrastar move (R24). Contrato 125 (R14): o passo é a próxima
 * tarefa aberta (`data-funil-card-tarefa`) ou, sem ela, "Sem tarefa".
 */
export function KanbanCard({ oportunidade, proximoPasso, empresa, esfriou, now, hoje, apagado, arrastando, perda, onAbrir, onDragStart, onDragEnd }: KanbanCardProps) {
  const ref = useRef<HTMLDivElement>(null)
  const emPerda = perda !== null
  // O motivo pedido pelo soltar em Perdido: o foco vai para o campo.
  useEffect(() => {
    if (emPerda) ref.current?.querySelector<HTMLInputElement>('[data-funil-motivo]')?.focus()
  }, [emPerda])

  const titulo = (
    <p data-funil-card-titulo className="truncate text-13 font-semibold text-title" title={oportunidade.titulo}>
      {oportunidade.titulo}
    </p>
  )

  if (perda) {
    return (
      <div
        ref={ref}
        data-funil-card={oportunidade.id}
        data-funil-card-perda=""
        className={`${CARD_CLASS} border-accent`}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || event.defaultPrevented) return
          event.preventDefault()
          perda.onCancelar()
        }}
      >
        {titulo}
        <p className="mt-1 text-13 text-text-muted">
          Solto em <span className="font-semibold text-title">{perda.etapaNome}</span>
        </p>
        <label htmlFor={`funil-motivo-${oportunidade.id}`} className="mt-1 text-12 text-text-muted">
          Motivo
        </label>
        <div className="flex">
          <TextField id={`funil-motivo-${oportunidade.id}`} value={perda.motivo} onChange={perda.onMotivo} onEnter={() => perda.motivo.trim() && perda.onSalvar()} maxLength={2000} disabled={perda.salvando} data={{ 'data-funil-motivo': '' }} />
        </div>
        <div className="mt-1 flex items-center gap-1">
          <Button action="funil-motivo-salvar" onClick={perda.onSalvar} disabled={!perda.motivo.trim() || perda.salvando}>
            Salvar
          </Button>
          <button type="button" data-action="funil-motivo-cancelar" onClick={perda.onCancelar} disabled={perda.salvando} className={CANCELAR_CLASS}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  const passo = textoProximoPasso(proximoPasso)
  const vencido = passoVencido(proximoPasso, hoje)
  const previsao = oportunidade.previsao !== null && previsaoVencida(oportunidade.previsao, hoje) ? oportunidade.previsao : null
  return (
    <div
      ref={ref}
      data-funil-card={oportunidade.id}
      role="button"
      tabIndex={apagado ? -1 : 0}
      aria-label={`${oportunidade.titulo}, ${empresa ?? 'sem empresa'}, ${formatarBRL(oportunidade.valor)}`}
      draggable={!apagado}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={() => !apagado && onAbrir()}
      onKeyDown={(event) => {
        if (apagado || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        onAbrir()
      }}
      className={`${CARD_CLASS} border-line transition-opacity duration-[var(--duration-fast)] ease-[var(--ease-out)] ${apagado ? 'pointer-events-none opacity-60' : 'hover:border-line-strong'} ${arrastando ? 'opacity-50' : ''}`}
    >
      {titulo}
      <p className="truncate text-13 text-text-muted">{empresa ?? 'Sem empresa'}</p>
      <p className="text-13 font-semibold text-title tabular">{formatarBRL(oportunidade.valor)}</p>
      <p data-funil-card-passo data-funil-card-tarefa={proximoPasso?.tarefaId} data-funil-card-vencido={vencido ? '' : undefined} className={`flex min-w-0 items-center gap-1.5 text-13 ${vencido ? 'text-rec' : proximoPasso ? 'text-text' : 'text-text-muted'}`}>
        <Icon icon={Clock} size={14} className={`shrink-0 ${vencido ? '' : 'text-text-muted'}`} />
        <span className="min-w-0 flex-1 truncate">{passo.texto}</span>
        {passo.data && <span className="shrink-0 tabular">{passo.data}</span>}
      </p>
      {previsao && (
        <p data-funil-card-previsao-vencida="" className="truncate text-12 text-rec">
          Previsão {diaCurto(previsao)}
        </p>
      )}
      <div className="mt-1 flex items-center gap-2 border-t border-line pt-2 text-12">
        <span className="min-w-0 flex-1 truncate text-text-faint">há {diasNaEtapa(oportunidade.movidoEm, now)} d nesta etapa</span>
        {esfriou && (
          <span data-funil-card-esfriou="" className="shrink-0 font-medium text-rec">
            esfriou
          </span>
        )}
      </div>
    </div>
  )
}
