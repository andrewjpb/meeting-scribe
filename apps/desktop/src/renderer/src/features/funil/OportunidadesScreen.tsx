import { Check, ChevronLeft, GripVertical, Pencil, Plus, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import type { Etapa, EtapaTipo, FunilView, Oportunidade } from '@shared/funil'
import { esfriada, formatarBRL } from '@shared/funil-logic'
import { funilPath, type FunilNavigationState } from '@shared/routes'
import { useSettings } from '../../app/settingsStore'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { Segmented } from '../../design/Segmented'
import { SearchField } from '../meetings/SearchField'
import { colunasVisiveis, diaLocal, fechadasRecentes, filtrarOportunidades, FUNIL_FILTROS, textoTotais, type FunilFiltro } from './funilFormat'
import { useFunil } from './funilStore'
import { FUNIL_CARD_DRAG_TYPE, KanbanCard } from './KanbanCard'
import { NovaOportunidadeCard } from './NovaOportunidadeCard'

/** Tipo do dado arrastado pela alça de uma etapa em "Editar etapas" (R26). */
const FUNIL_ETAPA_DRAG_TYPE = 'application/x-lap-funil-etapa'

/** Etapa em "Editar etapas": `chave` é o id (ou um provisório da etapa nova, ainda sem id). */
interface EtapaRascunho {
  chave: string
  id: string | undefined
  nome: string
  tipo: EtapaTipo
}

/** O que está sendo arrastado: um cartão (R24) ou, em "Editar etapas", a alça de uma etapa aberta (R26). */
type Arrasto = { tipo: 'cartao'; id: string } | { tipo: 'etapa'; chave: string }

interface Perda {
  id: string
  etapaId: string
  etapaNome: string
  ordem: number
  motivo: string
  salvando: boolean
}

const COLUMN_BORDER = (alvo: boolean): string => (alvo ? 'border-accent' : 'border-transparent')
const HEAD = 'flex h-[var(--panel-head-h)] shrink-0 border-b border-line'
const DASHED = 'flex items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong px-3 py-6 text-center text-13 text-pretty text-text-muted'

const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** "5 abertas · R$ 392.500 em aberto · …" com o número (ou o valor) de cada parte em negrito, como no artboard 01. */
function Totais({ texto }: { texto: string }) {
  const partes = texto.split(' · ')
  return (
    <p data-funil-totais className="min-w-0 flex-1 truncate text-13 text-text-muted">
      {partes.map((parte, index) => {
        const corte = parte.indexOf(' ')
        return (
          <span key={parte}>
            {index > 0 && ' · '}
            <span className="font-semibold text-title tabular">{corte < 0 ? parte : parte.slice(0, corte)}</span>
            {corte < 0 ? '' : parte.slice(corte)}
          </span>
        )
      })}
    </p>
  )
}

/**
 * Tela Oportunidades (contrato 112, R21 a R26; artboards 01, 01b, 02 e 03): o `PageHeader` com a busca, os filtros e
 * "Nova oportunidade"; a linha de totais com "Editar etapas"; e o quadro com uma coluna por etapa, que rola na
 * horizontal. As etapas fora do filtro viram faixas de 32 px que abrem no clique e aceitam o cartão arrastado sem abrir.
 */
export function OportunidadesScreen({ view }: { view: FunilView }) {
  const { state, ultimas } = view
  const navigate = useNavigate()
  const location = useLocation()
  const diasEsfriar = useSettings((store) => store.settings.funil.diasEsfriar)
  const [now, setNow] = useState(() => Date.now())
  const [filtro, setFiltroAtual] = useState<FunilFiltro>('abertas')
  const [busca, setBusca] = useState('')
  // Faixas abertas no clique e colunas finais com "Mostrar todas": valem até trocar de filtro.
  const [expandidas, setExpandidas] = useState<ReadonlySet<string>>(() => new Set())
  const [todas, setTodas] = useState<ReadonlySet<string>>(() => new Set())
  // Contrato 112 (D14): `FunilNavigationState.nova` abre o cartão já preenchido.
  const [nova, setNova] = useState<{ contatoIds: string[]; empresaId: string | null } | null>(() => (location.state as FunilNavigationState | null)?.nova ?? null)
  const [perda, setPerda] = useState<Perda | null>(null)
  const [arrastando, setArrastando] = useState<string | null>(null)
  const [alvo, setAlvo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<EtapaRascunho[] | null>(null)
  const [salvandoEtapas, setSalvandoEtapas] = useState(false)
  const [focarEtapa, setFocarEtapa] = useState<string | null>(null)
  const arrasto = useRef<Arrasto | null>(null)
  const novas = useRef(0)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // O `state` da navegação já virou o cartão: sai do histórico para não abrir de novo.
  useEffect(() => {
    if ((location.state as FunilNavigationState | null)?.nova) void navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  // A etapa criada por "+ Etapa" ganha o foco no nome.
  useEffect(() => {
    if (focarEtapa) document.querySelector<HTMLInputElement>(`[data-funil-etapa-nome="${CSS.escape(focarEtapa)}"]`)?.focus()
  }, [focarEtapa])

  const setFiltro = (valor: FunilFiltro): void => {
    setFiltroAtual(valor)
    setExpandidas(new Set())
    setTodas(new Set())
  }

  const editando = rascunho !== null
  const hoje = diaLocal(now)
  const etapasDoQuadro: Etapa[] = rascunho ? rascunho.map((etapa, ordem) => ({ id: etapa.chave, nome: etapa.nome, tipo: etapa.tipo, ordem })) : state.etapas
  const etapaPorId = new Map(state.etapas.map((etapa) => [etapa.id, etapa]))
  const empresas = new Map(state.empresas.map((empresa) => [empresa.id, empresa.nome]))
  const primeiraAberta = [...state.etapas].sort((a, b) => a.ordem - b.ordem).find((etapa) => etapa.tipo === 'aberta') ?? null
  const ultimaAberta = [...etapasDoQuadro].reverse().find((etapa) => etapa.tipo === 'aberta')?.id ?? null
  const colunas = colunasVisiveis(etapasDoQuadro, filtro).map(({ etapa, recolhida }) => ({
    etapa,
    // Em "Editar etapas" as abertas ficam sempre abertas (o nome vira campo).
    recolhida: recolhida && !expandidas.has(etapa.id) && !(editando && etapa.tipo === 'aberta'),
  }))
  // A busca vale dentro do filtro: cada coluna aberta mostra as achadas dela.
  const achadas = filtrarOportunidades(state, 'todas', busca)
  const daEtapa = (etapaId: string): Oportunidade[] => achadas.filter((item) => item.etapaId === etapaId).sort((a, b) => a.ordem - b.ordem)
  const totalDaEtapa = (etapaId: string): number => state.oportunidades.filter((item) => item.etapaId === etapaId && !item.arquivado).length
  const emUso = (etapaId: string): boolean => state.oportunidades.some((item) => item.etapaId === etapaId)

  const abrir = (id: string): void => void navigate(funilPath('oportunidades', id))

  // ---- Arrastar cartões (R24, D6) ----------------------------------------------------------------------------------

  /** Posição na coluna destino pelo Y do ponteiro: antes do primeiro cartão cujo meio fica abaixo dele. */
  const ordemNoSoltar = (event: DragEvent<HTMLElement>, etapaId: string, id: string): number => {
    const coluna = state.oportunidades.filter((item) => item.etapaId === etapaId && !item.arquivado && item.id !== id).sort((a, b) => a.ordem - b.ordem)
    for (const el of event.currentTarget.querySelectorAll<HTMLElement>('[data-funil-card]')) {
      if (el.dataset.funilCard === id) continue
      const box = el.getBoundingClientRect()
      if (event.clientY < box.top + box.height / 2) {
        const index = coluna.findIndex((item) => item.id === el.dataset.funilCard)
        if (index >= 0) return index
      }
    }
    return coluna.length
  }

  const soltarCartao = async (id: string, etapa: Etapa, ordem: number): Promise<void> => {
    const oportunidade = state.oportunidades.find((item) => item.id === id)
    if (!oportunidade) return
    // Perdido pede o motivo no próprio cartão, que fica na coluna de origem até o "Salvar".
    if (etapa.tipo === 'perdido' && oportunidade.etapaId !== etapa.id) {
      setPerda({ id, etapaId: etapa.id, etapaNome: etapa.nome, ordem, motivo: '', salvando: false })
      return
    }
    if (oportunidade.etapaId === etapa.id && oportunidade.ordem === ordem) return
    const result = await useFunil.getState().moveOportunidade({ id, etapaId: etapa.id, ordem })
    if (!result.ok) setErro(result.mensagem)
  }

  const salvarPerda = async (): Promise<void> => {
    if (!perda || !perda.motivo.trim() || perda.salvando) return
    setPerda({ ...perda, salvando: true })
    const result = await useFunil.getState().moveOportunidade({ id: perda.id, etapaId: perda.etapaId, ordem: perda.ordem, motivoPerda: perda.motivo.trim() })
    if (result.ok) {
      setPerda(null)
      return
    }
    setPerda((atual) => (atual ? { ...atual, salvando: false } : atual))
    setErro(result.mensagem)
  }

  const fimDoArrasto = (): void => {
    arrasto.current = null
    setArrastando(null)
    setAlvo(null)
  }

  const sobre = (etapa: Etapa) => (event: DragEvent<HTMLElement>) => {
    const atual = arrasto.current
    if (!atual || (atual.tipo === 'etapa' ? etapa.tipo !== 'aberta' || atual.chave === etapa.id : editando)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (alvo !== etapa.id) setAlvo(etapa.id)
  }
  const saiu = (etapa: Etapa) => (event: DragEvent<HTMLElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
    setAlvo((atual) => (atual === etapa.id ? null : atual))
  }
  const soltou = (etapa: Etapa, recolhida: boolean) => (event: DragEvent<HTMLElement>) => {
    const atual = arrasto.current
    fimDoArrasto()
    if (!atual) return
    event.preventDefault()
    if (atual.tipo === 'etapa') {
      moverEtapa(atual.chave, etapa.id)
      return
    }
    // A faixa recolhida aceita o cartão sem abrir: ele entra no topo da etapa.
    void soltarCartao(atual.id, etapa, recolhida ? 0 : ordemNoSoltar(event, etapa.id, atual.id))
  }
  const alvoDe = (etapa: Etapa) => ({
    'data-funil-drop-alvo': alvo === etapa.id ? '' : undefined,
    onDragOver: sobre(etapa),
    onDragEnter: sobre(etapa),
    onDragLeave: saiu(etapa),
    onDrop: (event: DragEvent<HTMLElement>) => soltou(etapa, event.currentTarget.hasAttribute('data-funil-column-collapsed'))(event),
  })

  // ---- Editar etapas (R26) -----------------------------------------------------------------------------------------

  const editarEtapas = (): void => {
    setNova(null)
    setPerda(null)
    setErro(null)
    setRascunho([...state.etapas].sort((a, b) => a.ordem - b.ordem).map((etapa) => ({ chave: etapa.id, id: etapa.id, nome: etapa.nome, tipo: etapa.tipo })))
  }
  const renomear = (chave: string, nome: string): void => setRascunho((lista) => lista?.map((etapa) => (etapa.chave === chave ? { ...etapa, nome } : etapa)) ?? null)
  const apagarEtapa = (chave: string): void => setRascunho((lista) => lista?.filter((etapa) => etapa.chave !== chave) ?? null)
  const novaEtapa = (): void => {
    novas.current += 1
    const chave = `nova-${novas.current}`
    setRascunho((lista) => {
      if (!lista) return lista
      const fim = lista.findIndex((etapa) => etapa.tipo !== 'aberta')
      const copia = [...lista]
      copia.splice(fim < 0 ? copia.length : fim, 0, { chave, id: undefined, nome: 'Nova etapa', tipo: 'aberta' })
      return copia
    })
    setFocarEtapa(chave)
  }
  /** Leva a etapa aberta `chave` para o lugar de `para` (outra aberta). */
  function moverEtapa(chave: string, para: string): void {
    setRascunho((lista) => {
      if (!lista) return lista
      const de = lista.findIndex((etapa) => etapa.chave === chave)
      const ate = lista.findIndex((etapa) => etapa.chave === para)
      if (de < 0 || ate < 0 || de === ate || lista[ate]?.tipo !== 'aberta') return lista
      const copia = [...lista]
      const [item] = copia.splice(de, 1)
      if (item) copia.splice(ate, 0, item)
      return copia
    })
  }
  /** A alça também anda pelo teclado: seta para a esquerda e para a direita trocam de lugar com a etapa vizinha. */
  const alcaTeclado = (chave: string) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!rascunho || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
    event.preventDefault()
    const abertas = rascunho.filter((etapa) => etapa.tipo === 'aberta')
    const index = abertas.findIndex((etapa) => etapa.chave === chave)
    const vizinha = abertas[index + (event.key === 'ArrowLeft' ? -1 : 1)]
    if (vizinha) moverEtapa(chave, vizinha.chave)
  }
  const concluir = async (): Promise<void> => {
    if (!rascunho || salvandoEtapas) return
    setSalvandoEtapas(true)
    setErro(null)
    const result = await useFunil.getState().saveEtapas(rascunho.map((etapa) => (etapa.id === undefined ? { nome: etapa.nome.trim(), tipo: etapa.tipo } : { id: etapa.id, nome: etapa.nome.trim(), tipo: etapa.tipo })))
    setSalvandoEtapas(false)
    if (result.ok) setRascunho(null)
    else setErro(result.mensagem)
  }

  // ---- Colunas -----------------------------------------------------------------------------------------------------

  const cabecalho = (etapa: Etapa, lista: readonly Oportunidade[]) => {
    if (editando && etapa.tipo === 'aberta') {
      const vazia = !emUso(etapa.id)
      return (
        <header data-funil-column-head className={`${HEAD} items-center gap-1 px-1.5`}>
          <button
            type="button"
            draggable
            data-funil-etapa-alca={etapa.id}
            aria-label={`Mover a etapa ${etapa.nome} (arraste ou use as setas)`}
            title="Arraste para reordenar"
            onKeyDown={alcaTeclado(etapa.id)}
            onDragStart={(event) => {
              event.dataTransfer.setData(FUNIL_ETAPA_DRAG_TYPE, etapa.id)
              event.dataTransfer.effectAllowed = 'move'
              arrasto.current = { tipo: 'etapa', chave: etapa.id }
            }}
            onDragEnd={fimDoArrasto}
            className="no-drag inline-flex size-6 shrink-0 cursor-grab items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title"
          >
            <Icon icon={GripVertical} size={14} />
          </button>
          <div className="flex min-w-0 flex-1">
            <TextField value={etapa.nome} onChange={(nome) => renomear(etapa.id, nome)} ariaLabel="Nome da etapa" maxLength={60} disabled={salvandoEtapas} data={{ 'data-funil-etapa-nome': etapa.id }} />
          </div>
          {/* O botão desabilitado não recebe o ponteiro (`disabled:pointer-events-none`): a dica fica no invólucro. Desabilitado,
              sai do vermelho para o tom neutro, como os demais `ActionButton` desabilitados (no escuro, o vermelho esmaecido
              parecia ativo). */}
          <span className="inline-flex shrink-0" title={vazia ? undefined : 'Só uma etapa aberta e vazia pode ser apagada'}>
            <ActionButton
              icon={X}
              iconOnly
              tone={vazia && !salvandoEtapas ? 'danger' : 'normal'}
              action="funil-etapa-apagar"
              label={vazia ? `Apagar a etapa ${etapa.nome}` : 'Só uma etapa aberta e vazia pode ser apagada'}
              disabled={!vazia || salvandoEtapas}
              data={{ 'data-funil-etapa-apagar': etapa.id }}
              onClick={() => apagarEtapa(etapa.id)}
            />
          </span>
        </header>
      )
    }
    if (editando) {
      return (
        <header data-funil-column-head className={`${HEAD} items-center gap-1.5 px-2`}>
          <Icon icon={Pencil} size={14} className="shrink-0 text-text-muted" />
          <div className="flex min-w-0 flex-1">
            <TextField value={etapa.nome} onChange={(nome) => renomear(etapa.id, nome)} ariaLabel={`Nome da etapa ${etapa.tipo === 'ganho' ? 'de ganho' : 'de perda'}`} maxLength={60} disabled={salvandoEtapas} data={{ 'data-funil-etapa-nome': etapa.id }} />
          </div>
        </header>
      )
    }
    const soma = lista.reduce((total, item) => total + (item.valor ?? 0), 0)
    return (
      <header data-funil-column-head className={`${HEAD} flex-col justify-center px-3`}>
        <p className="flex min-w-0 items-baseline gap-1.5 text-13">
          <span className="min-w-0 truncate font-semibold text-title">{etapa.nome}</span>
          <span data-funil-column-count className="shrink-0 text-12 text-text-muted tabular">
            {lista.length}
          </span>
        </p>
        <p data-funil-column-sum className="truncate text-12 text-text-muted tabular">
          {formatarBRL(soma)}
        </p>
      </header>
    )
  }

  const coluna = (etapa: Etapa) => {
    const lista = editando && !etapaPorId.has(etapa.id) ? [] : daEtapa(etapa.id)
    const final = etapa.tipo !== 'aberta'
    // Colunas finais: as fechadas nos últimos 90 dias, a não ser com "Mostrar todas".
    const mostradas = final && !todas.has(etapa.id) ? fechadasRecentes(lista, now) : lista
    const comNova = !editando && nova !== null && primeiraAberta?.id === etapa.id
    const vazia = mostradas.length === 0 && !comNova
    return (
      <section
        key={etapa.id}
        data-funil-column={etapa.id}
        data-funil-column-tipo={etapa.tipo}
        aria-label={etapa.nome}
        {...alvoDe(etapa)}
        className={`flex min-w-[170px] flex-1 basis-0 flex-col overflow-hidden rounded-[var(--radius-panel)] border bg-bg-sunken ${COLUMN_BORDER(alvo === etapa.id)}`}
      >
        {cabecalho(etapa, lista)}
        <div data-funil-column-body className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {comNova && primeiraAberta && <NovaOportunidadeCard state={state} etapa={primeiraAberta} inicial={nova} onFechar={() => setNova(null)} onAbrir={abrir} />}
          {mostradas.map((item) => {
            const etapaReal = etapaPorId.get(item.etapaId)
            return (
              <KanbanCard
                key={item.id}
                oportunidade={item}
                proximoPasso={view.proximosPassos[item.id] ?? null}
                empresa={item.empresaId ? (empresas.get(item.empresaId) ?? null) : null}
                esfriou={etapaReal ? esfriada(item, etapaReal, ultimas[item.id] ?? Math.max(item.movidoEm, item.atualizadoEm), diasEsfriar, now) : false}
                now={now}
                hoje={hoje}
                apagado={editando}
                arrastando={arrastando === item.id}
                perda={
                  perda?.id === item.id
                    ? {
                        etapaNome: perda.etapaNome,
                        motivo: perda.motivo,
                        salvando: perda.salvando,
                        onMotivo: (motivo) => setPerda((atual) => (atual ? { ...atual, motivo } : atual)),
                        onSalvar: () => void salvarPerda(),
                        onCancelar: () => setPerda(null),
                      }
                    : null
                }
                onAbrir={() => abrir(item.id)}
                onDragStart={(event) => {
                  event.dataTransfer.setData(FUNIL_CARD_DRAG_TYPE, item.id)
                  event.dataTransfer.effectAllowed = 'move'
                  arrasto.current = { tipo: 'cartao', id: item.id }
                  setArrastando(item.id)
                  setPerda(null)
                  setErro(null)
                }}
                onDragEnd={fimDoArrasto}
              />
            )
          })}
          {vazia && (
            <div data-funil-column-empty className={DASHED}>
              {editando ? 'Etapa vazia' : 'Arraste uma oportunidade para cá'}
            </div>
          )}
          {mostradas.length < lista.length && (
            <button
              type="button"
              data-funil-mostrar-todas={etapa.id}
              onClick={() => setTodas((atual) => new Set([...atual, etapa.id]))}
              className="no-drag h-8 shrink-0 rounded-[var(--radius-control)] text-13 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
            >
              Mostrar todas ({lista.length})
            </button>
          )}
        </div>
      </section>
    )
  }

  const faixa = (etapa: Etapa) => {
    const total = totalDaEtapa(etapa.id)
    return (
      <button
        key={etapa.id}
        type="button"
        data-funil-column={etapa.id}
        data-funil-column-tipo={etapa.tipo}
        data-funil-column-collapsed=""
        aria-expanded={false}
        aria-label={`${etapa.nome}, ${total} ${total === 1 ? 'oportunidade' : 'oportunidades'}: ${editando ? 'renomear' : 'abrir a coluna'}`}
        {...alvoDe(etapa)}
        onClick={() => setExpandidas((atual) => new Set([...atual, etapa.id]))}
        className={`no-drag flex w-8 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-panel)] border bg-bg-sunken py-3 text-title transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-line ${COLUMN_BORDER(alvo === etapa.id)}`}
      >
        <Icon icon={editando ? Pencil : ChevronLeft} size={14} className="shrink-0 text-text-muted" />
        <span className="text-13 font-semibold whitespace-nowrap [writing-mode:vertical-rl]">
          {etapa.nome}{' '}
          <span data-funil-column-count className="font-normal text-text-muted tabular">
            {total}
          </span>
        </span>
      </button>
    )
  }

  const quadro = colunas.flatMap(({ etapa, recolhida }) => {
    const item = recolhida ? faixa(etapa) : coluna(etapa)
    if (!editando || etapa.id !== ultimaAberta) return [item]
    return [
      item,
      <button
        key="+etapa"
        type="button"
        data-action="funil-etapa-add"
        aria-label="Nova etapa"
        disabled={salvandoEtapas}
        onClick={novaEtapa}
        className="no-drag flex w-8 shrink-0 flex-col items-center gap-2 rounded-[var(--radius-panel)] border border-dashed border-line-strong py-3 text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken"
      >
        <Icon icon={Plus} size={14} className="shrink-0" />
        <span className="text-13 font-medium whitespace-nowrap [writing-mode:vertical-rl]">Etapa</span>
      </button>,
    ]
  })

  const aviso = erro && (
    <Note
      id="funil-erro"
      icon={TriangleAlert}
      role="alert"
      className="min-w-0 flex-1"
      action={
        <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setErro(null)}>
          Fechar
        </button>
      }
    >
      {erro}
    </Note>
  )

  return (
    <div data-funil-oportunidades className="flex min-h-0 flex-1 flex-col">
      <div className="px-[var(--page-x)] pt-[var(--page-top)]">
        <PageHeader
          title="Oportunidades"
          actions={
            <>
              {/* A busca estreita, para o cabeçalho caber numa linha em 1120 px, mas com o "Buscar oportunidades" inteiro. */}
              <div className="[&>div]:w-[208px]">
                <SearchField value={busca} onChange={setBusca} label="Buscar oportunidades" />
              </div>
              <span id="funil-filtro-label" className="sr-only">
                Mostrar
              </span>
              <Segmented value={filtro} options={FUNIL_FILTROS} onChange={setFiltro} labelledBy="funil-filtro-label" dataName="funil-filtro" />
              <Button
                icon={Plus}
                action="funil-nova"
                disabled={editando}
                onClick={() => {
                  setFiltro('abertas')
                  setPerda(null)
                  setNova({ contatoIds: [], empresaId: null })
                }}
              >
                Nova oportunidade
              </Button>
            </>
          }
        />
        <div className="mt-3 flex min-h-8 items-center gap-3">
          {aviso ??
            (editando ? (
              <p data-funil-etapas-dica className="min-w-0 flex-1 truncate text-13 text-text-muted">
                Arraste pela alça para reordenar. Só uma etapa aberta e vazia pode ser apagada.
              </p>
            ) : (
              <Totais texto={textoTotais(state, now, timeZone())} />
            ))}
          {editando ? (
            <Button icon={Check} action="funil-etapas-concluir" disabled={salvandoEtapas} onClick={() => void concluir()}>
              Concluir
            </Button>
          ) : (
            <Button icon={Pencil} variant="secondary" action="funil-editar-etapas" onClick={editarEtapas}>
              Editar etapas
            </Button>
          )}
        </div>
      </div>
      <div data-funil-board className="mt-3 flex min-h-0 flex-1 gap-2 overflow-x-auto px-[var(--page-x)] pb-5">
        {quadro}
      </div>
    </div>
  )
}
