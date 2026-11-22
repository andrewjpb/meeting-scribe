import { Funnel, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { TAREFA_TITULO_MAX, type OrigemTarefa, type VinculosTarefa } from '@shared/tarefas'
import { Button } from '../../design/Button'
import { CONTROL_CLASS } from '../../design/Field'
import { Note } from '../../design/Note'
import type { PickerItem } from '../funil/funilFormat'
import { useFunil } from '../funil/funilStore'
import { CANCELAR_CLASS } from '../funil/KanbanCard'
import { SearchPicker } from '../funil/SearchPicker'
import { useTarefas } from './tarefasStore'

export interface NovaTarefaInlineProps {
  /** De onde a tarefa vem; padrão `{ tipo: 'manual' }`. */
  origem?: OrigemTarefa | undefined
  /** Os vínculos com que ela nasce (o contato do e-mail, a conversa…); a oportunidade escolhida no campo vale por cima. */
  vinculosIniciais?: Partial<VinculosTarefa> | undefined
  tituloInicial?: string | undefined
  /** O id da oportunidade a que ela fica ligada: sem o campo de oportunidade (a seção Tarefas do funil, 125). */
  oportunidadeFixa?: string | undefined
  /**
   * Contrato 130 (M1, M2): a variante do e-mail e do WhatsApp, sem a caixa de feito, sem o campo de oportunidade e com a
   * dica curta; título e prazo numa linha e, sem espaço (o painel de 300 px), prazo, Criar e Cancelar juntos na segunda.
   */
  compacta?: boolean | undefined
  onCriada: (id: string) => void
  onCancelar: () => void
}

/** O dia digitado no `<input type="date">` (vazio, sem prazo). */
const prazoDe = (texto: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null)

/**
 * "Nova tarefa" em linha (contrato 123, R6, artboard 05; reusada pelo 125 e pelo 126): título (com o foco ao abrir),
 * prazo e, sem `oportunidadeFixa` (nem `compacta`), a oportunidade opcional pelo `SearchPicker` do funil, com o ícone do
 * funil e o × (contrato 130). Enter ou "Criar" cria com a origem recebida; título vazio não cria (o botão fica desabilitado
 * e o Enter não faz nada); Esc ou "Cancelar" fecham.
 */
export function NovaTarefaInline({ origem = { tipo: 'manual' }, vinculosIniciais, tituloInicial = '', oportunidadeFixa, compacta = false, onCriada, onCancelar }: NovaTarefaInlineProps) {
  const ref = useRef<HTMLDivElement>(null)
  const funil = useFunil((state) => state.view)
  const [titulo, setTitulo] = useState(tituloInicial)
  const [prazo, setPrazo] = useState('')
  const [oportunidade, setOportunidade] = useState<PickerItem | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const comOportunidade = oportunidadeFixa === undefined && !compacta

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('[data-tarefas-nova-titulo]')?.focus()
  }, [])

  // As oportunidades do campo: a view do funil, carregada aqui se nenhuma tela do funil a carregou antes.
  useEffect(() => {
    if (!comOportunidade) return
    const { load, watch } = useFunil.getState()
    const off = watch()
    void load()
    return off
  }, [comOportunidade])

  const pronto = titulo.trim() !== ''
  const etapas = new Map((funil?.state.etapas ?? []).map((etapa) => [etapa.id, etapa]))
  const oportunidades: PickerItem[] = (funil?.state.oportunidades ?? [])
    .filter((item) => !item.arquivado && etapas.get(item.etapaId)?.tipo === 'aberta')
    .map((item) => ({ id: item.id, nome: item.titulo, detalhe: etapas.get(item.etapaId)?.nome }))

  const criar = async (): Promise<void> => {
    if (!pronto || salvando) return
    setSalvando(true)
    setErro(null)
    const oportunidadeId = oportunidadeFixa ?? oportunidade?.id ?? vinculosIniciais?.oportunidadeId ?? null
    const result = await useTarefas.getState().criar({
      titulo: titulo.trim(),
      origem,
      prazo: prazoDe(prazo),
      vinculos: { ...vinculosIniciais, oportunidadeId },
    })
    setSalvando(false)
    if (!result.ok) {
      setErro(result.mensagem)
      return
    }
    if (result.id) onCriada(result.id)
  }

  return (
    <div
      ref={ref}
      data-tarefas-nova
      className="flex flex-col"
      onKeyDown={(event) => {
        // O Esc que fechou a lista do SearchPicker já veio tratado.
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault()
          onCancelar()
        } else if (event.key === 'Enter' && !event.defaultPrevented && (event.target as HTMLElement).matches('[data-tarefas-nova-titulo], [data-tarefas-nova-prazo]')) {
          event.preventDefault()
          void criar()
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-2">
        {!compacta && <span aria-hidden="true" data-tarefas-nova-caixa className="ml-1 size-4 shrink-0 rounded-[3px] border border-text-faint opacity-50" />}
        <input
          type="text"
          data-tarefas-nova-titulo
          aria-label="Título da tarefa"
          placeholder="O que precisa ser feito"
          value={titulo}
          maxLength={TAREFA_TITULO_MAX}
          disabled={salvando}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setTitulo(event.target.value)}
          className={`${CONTROL_CLASS} min-w-[200px] flex-1 px-2.5 select-text placeholder:text-text-faint`}
        />
        {/* Na compacta, prazo, Criar e Cancelar quebram juntos (nunca o Cancelar sozinho) e cabem nos 257 px do painel de
            300 do WhatsApp: 6 entre eles e o prazo cedendo (a 123 px ele mostra "dd/mm/aaaa" inteiro; abaixo de 120, só
            num painel mais estreito, corta o texto em vez de empurrar o Cancelar para fora da borda). */}
        <div className={compacta ? 'flex min-w-0 items-center gap-1.5' : 'contents'}>
          <input
            type="date"
            data-tarefas-nova-prazo
            aria-label="Prazo"
            value={prazo}
            disabled={salvando}
            onChange={(event) => setPrazo(event.target.value)}
            className={`${CONTROL_CLASS} w-[140px] px-2 select-text ${compacta ? 'min-w-[100px]' : 'min-w-0'}`}
          />
          {comOportunidade && (
            <div className="w-[180px]">
              <SearchPicker
                nome="tarefa-nova-oportunidade"
                label="Oportunidade"
                placeholder="Oportunidade"
                icone={Funnel}
                limpar="Tirar a oportunidade"
                itens={oportunidades}
                valor={oportunidade}
                disabled={salvando}
                onChange={setOportunidade}
              />
            </div>
          )}
          <Button action="tarefa-nova-criar" disabled={!pronto || salvando} onClick={() => void criar()}>
            Criar
          </Button>
          <button type="button" data-action="tarefa-nova-cancelar" onClick={onCancelar} disabled={salvando} className={CANCELAR_CLASS}>
            Cancelar
          </button>
        </div>
      </div>
      <p className="mt-1.5 px-2 text-12 text-text-faint">{comOportunidade ? 'Enter cria · Esc cancela · a oportunidade é opcional e traz os contatos dela para os vínculos.' : 'Enter cria · Esc cancela'}</p>
      {erro && (
        <Note id="tarefa-nova-erro" icon={TriangleAlert} role="alert" className="mt-2">
          {erro}
        </Note>
      )}
    </div>
  )
}
