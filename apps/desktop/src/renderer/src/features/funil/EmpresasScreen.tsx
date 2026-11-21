import { Building2, Plus, SearchX, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { FUNIL_EMAILS_MAX, FUNIL_NOME_MAX, type Empresa, type EmpresaInput, type FunilView } from '@shared/funil'
import { funilPath, type FunilNavigationState } from '@shared/routes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { EmptyState } from '../../design/EmptyState'
import { TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { SearchField } from '../meetings/SearchField'
import { ADICIONAR_CLASS, BlocoOportunidades, CampoSalvo, ErroCampo, LinhaCampo, NotasSalvas, TituloBloco } from './ContatoFicha'
import { IlustracaoVazia, Vazio } from './ContatosScreen'
import { dataLonga, filtrarEmpresas, ordenarEmpresas, parseDominio } from './funilFormat'
import { useFunil } from './funilStore'
import { CANCELAR_CLASS } from './KanbanCard'
import { FUNIL_LINK_CLASS } from './Timeline'

const DOMINIO_INVALIDO = 'Domínio fora do formato. Use, por exemplo, acme.com.br.'
const APAGAR_BLOQUEADO = 'A empresa tem contatos ou oportunidades.'

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`

/**
 * Tela Empresas (contrato 114, R34, artboard 08): o cabeçalho com a busca e "Nova empresa", a lista de 340 px e, à
 * direita, a ficha da empresa da rota (sem id, a da primeira da lista) ou a ficha de criação.
 */
export function EmpresasScreen({ view, id }: { view: FunilView; id: string | undefined }) {
  const navigate = useNavigate()
  const { state } = view
  // A busca fica no store: cada troca de caminho remonta a tela.
  const busca = useFunil((store) => store.telas.empresasBusca)
  const setBusca = (valor: string): void => useFunil.getState().setTelas({ empresasBusca: valor })
  const [criando, setCriando] = useState(false)

  const todas = ordenarEmpresas(state.empresas)
  const lista = filtrarEmpresas(todas, busca)
  const escolhida = id ?? lista[0]?.id
  const empresa = escolhida ? (state.empresas.find((item) => item.id === escolhida) ?? null) : null
  const contatosDe = (empresaId: string): number => state.contatos.filter((contato) => contato.empresaId === empresaId && !contato.arquivado).length
  const abertasDe = (empresaId: string): number => {
    const abertas = new Set(state.etapas.filter((etapa) => etapa.tipo === 'aberta').map((etapa) => etapa.id))
    return state.oportunidades.filter((item) => item.empresaId === empresaId && !item.arquivado && abertas.has(item.etapaId)).length
  }

  const abrir = (empresaId: string): void => {
    setCriando(false)
    void navigate(funilPath('empresas', empresaId))
  }

  let painel
  if (criando)
    painel = (
      <NovaEmpresaFicha
        onCriada={(novaId) => {
          setCriando(false)
          void navigate(funilPath('empresas', novaId))
        }}
        onCancelar={() => setCriando(false)}
      />
    )
  else if (empresa) painel = <EmpresaFicha key={empresa.id} view={view} empresa={empresa} onApagada={() => void navigate(funilPath('empresas'), { replace: true })} />
  else if (id !== undefined)
    painel = (
      <div data-funil-empresa-vazia className="flex flex-col items-center pt-16">
        <EmptyState
          illustration={<IlustracaoVazia icon={SearchX} />}
          title="Essa empresa não existe mais."
          action={
            <Link to={funilPath('empresas')} className={`${NOTE_ACTION_CLASS} text-13`}>
              Voltar para Empresas
            </Link>
          }
        >
          Ela pode ter sido apagada.
        </EmptyState>
      </div>
    )

  return (
    <div data-funil-empresas className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-line px-[var(--page-x)] pt-[var(--page-top)] pb-3">
        <PageHeader
          title="Empresas"
          actions={
            <>
              <SearchField value={busca} onChange={setBusca} label="Buscar empresas" />
              <Button icon={Plus} action="funil-nova-empresa" onClick={() => setCriando(true)}>
                Nova empresa
              </Button>
            </>
          }
        />
      </div>
      {todas.length === 0 && !criando ? (
        <Vazio marca="funil-empresas-vazio">
          <EmptyState illustration={<IlustracaoVazia icon={Building2} />} title="Nenhuma empresa ainda.">
            Use “Nova empresa”, ou crie pela ficha de um contato.
          </EmptyState>
        </Vazio>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside aria-label="Empresas" data-funil-empresas-lista className="flex w-[340px] shrink-0 flex-col border-r border-line">
            <p data-funil-empresas-total className="shrink-0 px-5 pt-3 pb-1 text-12 font-medium text-text-muted">
              {busca.trim() ? `${lista.length} de ${plural(todas.length, 'empresa', 'empresas')}` : plural(todas.length, 'empresa', 'empresas')}
            </p>
            {lista.length === 0 ? (
              <p className="px-5 py-2 text-13 text-text-muted">{todas.length === 0 ? 'Nenhuma empresa ainda.' : 'Nenhuma empresa com esse texto.'}</p>
            ) : (
              <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {lista.map((item) => {
                  const atual = !criando && item.id === escolhida
                  const contatos = contatosDe(item.id)
                  const detalhe = [item.dominios[0] ?? null, contatos === 0 ? 'sem contatos' : plural(contatos, 'contato', 'contatos')].filter((parte) => parte).join(' · ')
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-funil-empresa-row={item.id}
                        aria-current={atual ? 'true' : undefined}
                        onClick={() => abrir(item.id)}
                        className={`no-drag flex h-11 w-full min-w-0 flex-col justify-center rounded-[var(--radius-control)] px-3 text-left transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] ${atual ? 'bg-bg-sunken' : 'hover:bg-bg-sunken'}`}
                      >
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="min-w-0 flex-1 truncate text-13 font-semibold text-title">{item.nome}</span>
                          <span className="shrink-0 text-11 font-medium text-text-muted tabular">{plural(abertasDe(item.id), 'aberta', 'abertas')}</span>
                        </span>
                        <span className="truncate text-12 text-text-muted">{detalhe}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </aside>
          <section aria-label="Ficha" className="min-h-0 flex-1 overflow-y-auto px-8 pt-4 pb-5">
            {painel}
          </section>
        </div>
      )}
    </div>
  )
}

/**
 * Ficha da empresa (R34, artboard 08): o nome editável, o subtítulo, "Nova oportunidade" e "Apagar" (só sem contatos e
 * sem oportunidades; confirma na linha), os domínios em chips, o site, as notas e os blocos Contatos e Oportunidades.
 */
function EmpresaFicha({ view, empresa, onApagada }: { view: FunilView; empresa: Empresa; onApagada: () => void }) {
  const navigate = useNavigate()
  const { state } = view
  const id = empresa.id
  const [erro, setErro] = useState<string | null>(null)
  const [apagando, setApagando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const contatos = state.contatos.filter((contato) => contato.empresaId === id).sort((a, b) => Number(a.arquivado) - Number(b.arquivado) || a.nome.localeCompare(b.nome, 'pt-BR'))
  const oportunidades = state.oportunidades.filter((item) => item.empresaId === id).sort((a, b) => b.criadoEm - a.criadoEm)
  const bloqueada = contatos.length > 0 || oportunidades.length > 0
  const ativos = contatos.filter((contato) => !contato.arquivado).length

  /** Grava a empresa com a mudança; devolve o texto do erro (ou `null`). */
  const salvar = async (patch: Partial<EmpresaInput>): Promise<string | null> => {
    setErro(null)
    const result = await useFunil.getState().saveEmpresa({ id, nome: empresa.nome, dominios: empresa.dominios, ...patch })
    return result.ok ? null : result.mensagem
  }
  const salvarComAviso = (patch: Partial<EmpresaInput>): void => {
    void salvar(patch).then((falha) => falha && setErro(falha))
  }

  const apagar = async (): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().deleteEmpresa(id)
    setOcupado(false)
    if (result.ok) onApagada()
    else {
      setApagando(false)
      setErro(result.mensagem)
    }
  }

  const novaOportunidade = (): void => {
    const navState: FunilNavigationState = { nova: { contatoIds: [], empresaId: id } }
    void navigate(funilPath('oportunidades'), { state: navState })
  }

  return (
    <div data-funil-ficha="empresa" data-funil-ficha-id={id} className="flex max-w-[760px] flex-col">
      <EditableTitle value={empresa.nome} label="Nome da empresa" maxLength={FUNIL_NOME_MAX} onCommit={(nome) => salvarComAviso({ nome })} />
      <p data-funil-ficha-subtitulo className="mt-0.5 text-12 text-text-muted tabular">
        {`Criada em ${dataLonga(empresa.criadoEm)} · ${plural(ativos, 'contato', 'contatos')} · ${plural(oportunidades.length, 'oportunidade', 'oportunidades')}`}
      </p>
      <div data-funil-acoes className="mt-2.5 flex flex-wrap items-center gap-2">
        <ActionButton icon={Plus} label="Nova oportunidade" action="funil-empresa-nova-oportunidade" onClick={novaOportunidade} />
        {apagando ? (
          <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar exclusão">
            <span className="text-13 text-text">Apagar esta empresa?</span>
            <ActionButton icon={X} label="Cancelar" action="funil-empresa-apagar-cancelar" onClick={() => setApagando(false)} />
            <ActionButton icon={Trash2} label="Apagar" tone="danger" action="funil-empresa-apagar-confirmar" disabled={ocupado} onClick={() => void apagar()} />
          </span>
        ) : (
          // O botão desabilitado não recebe o ponteiro (`disabled:pointer-events-none`): a razão fica no invólucro.
          <span data-funil-empresa-apagar-razao className="inline-flex" title={bloqueada ? APAGAR_BLOQUEADO : undefined}>
            <ActionButton icon={Trash2} label="Apagar" tone="danger" action="funil-empresa-apagar" disabled={bloqueada} onClick={() => setApagando(true)} />
          </span>
        )}
      </div>
      {bloqueada && !apagando && <p className="mt-1.5 text-12 text-text-faint">Só dá para apagar sem contatos e sem oportunidades.</p>}
      {erro && (
        <Note
          id="funil-empresa-erro"
          icon={TriangleAlert}
          role="alert"
          className="mt-3"
          action={
            <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setErro(null)}>
              Fechar
            </button>
          }
        >
          {erro}
        </Note>
      )}
      <div className="mt-3 flex flex-col border-t border-line">
        <LinhaCampo nome="dominios" rotulo="Domínios">
          <Dominios key={id} dominios={empresa.dominios} onSalvar={(dominios) => salvar({ dominios })} />
        </LinhaCampo>
        <LinhaCampo nome="site" rotulo="Site">
          <CampoSalvo valor={empresa.site ?? ''} rotulo="Site" maxLength={500} onSalvar={(site) => salvarComAviso({ site: site || null })} data={{ 'data-funil-empresa-site': '' }} />
        </LinhaCampo>
        <LinhaCampo nome="notas" rotulo="Notas">
          <NotasSalvas valor={empresa.notas} rotulo="Notas" onSalvar={(notas) => salvarComAviso({ notas })} />
        </LinhaCampo>
      </div>
      <section data-funil-bloco="contatos" aria-label="Contatos">
        <TituloBloco>Contatos</TituloBloco>
        {contatos.length === 0 ? (
          <p className="py-2 text-13 text-text-muted">Nenhum contato nesta empresa.</p>
        ) : (
          <ul className="flex flex-col">
            {contatos.map((contato) => (
              <li key={contato.id} data-funil-ficha-contato={contato.id} className="flex min-h-8 items-center gap-3 border-b border-line py-1 text-13">
                <span className="min-w-0 flex-1 truncate">
                  {contato.arquivado ? (
                    <span className="text-text">{contato.nome}</span>
                  ) : (
                    <button type="button" className={FUNIL_LINK_CLASS} onClick={() => void navigate(funilPath('contatos', contato.id))}>
                      {contato.nome}
                    </button>
                  )}
                  {contato.cargo && <span className="text-text-muted"> · {contato.cargo}</span>}
                </span>
                {contato.arquivado && <span className="shrink-0 text-11 font-medium text-text-faint">arquivado</span>}
                <span className="shrink-0 truncate text-12 text-text-muted">{contato.emails[0] ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <BlocoOportunidades oportunidades={oportunidades} etapas={state.etapas} vazio="Nenhuma oportunidade com esta empresa." />
    </div>
  )
}

/** Os domínios em chips retangulares com "×" e o "+ Domínio" que abre um campo; salva no blur ou no Enter. */
function Dominios({ dominios, onSalvar }: { dominios: readonly string[]; onSalvar: (dominios: string[]) => Promise<string | null> }) {
  const [novo, setNovo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const abriu = novo !== null

  useEffect(() => {
    if (abriu) ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [abriu])

  const fechar = (): void => {
    setNovo(null)
    setErro(null)
  }
  const concluir = async (): Promise<void> => {
    if (novo === null) return
    if (!novo.trim()) return fechar()
    const dominio = parseDominio(novo)
    if (!dominio) return setErro(DOMINIO_INVALIDO)
    if (dominios.includes(dominio)) return fechar()
    const falha = await onSalvar([...dominios, dominio])
    if (falha) setErro(falha)
    else fechar()
  }
  const tirar = async (dominio: string): Promise<void> => {
    setErro(null)
    const falha = await onSalvar(dominios.filter((outro) => outro !== dominio))
    if (falha) setErro(falha)
  }

  return (
    <>
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        {dominios.map((dominio) => (
          <span key={dominio} data-funil-dominio={dominio} className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[var(--radius-control)] bg-bg-sunken pr-1 pl-2 text-12 text-text">
            <span className="min-w-0 truncate">{dominio}</span>
            <button type="button" aria-label={`Tirar ${dominio}`} data-funil-dominio-tirar={dominio} onClick={() => void tirar(dominio)} className="no-drag inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title">
              <Icon icon={X} size={14} />
            </button>
          </span>
        ))}
        {novo !== null ? (
          <div
            ref={ref}
            className="flex w-[200px] min-w-0"
            onKeyDown={(event) => {
              if (event.key !== 'Escape') return
              event.preventDefault()
              fechar()
            }}
          >
            <TextField value={novo} onChange={setNovo} onBlur={() => void concluir()} onEnter={() => void concluir()} ariaLabel="Domínio" maxLength={253} data={{ 'data-funil-dominio-novo': '' }} />
          </div>
        ) : (
          dominios.length < FUNIL_EMAILS_MAX && (
            <button type="button" data-action="funil-dominio-add" onClick={() => setNovo('')} className={ADICIONAR_CLASS}>
              <Icon icon={Plus} size={14} />
              Domínio
            </button>
          )
        )}
      </div>
      <ErroCampo texto={erro} />
    </>
  )
}

/** Nova empresa (R34): Nome obrigatório (com o foco), Domínios (separados por vírgula) e Site; Criar e Cancelar (ou Esc). */
function NovaEmpresaFicha({ onCriada, onCancelar }: { onCriada: (id: string) => void; onCancelar: () => void }) {
  const ids = useId()
  const [nome, setNome] = useState('')
  const [dominios, setDominios] = useState('')
  const [site, setSite] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('[data-funil-nova-empresa-nome]')?.focus()
  }, [])

  const criar = async (): Promise<void> => {
    if (!nome.trim() || salvando) return
    const partes = dominios.split(/[\s,;]+/).filter(Boolean)
    const lidos = partes.map(parseDominio)
    if (lidos.some((dominio) => dominio === null)) {
      setErro(DOMINIO_INVALIDO)
      return
    }
    setSalvando(true)
    setErro(null)
    const result = await useFunil.getState().saveEmpresa({ nome: nome.trim(), dominios: [...new Set(lidos.filter((dominio) => dominio !== null))], site: site.trim() || null })
    setSalvando(false)
    if (!result.ok) setErro(result.mensagem)
    else if (result.id) onCriada(result.id)
  }

  return (
    <div
      ref={ref}
      data-funil-ficha="nova-empresa"
      className="flex max-w-[760px] flex-col"
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        onCancelar()
      }}
    >
      <h2 className="text-15 font-bold tracking-[-0.2px] text-title">Nova empresa</h2>
      <div className="mt-3 flex flex-col border-t border-line">
        <LinhaCampo nome="nome" rotulo="Nome" rotuloId={`${ids}-nome`}>
          <div className="flex w-full max-w-[240px] min-w-0">
            <TextField value={nome} onChange={setNome} onEnter={() => void criar()} ariaLabel="Nome" maxLength={FUNIL_NOME_MAX} disabled={salvando} data={{ 'data-funil-nova-empresa-nome': '' }} />
          </div>
        </LinhaCampo>
        <LinhaCampo nome="dominios" rotulo="Domínios">
          <div className="flex w-full max-w-[320px] min-w-0">
            <TextField value={dominios} onChange={setDominios} onEnter={() => void criar()} ariaLabel="Domínios" placeholder="acme.com.br, acme.com" maxLength={1000} disabled={salvando} data={{ 'data-funil-nova-empresa-dominios': '' }} />
          </div>
        </LinhaCampo>
        <LinhaCampo nome="site" rotulo="Site">
          <div className="flex w-full max-w-[240px] min-w-0">
            <TextField value={site} onChange={setSite} onEnter={() => void criar()} ariaLabel="Site" maxLength={500} disabled={salvando} data={{ 'data-funil-nova-empresa-site': '' }} />
          </div>
        </LinhaCampo>
      </div>
      {erro && (
        <Note id="funil-nova-empresa-erro" icon={TriangleAlert} role="alert" className="mt-3">
          {erro}
        </Note>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button icon={Plus} action="funil-empresa-criar" disabled={!nome.trim() || salvando} onClick={() => void criar()}>
          Criar
        </Button>
        <button type="button" data-action="funil-empresa-cancelar" onClick={onCancelar} disabled={salvando} className={CANCELAR_CLASS}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
