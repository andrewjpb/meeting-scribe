import { Info, Plus, SearchX, TriangleAlert, Upload, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import type { FunilView } from '@shared/funil'
import { funilPath } from '@shared/routes'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { Segmented } from '../../design/Segmented'
import { SearchField } from '../meetings/SearchField'
import { ContatoFicha, NovoContatoFicha, type ContatoCriado } from './ContatoFicha'
import { filtrarContatos, ORIGEM_ROTULO, ordenarContatos } from './funilFormat'
import { useFunil } from './funilStore'
import { IMPORT_ERRO_TEXTO, ImportarPainel, type ImportAberto } from './ImportarPainel'
import { SugestoesList } from './SugestoesList'

/**
 * O aviso da mescla do Novo contato (R4, R32) vai no `state` da navegação até a ficha de quem já tinha o e-mail ou o
 * telefone: cada troca de caminho remonta a tela, e o aviso vale só para aquela abertura.
 */
interface ContatosNavigationState {
  mescladoEm?: string
}

/** O que a área à direita da lista mostra: a ficha do contato, o Novo contato ou a importação (R32). */
type Painel = { modo: 'ficha' } | { modo: 'novo' } | { modo: 'importar'; arquivo: ImportAberto }

/** O quadro tracejado dos estados vazios do funil, com o ícone no meio. */
export function IlustracaoVazia({ icon }: { icon: typeof Users }) {
  return (
    <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong text-text-muted">
      <Icon icon={icon} />
    </span>
  )
}

/** Um estado vazio no meio da área, como o do kanban e o do detalhe. */
export function Vazio({ marca, children }: { marca: string; children: ReactNode }) {
  return (
    <div {...{ [`data-${marca}`]: '' }} className="flex flex-1 flex-col items-center px-[var(--page-x)]">
      <div className="grow-[3]" />
      {children}
      <div className="grow-[7]" />
    </div>
  )
}

/**
 * Tela Contatos (contrato 114, R30 a R33, artboards 05 a 07): o cabeçalho com a busca, "Importar…" e "Novo contato" e o
 * `Segmented` Contatos · Sugestões; na aba Contatos, a lista de 340 px (os mais recentes primeiro) e, à direita, a ficha
 * do contato da rota (sem id, a do primeiro da lista), o Novo contato ou a importação; na aba Sugestões, a lista em
 * largura total. As sugestões são lidas ao abrir a tela e de novo a cada gravação do funil.
 */
export function ContatosScreen({ view, id }: { view: FunilView; id: string | undefined }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { state } = view
  // A aba, a busca e a última lista de sugestões ficam no store: cada troca de caminho remonta a tela.
  const aba = useFunil((store) => store.telas.contatosAba)
  const busca = useFunil((store) => store.telas.contatosBusca)
  const sugestoes = useFunil((store) => store.telas.sugestoesLista)
  const [painel, setPainel] = useState<Painel>({ modo: 'ficha' })
  const mescladoEm = (location.state as ContatosNavigationState | null)?.mescladoEm ?? null
  const aviso = painel.modo === 'ficha' && mescladoEm ? `Esse e-mail ou telefone já era de ${mescladoEm}; os dados foram juntados.` : null
  const [importErro, setImportErro] = useState<string | null>(null)
  /** As sugestões já adicionadas ou ignoradas nesta tela, escondidas até a lista nova chegar do main. */
  const [feitas, setFeitas] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    let vivo = true
    const { sugestoes: ler, setTelas } = useFunil.getState()
    void ler().then((lista) => vivo && setTelas({ sugestoesLista: lista }))
    return () => {
      vivo = false
    }
  }, [view, aba])

  const setAba = (valor: 'contatos' | 'sugestoes'): void => useFunil.getState().setTelas({ contatosAba: valor })

  const visiveis = sugestoes?.filter((sugestao) => !feitas.has(sugestao.chave)) ?? null
  const todos = ordenarContatos(state.contatos)
  const lista = filtrarContatos(todos, state.empresas, busca)
  const escolhido = id ?? lista[0]?.id
  const contato = escolhido ? (state.contatos.find((item) => item.id === escolhido && !item.arquivado) ?? null) : null
  const empresas = new Map(state.empresas.map((empresa) => [empresa.id, empresa.nome]))

  // A busca é da lista de contatos: digitar nela volta à aba Contatos.
  const setBusca = (valor: string): void => useFunil.getState().setTelas(valor ? { contatosBusca: valor, contatosAba: 'contatos' } : { contatosBusca: valor })

  const abrir = (contatoId: string): void => {
    setPainel({ modo: 'ficha' })
    setImportErro(null)
    void navigate(funilPath('contatos', contatoId))
  }

  const abrirImportacao = async (): Promise<void> => {
    setImportErro(null)
    const result = await useFunil.getState().importarAbrir()
    if (result.ok) {
      setAba('contatos')
      setPainel({ modo: 'importar', arquivo: result })
    } else if (result.erro !== 'cancelado') {
      setAba('contatos')
      setImportErro(IMPORT_ERRO_TEXTO[result.erro])
    }
  }

  const criado = (contato: ContatoCriado): void => {
    setPainel({ modo: 'ficha' })
    const navState: ContatosNavigationState | null = contato.mescladoEm ? { mescladoEm: contato.mescladoEm } : null
    void navigate(funilPath('contatos', contato.id), { state: navState })
  }

  const novoContato = (): void => {
    setAba('contatos')
    setImportErro(null)
    setPainel({ modo: 'novo' })
  }

  const avisos = (
    <>
      {importErro && (
        <Note
          id="funil-import-falhou"
          icon={TriangleAlert}
          role="alert"
          className="mb-3 max-w-[760px]"
          action={
            <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setImportErro(null)}>
              Fechar
            </button>
          }
        >
          {importErro}
        </Note>
      )}
      {aviso && (
        <Note id="funil-contato-mesclado" icon={Info} role="status" className="mb-3 max-w-[760px]">
          {aviso}
        </Note>
      )}
    </>
  )

  let conteudo: ReactNode
  if (aba === 'sugestoes') {
    conteudo = <SugestoesList sugestoes={visiveis} onFeita={(chave) => setFeitas((atual) => new Set([...atual, chave]))} />
  } else if (todos.length === 0 && painel.modo === 'ficha') {
    conteudo = (
      <Vazio marca="funil-contatos-vazio">
        {importErro && <div className="w-full max-w-[560px] pt-4">{avisos}</div>}
        <EmptyState illustration={<IlustracaoVazia icon={Users} />} title="Nenhum contato ainda.">
          Use “Novo contato” ou “Importar…” para começar.
        </EmptyState>
      </Vazio>
    )
  } else {
    let painelConteudo: ReactNode
    if (painel.modo === 'novo') painelConteudo = <NovoContatoFicha view={view} onCriado={criado} onCancelar={() => setPainel({ modo: 'ficha' })} />
    else if (painel.modo === 'importar') painelConteudo = <ImportarPainel key={painel.arquivo.token} arquivo={painel.arquivo} onTrocar={() => void abrirImportacao()} onFechar={() => setPainel({ modo: 'ficha' })} />
    else if (contato) painelConteudo = <ContatoFicha key={contato.id} view={view} contato={contato} onArquivado={() => void navigate(funilPath('contatos'), { replace: true })} />
    else if (id !== undefined)
      painelConteudo = (
        <div data-funil-contato-vazio className="flex flex-col items-center pt-16">
          <EmptyState
            illustration={<IlustracaoVazia icon={SearchX} />}
            title="Esse contato não existe mais."
            action={
              <Link to={funilPath('contatos')} className={`${NOTE_ACTION_CLASS} text-13`}>
                Voltar para Contatos
              </Link>
            }
          >
            Ele pode ter sido arquivado.
          </EmptyState>
        </div>
      )
    conteudo = (
      <div className="flex min-h-0 flex-1">
        <aside aria-label="Contatos" data-funil-contatos-lista className="flex w-[340px] shrink-0 flex-col border-r border-line">
          <p data-funil-contatos-total className="shrink-0 px-5 pt-3 pb-1 text-12 font-medium text-text-muted">
            {busca.trim() ? `${lista.length} de ${todos.length} ${todos.length === 1 ? 'contato' : 'contatos'}` : `${todos.length} ${todos.length === 1 ? 'contato' : 'contatos'} · mais recentes primeiro`}
          </p>
          {lista.length === 0 ? (
            <p className="px-5 py-2 text-13 text-text-muted">{todos.length === 0 ? 'Nenhum contato ainda.' : 'Nenhum contato com esse texto.'}</p>
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {lista.map((item) => {
                const atual = painel.modo === 'ficha' && item.id === escolhido
                const empresa = item.empresaId ? (empresas.get(item.empresaId) ?? null) : null
                const detalhe = [empresa, item.emails[0] ?? item.telefones[0] ?? null].filter((parte) => parte).join(' · ')
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-funil-contato-row={item.id}
                      aria-current={atual ? 'true' : undefined}
                      onClick={() => abrir(item.id)}
                      className={`no-drag flex h-11 w-full min-w-0 flex-col justify-center rounded-[var(--radius-control)] px-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${atual ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
                    >
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate text-13 font-semibold text-title">{item.nome}</span>
                        <span data-funil-contato-origem className="shrink-0 text-11 font-medium text-text-muted">
                          {ORIGEM_ROTULO[item.origem]}
                        </span>
                      </span>
                      <span className="truncate text-12 text-text-muted">{detalhe || 'Sem e-mail nem telefone'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>
        <section aria-label="Ficha" data-funil-contatos-painel={painel.modo} className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-5">
          {avisos}
          {painelConteudo}
        </section>
      </div>
    )
  }

  const n = visiveis?.length ?? null
  return (
    <div data-funil-contatos className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-[var(--page-x)] pt-[var(--page-top)] pb-3">
        <PageHeader
          title="Contatos"
          actions={
            <>
              <SearchField value={busca} onChange={setBusca} label="Buscar contatos" />
              <Button icon={Upload} variant="secondary" action="funil-importar" onClick={() => void abrirImportacao()}>
                Importar…
              </Button>
              <Button icon={Plus} action="funil-novo-contato" onClick={novoContato}>
                Novo contato
              </Button>
            </>
          }
        />
        <div className="mt-3 flex">
          <span id="funil-contatos-aba-label" className="sr-only">
            Mostrar
          </span>
          <Segmented
            value={aba}
            options={[
              { value: 'contatos', label: 'Contatos' },
              { value: 'sugestoes', label: n === null ? 'Sugestões' : `Sugestões ${n}` },
            ]}
            onChange={setAba}
            labelledBy="funil-contatos-aba-label"
            dataName="funil-contatos-aba"
          />
        </div>
      </div>
      {conteudo}
    </div>
  )
}
