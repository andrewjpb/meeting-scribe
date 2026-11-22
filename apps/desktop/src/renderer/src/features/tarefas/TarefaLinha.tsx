import { Bot, Check, Funnel, Mail, NotebookText, Pencil, Smartphone, Sparkles, Star, User, X, type LucideIcon } from 'lucide-react'
import { useState, type MouseEvent } from 'react'
import { useNavigate } from 'react-router'
import { tarefasPath } from '@shared/routes'
import type { Tarefa, TarefasView } from '@shared/tarefas'
import { Icon } from '../../design/Icon'
import { textoOrigem, textoPrazo, textoResponsavel, type IconeOrigem } from './tarefasFormat'
import { useTarefas } from './tarefasStore'

/** O ícone de cada origem (R3): o mesmo da barra lateral para Reuniões, Funil, Email, WhatsApp e Assistente. */
export const ORIGEM_ICONE: Record<IconeOrigem, LucideIcon> = {
  reuniao: NotebookText,
  oportunidade: Funnel,
  email: Mail,
  whatsapp: Smartphone,
  assistente: Sparkles,
  automacao: Bot,
  manual: Pencil,
}

interface CaixaFeitoProps {
  tarefa: Pick<Tarefa, 'id' | 'titulo' | 'status'>
  /** Gancho `data-*` da caixa (`data-tarefa-feito` na linha). */
  data?: Readonly<Record<`data-${string}`, string>>
  onErro?: ((mensagem: string) => void) | undefined
}

/**
 * Caixa de feito (R3): na aberta, o clique marca feita; na feita (ou cancelada), reabre. 16 px com o fio de 1 px; marcada
 * em --accent; a cancelada mostra o "×" (só Reabrir sai dela).
 */
export function CaixaFeito({ tarefa, data, onErro }: CaixaFeitoProps) {
  const [ocupado, setOcupado] = useState(false)
  const feita = tarefa.status === 'feita'
  const cancelada = tarefa.status === 'cancelada'
  const alternar = async (event: MouseEvent): Promise<void> => {
    event.stopPropagation()
    if (ocupado) return
    setOcupado(true)
    const result = await useTarefas.getState().status(tarefa.id, tarefa.status === 'aberta' ? 'feita' : 'aberta')
    setOcupado(false)
    if (!result.ok) onErro?.(result.mensagem)
  }
  const rotulo = tarefa.status === 'aberta' ? `Concluir "${tarefa.titulo}"` : `Reabrir "${tarefa.titulo}"`
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={feita}
      aria-label={rotulo}
      title={tarefa.status === 'aberta' ? 'Concluir' : 'Reabrir'}
      {...data}
      onClick={(event) => void alternar(event)}
      className={`no-drag flex size-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${
        feita ? 'border-accent bg-accent text-on-accent' : cancelada ? 'border-text-faint bg-bg-raised text-text-muted' : 'border-text-faint bg-bg-raised text-transparent hover:border-accent'
      }`}
    >
      {(feita || cancelada) && <Icon icon={feita ? Check : X} size={14} />}
    </button>
  )
}

export interface TarefaLinhaProps {
  tarefa: Tarefa
  /** A view inteira: o dia de hoje e os nomes da origem e do responsável. */
  view: TarefasView
  /** Sem ela, o clique na linha (fora da caixa) abre `/tarefas/<id>`. */
  onAbrir?: ((id: string) => void) | undefined
  /**
   * `larga` (padrão): uma linha de 44 px com caixa, título, origem (236), responsável (112), estrela e prazo (92).
   * `estreita`: a lista de 340 px ao lado do detalhe, em duas linhas (título; "origem · prazo").
   */
  variante?: 'larga' | 'estreita' | undefined
  /** A tarefa aberta no detalhe ao lado (fundo --bg-sunken). */
  atual?: boolean | undefined
  /** A caixa de feito não gravou: o texto do erro, para quem usa mostrar numa `Note`. */
  onErro?: ((mensagem: string) => void) | undefined
  /** Sem a coluna da origem (só na `larga`): a seção Tarefas da oportunidade, onde ela repetiria a própria (contrato 130, M7). */
  ocultarOrigem?: boolean | undefined
}

/**
 * Uma tarefa na lista (contrato 123, R3; reusada pelo 125 e pelo 126): caixa de feito, título truncado, origem com o
 * ícone, responsável quando não é "eu", estrela de importante (--title, sem cor nova) e o prazo à direita ("hoje" em
 * --text, vencido em --rec com "há N d"). A feita e a cancelada ficam com o título riscado. O clique fora da caixa abre
 * a tarefa.
 */
export function TarefaLinha({ tarefa, view, onAbrir, variante = 'larga', atual = false, onErro, ocultarOrigem = false }: TarefaLinhaProps) {
  const navigate = useNavigate()
  const origem = textoOrigem(tarefa, view.nomes)
  const responsavel = textoResponsavel(tarefa.responsavel, view.nomes)
  const aberta = tarefa.status === 'aberta'
  // Só a aberta vence (R3); a fechada mostra a data sem o atraso.
  const prazo = textoPrazo(tarefa.prazo, view.hoje)
  const vencida = aberta && prazo.vencida
  const textoDoPrazo = vencida || !tarefa.prazo ? prazo.texto : prazo.texto.split(' · ')[0]
  const abrir = (): void => (onAbrir ? onAbrir(tarefa.id) : void navigate(tarefasPath(tarefa.id)))
  const titulo = `min-w-0 truncate text-13 font-medium ${aberta ? 'text-title' : 'text-text-muted line-through'}`
  const corPrazo = vencida ? 'font-medium text-rec' : aberta && tarefa.prazo === view.hoje ? 'font-medium text-text' : 'text-text-muted'
  const marcas = {
    'data-tarefa': tarefa.id,
    'data-tarefa-status': tarefa.status,
    'aria-current': atual ? ('true' as const) : undefined,
  }
  const prazoMarcas = { 'data-tarefa-prazo': textoDoPrazo, 'data-tarefa-vencida': vencida ? '' : undefined }
  const estrela = tarefa.importante && (
    // `relative`: o `sr-only` (absoluto) fica preso à estrela e não estica a raiz quando a lista rola (contrato 130, B1).
    <span data-tarefa-importante className="relative flex w-3.5 shrink-0 text-title" title="Importante">
      <Icon icon={Star} size={14} className="fill-current" />
      <span className="sr-only">Importante</span>
    </span>
  )

  if (variante === 'estreita') {
    return (
      <div {...marcas} onClick={abrir} className={`flex min-h-11 cursor-default items-start gap-2.5 rounded-[var(--radius-control)] px-3 py-1.5 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${atual ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}>
        <span className="mt-0.5 flex">
          <CaixaFeito tarefa={tarefa} data={{ 'data-tarefa-feito': '' }} onErro={onErro} />
        </span>
        <button type="button" className="no-drag flex min-w-0 flex-1 flex-col rounded-[var(--radius-control)] text-left">
          <span className={titulo}>{tarefa.titulo}</span>
          <span className="truncate text-12 text-text-muted">
            {origem.nome}
            {textoDoPrazo && (
              <>
                {' · '}
                <span {...prazoMarcas} className={`tabular ${corPrazo}`}>
                  {textoDoPrazo}
                </span>
              </>
            )}
          </span>
        </button>
        {estrela && <span className="mt-0.5 flex">{estrela}</span>}
      </div>
    )
  }

  return (
    <div {...marcas} onClick={abrir} className={`flex h-11 cursor-default items-center gap-3 border-b border-line px-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${atual ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}>
      <CaixaFeito tarefa={tarefa} data={{ 'data-tarefa-feito': '' }} onErro={onErro} />
      <button type="button" className={`no-drag min-w-0 flex-1 rounded-[var(--radius-control)] text-left ${titulo}`}>
        {tarefa.titulo}
      </button>
      {!ocultarOrigem && (
        <span data-tarefa-origem={origem.icone} className="flex w-[236px] min-w-0 shrink-0 items-center gap-1.5 text-12 text-text-muted">
          <Icon icon={ORIGEM_ICONE[origem.icone]} size={14} className="shrink-0 text-text-faint" />
          <span className="min-w-0 truncate">{origem.texto}</span>
        </span>
      )}
      <span data-tarefa-responsavel={responsavel === null ? undefined : ''} className="flex w-[112px] min-w-0 shrink-0 items-center gap-1.5 text-12 text-text-muted">
        {responsavel !== null && (
          <>
            <Icon icon={User} size={14} className="shrink-0 text-text-faint" />
            <span className="min-w-0 truncate">{responsavel}</span>
          </>
        )}
      </span>
      <span className="flex w-3.5 shrink-0">{estrela}</span>
      <span {...prazoMarcas} className={`w-[92px] shrink-0 text-right text-12 whitespace-nowrap tabular ${corPrazo}`}>
        {textoDoPrazo}
      </span>
    </div>
  )
}
