import { Plus, SearchX, SquareCheck, TriangleAlert } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { TAREFAS_ROOT_PATH, type TarefasNavigationState } from '@shared/routes'
import type { SugestaoTarefa, TarefasView } from '@shared/tarefas'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { Segmented } from '../../design/Segmented'
import { IlustracaoVazia, Vazio } from '../funil/ContatosScreen'
import { useFunilView } from '../funil/funilStore'
import { SearchField } from '../meetings/SearchField'
import { NovaTarefaInline } from './NovaTarefaInline'
import { SugestoesTarefas } from './SugestoesTarefas'
import { TarefaDetalhe } from './TarefaDetalhe'
import { TarefaLinha } from './TarefaLinha'
import { agrupar, filtrarVisao, MODOS_AGRUPAR, VISOES_TAREFAS, type GrupoTarefas, type ModoAgrupar, type VisaoLista, type VisaoTarefas } from './tarefasFormat'
import { useTarefas, useTarefasView } from './tarefasStore'

/** "Agrupar por": o `Select` de 28 px, alinhado ao `Segmented` (artboard 02). */
const AGRUPAR_CLASS =
  'no-drag h-7 w-[140px] rounded-[var(--radius-control)] border border-line-strong bg-bg-raised px-1.5 text-12 text-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]'

/**
 * O cabeçalho de um grupo (R4): 28 px, o nome em --title, a etapa da oportunidade e a contagem; agrupando por oportunidade,
 * a contagem fica à direita em todos os grupos, "Sem oportunidade" também (contrato 130, M6); nos outros modos, colada ao
 * nome (artboard 02). Na estreita, "Vencidas · 2": o ` · ` preservado no começo do item flex (M3).
 */
function CabecalhoGrupo({ grupo, etapa, estreito, contagemADireita }: { grupo: GrupoTarefas; etapa: string | null; estreito: boolean; contagemADireita: boolean }) {
  if (estreito) {
    return (
      <p data-tarefas-grupo-cabecalho className="flex h-7 items-end px-3 pb-1 text-11 font-medium text-text-muted">
        <span className="min-w-0 truncate">{grupo.nome}</span>
        <span className="shrink-0 whitespace-pre tabular">
          {' · '}
          <span data-tarefas-grupo-total>{grupo.tarefas.length}</span>
        </span>
      </p>
    )
  }
  return (
    <div data-tarefas-grupo-cabecalho className="flex h-7 items-center gap-2 border-b border-line-strong px-2 text-12 font-medium text-title">
      <span className="min-w-0 truncate">{grupo.nome}</span>
      {etapa && <span className="shrink-0 font-normal text-text-muted">{etapa}</span>}
      <span data-tarefas-grupo-total className={`shrink-0 font-normal text-text-muted tabular ${contagemADireita ? 'ml-auto' : ''}`}>
        {grupo.tarefas.length}
      </span>
    </div>
  )
}

/**
 * Tela Tarefas (contrato 123, R1 a R7, R26; artboards 02 a 07): `/tarefas/<id>`. O `PageHeader` com a busca (⌘F) e
 * "Nova tarefa" (⌘⇧T); o `Segmented` Hoje · Próximas · Todas · Feitas · Sugestões N e o "Agrupar por"; a lista em
 * grupos e, com o id, o detalhe ao lado (a lista estreita, 340 px). A busca, a visão e o agrupamento ficam na tela, sobre
 * a view carregada (R7); trocar de tarefa não remonta a tela (`Shell`). As sugestões são pedidas ao abrir e a cada
 * gravação das tarefas.
 */
export function TarefasScreen() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const view = useTarefasView()
  const error = useTarefas((state) => state.error)
  const funil = useFunilView()
  const [visao, setVisao] = useState<VisaoTarefas>('hoje')
  const [modo, setModo] = useState<ModoAgrupar>('prazo')
  const [busca, setBusca] = useState('')
  /** 0: o formulário "Nova tarefa" fechado; cada pedido soma 1 e remonta o formulário (o foco volta ao título). */
  const [nova, setNova] = useState(0)
  const [erro, setErro] = useState<string | null>(null)
  const [sugestoes, setSugestoes] = useState<SugestaoTarefa[] | null>(null)
  /** As sugestões adicionadas ou ignoradas desde a última lista do main, escondidas até a próxima chegar. */
  const [feitas, setFeitas] = useState<ReadonlySet<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())

  // ⌘⇧T e "Nova tarefa" com o detalhe aberto chegam pela navegação (`state.nova`): cada pedido abre o formulário uma vez.
  const pedida = (location.state as TarefasNavigationState | null)?.nova ? location.key : null
  const [pedidaVista, setPedidaVista] = useState<string | null>(null)
  if (pedida !== null && pedida !== pedidaVista) {
    setPedidaVista(pedida)
    setNova((atual) => atual + 1)
    if (visao === 'sugestoes') setVisao('hoje')
  }
  // "Ver todas as N tarefas" da oportunidade (contrato 131, R4) chega pela navegação (`state.agrupar`): a visão pedida
  // (Todas, ou Feitas) agrupada por oportunidade, uma vez por pedido.
  const pedidoAgrupar = (location.state as TarefasNavigationState | null)?.agrupar ? location.key : null
  const [agruparVisto, setAgruparVisto] = useState<string | null>(null)
  if (pedidoAgrupar !== null && pedidoAgrupar !== agruparVisto) {
    const state = location.state as TarefasNavigationState
    setAgruparVisto(pedidoAgrupar)
    setModo(state.agrupar ?? 'oportunidade')
    setVisao(state.visao ?? 'todas')
  }
  useEffect(() => {
    const state = location.state as TarefasNavigationState | null
    if (state?.nova || state?.agrupar) void navigate(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, navigate])

  // As sugestões (o número da aba): ao abrir a tela, ao entrar na aba e a cada view nova; o relógio das Feitas acompanha.
  const naAbaSugestoes = visao === 'sugestoes'
  useEffect(() => {
    let vivo = true
    void useTarefas
      .getState()
      .sugestoes()
      .then((lista) => {
        if (!vivo) return
        // A lista nova do main já vem sem as ignoradas e as adicionadas: as escondidas aqui voltam a valer pelo que veio.
        setSugestoes(lista)
        setFeitas(new Set())
        setNow(Date.now())
      })
    return () => {
      vivo = false
    }
  }, [view, naAbaSugestoes])

  // Sugestões não tem lista ao lado de um detalhe: escolher a aba fecha o detalhe.
  const escolherVisao = (valor: VisaoTarefas): void => {
    setVisao(valor)
    if (valor === 'sugestoes' && id !== undefined) void navigate(TAREFAS_ROOT_PATH)
  }

  const abrirNova = (): void => {
    if (id !== undefined) {
      const state: TarefasNavigationState = { nova: true }
      void navigate(TAREFAS_ROOT_PATH, { state })
      return
    }
    if (visao === 'sugestoes') setVisao('hoje')
    setNova((atual) => atual + 1)
  }

  const visiveis = sugestoes?.filter((sugestao) => !feitas.has(sugestao.chave)) ?? null
  const n = visiveis?.length ?? 0
  const detalheAberto = id !== undefined
  const etapaDe = (opId: string): string | null => {
    const oportunidade = funil?.state.oportunidades.find((item) => item.id === opId)
    return oportunidade ? (funil?.state.etapas.find((etapa) => etapa.id === oportunidade.etapaId)?.nome ?? null) : null
  }

  let conteudo: ReactNode = null
  if (!view) {
    if (error)
      conteudo = (
        <div className="px-[var(--page-x)] pt-4">
          <Note id="tarefas-load-failed" icon={TriangleAlert} role="alert">
            {error}
          </Note>
        </div>
      )
  } else if (visao === 'sugestoes') {
    conteudo = <SugestoesTarefas sugestoes={visiveis} onFeita={(chave) => setFeitas((atual) => new Set([...atual, chave]))} />
  } else {
    conteudo = renderLista(view, visao)
  }

  /** A lista da visão, em grupos; com o detalhe aberto, estreita e ao lado dele. */
  function renderLista(view: TarefasView, visao: VisaoLista): ReactNode {
    const lista = filtrarVisao(view, visao, busca, now)
    const grupos = agrupar(lista, modo, view)
    const termo = busca.trim()
    const avisos = erro && (
      <Note
        id="tarefas-erro"
        icon={TriangleAlert}
        role="alert"
        className="mb-3"
        action={
          <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setErro(null)}>
            Fechar
          </button>
        }
      >
        {erro}
      </Note>
    )
    const formulario = nova > 0 && (
      <div className="mb-3">
        <NovaTarefaInline key={nova} onCriada={() => setNova(0)} onCancelar={() => setNova(0)} />
      </div>
    )
    const vaziaHoje = visao === 'hoje' && lista.length === 0 && !termo
    const todas = filtrarVisao(view, 'todas', '', now).length

    const linhas = (estreito: boolean): ReactNode =>
      grupos.map((grupo) => (
        <section key={grupo.chave} data-tarefas-grupo={grupo.chave} aria-label={grupo.nome}>
          <CabecalhoGrupo grupo={grupo} etapa={modo === 'oportunidade' && grupo.chave !== 'sem-oportunidade' ? etapaDe(grupo.chave) : null} estreito={estreito} contagemADireita={modo === 'oportunidade'} />
          {grupo.tarefas.map((tarefa) => (
            <TarefaLinha key={tarefa.id} tarefa={tarefa} view={view} variante={estreito ? 'estreita' : 'larga'} atual={tarefa.id === id} onErro={setErro} />
          ))}
        </section>
      ))

    const semLinhas =
      lista.length === 0 && !vaziaHoje ? (
        <p data-tarefas-lista-vazia className="px-2 py-3 text-13 text-text-muted">
          {termo ? 'Nenhuma tarefa com esse texto.' : visao === 'feitas' ? 'Nenhuma tarefa feita nos últimos 90 dias.' : 'Nenhuma tarefa aqui.'}
        </p>
      ) : null

    if (detalheAberto) {
      const tarefa = view.tarefas.find((item) => item.id === id) ?? null
      return (
        <div className="mt-3 flex min-h-0 flex-1 border-t border-line">
          <aside aria-label="Tarefas" data-tarefas-lista="estreita" className="relative flex w-[340px] shrink-0 flex-col overflow-y-auto border-r border-line px-2 pt-1 pb-3">
            {lista.length === 0 && vaziaHoje ? <p className="px-3 py-3 text-13 text-text-muted">Nada para hoje.</p> : (semLinhas ?? linhas(true))}
          </aside>
          <section aria-label={tarefa?.titulo ?? 'Tarefa'} data-tarefas-painel className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-5">
            {avisos}
            {tarefa ? (
              <TarefaDetalhe key={tarefa.id} tarefa={tarefa} view={view} onApagada={() => void navigate(TAREFAS_ROOT_PATH, { replace: true })} />
            ) : (
              <div data-tarefa-detalhe-vazio className="flex flex-col items-center pt-16">
                <EmptyState
                  illustration={<IlustracaoVazia icon={SearchX} />}
                  title="Essa tarefa não existe mais."
                  action={
                    <Link to={TAREFAS_ROOT_PATH} className={`${NOTE_ACTION_CLASS} text-13`}>
                      Voltar para Tarefas
                    </Link>
                  }
                >
                  Ela pode ter sido apagada.
                </EmptyState>
              </div>
            )}
          </section>
        </div>
      )
    }

    if (vaziaHoje && nova === 0 && !erro) {
      return (
        <Vazio marca="tarefas-vazia">
          <EmptyState
            illustration={<IlustracaoVazia icon={SquareCheck} />}
            title="Nada para hoje"
            action={
              <button type="button" data-action="tarefas-ver-todas" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setVisao('todas')}>
                Ver todas ({todas})
              </button>
            }
          >
            Nenhuma tarefa vencida nem com prazo para hoje. As próximas continuam em Todas.
          </EmptyState>
        </Vazio>
      )
    }

    return (
      <div data-tarefas-lista="larga" className="relative min-h-0 flex-1 overflow-y-auto px-[var(--page-x)] pt-3 pb-5">
        {avisos}
        {formulario}
        {vaziaHoje ? (
          <p data-tarefas-lista-vazia className="px-2 py-3 text-13 text-text-muted">
            Nada para hoje.{' '}
            <button type="button" data-action="tarefas-ver-todas" className={NOTE_ACTION_CLASS} onClick={() => setVisao('todas')}>
              Ver todas ({todas})
            </button>
          </p>
        ) : (
          (semLinhas ?? linhas(false))
        )}
      </div>
    )
  }

  return (
    <div data-tarefas-screen={visao} className="flex min-h-0 flex-1 flex-col">
      <div className="px-[var(--page-x)] pt-[var(--page-top)]">
        <PageHeader
          title="Tarefas"
          actions={
            <>
              <SearchField value={busca} onChange={setBusca} label="Buscar tarefas" />
              <Button icon={Plus} action="tarefa-nova" shortcut="⌘⇧T" ariaShortcut="Meta+Shift+T" onClick={abrirNova}>
                Nova tarefa
              </Button>
            </>
          }
        />
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <span id="tarefas-visao-label" className="sr-only">
            Mostrar
          </span>
          <Segmented
            value={visao}
            options={VISOES_TAREFAS.map((opcao) => (opcao.value === 'sugestoes' && n > 0 ? { ...opcao, label: `Sugestões ${n}` } : opcao))}
            onChange={escolherVisao}
            labelledBy="tarefas-visao-label"
            dataName="tarefas-visao"
          />
          {visao !== 'sugestoes' && !detalheAberto && (
            <label className="flex items-center gap-2">
              <span className="text-12 font-medium text-text-muted">Agrupar por</span>
              <select data-tarefas-agrupar value={modo} onChange={(event) => setModo(event.target.value as ModoAgrupar)} className={AGRUPAR_CLASS}>
                {MODOS_AGRUPAR.map((opcao) => (
                  <option key={opcao.value} value={opcao.value}>
                    {opcao.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
      {conteudo}
    </div>
  )
}
