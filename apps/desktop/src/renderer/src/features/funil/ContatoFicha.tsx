import { Archive, Building2, Lightbulb, Mail, Plus, Smartphone, TriangleAlert, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { FUNIL_EMAILS_MAX, FUNIL_NOME_MAX, FUNIL_NOTAS_MAX, FUNIL_TELEFONES_MAX, type Contato, type ContatoInput, type Etapa, type FunilFalha, type FunilTimelineResult, type FunilView, type Oportunidade } from '@shared/funil'
import { formatarBRL, normalizarEmail, normalizarTelefone } from '@shared/funil-logic'
import { EMAIL_ROOT_PATH, funilPath, type EmailNavigationState, type FunilNavigationState } from '@shared/routes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { CONTROL_CLASS, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { CANCELAR_CLASS } from './KanbanCard'
import { composeDe, sugestaoDeEmpresa, telefoneLegivel, textoSubtituloContato, whatsappDestino, type PickerItem } from './funilFormat'
import { useFunil } from './funilStore'
import { SearchPicker } from './SearchPicker'
import { FUNIL_LINK_CLASS, Timeline } from './Timeline'

/** Largura dos campos de uma linha só (artboards 05 e 08); Notas ocupa a linha inteira. */
const CAMPO_CLASS = 'flex w-full max-w-[240px] min-w-0'
export const NOTAS_CLASS = `${CONTROL_CLASS} h-auto w-full min-w-0 px-2.5 py-1.5 leading-5 select-text placeholder:text-text-faint`
/** "+ E-mail", "+ Telefone" e "+ Domínio": texto em --accent, como o "+ Contato" do detalhe da oportunidade. */
export const ADICIONAR_CLASS =
  'no-drag inline-flex h-6 shrink-0 items-center gap-1 self-start rounded-[var(--radius-control)] px-1 text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'
const TIRAR_CLASS = 'no-drag inline-flex size-6 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title'

type TimelineCarregada = { id: string; result: FunilTimelineResult | FunilFalha }

/** Uma linha da ficha: o rótulo à esquerda e o campo (ou a lista) à direita, com a linha de baixo em --line. */
export function LinhaCampo({ nome, rotulo, rotuloId, children }: { nome: string; rotulo: string; rotuloId?: string | undefined; children: ReactNode }) {
  return (
    <div data-funil-campo={nome} className="flex min-h-10 items-start gap-3 border-b border-line py-1.5">
      <span id={rotuloId} className="w-24 shrink-0 pt-1.5 text-12 text-text-muted">
        {rotulo}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">{children}</div>
    </div>
  )
}

/** O erro de um campo, logo embaixo dele (o campo continua com o texto digitado). */
export function ErroCampo({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" data-funil-campo-erro className="text-12 text-rec">
      {texto}
    </p>
  )
}

/** Título de bloco da ficha ("Oportunidades", "Linha do tempo", "Contatos"). */
export function TituloBloco({ children }: { children: ReactNode }) {
  return <h2 className="mt-5 border-b border-line-strong pb-1.5 text-12 font-medium text-text-muted">{children}</h2>
}

/**
 * Um campo de texto que salva no blur ou no Enter, só quando mudou (Cargo, Site). O texto acompanha o valor gravado
 * quando ele muda por fora (outra tela, a view nova do funil).
 */
export function CampoSalvo({ valor, rotulo, maxLength, onSalvar, data }: { valor: string; rotulo: string; maxLength: number; onSalvar: (texto: string) => void; data?: Readonly<Record<`data-${string}`, string>> }) {
  const [texto, setTexto] = useState(valor)
  const [gravado, setGravado] = useState(valor)
  const enviado = useRef<string | null>(null)
  if (valor !== gravado) {
    setGravado(valor)
    setTexto(valor)
  }
  const salvar = (): void => {
    const limpo = texto.trim()
    if (limpo === valor.trim() || limpo === enviado.current) return
    enviado.current = limpo
    onSalvar(limpo)
  }
  return (
    <div className={CAMPO_CLASS}>
      <TextField value={texto} onChange={setTexto} onBlur={salvar} onEnter={salvar} ariaLabel={rotulo} maxLength={maxLength} {...(data ? { data } : {})} />
    </div>
  )
}

/** Notas: a área de texto salva ao sair dela, só quando mudou. */
export function NotasSalvas({ valor, rotulo, onSalvar }: { valor: string; rotulo: string; onSalvar: (texto: string) => void }) {
  const [texto, setTexto] = useState(valor)
  const [gravado, setGravado] = useState(valor)
  if (valor !== gravado) {
    setGravado(valor)
    setTexto(valor)
  }
  return (
    <textarea
      data-funil-notas
      aria-label={rotulo}
      rows={2}
      value={texto}
      maxLength={FUNIL_NOTAS_MAX}
      onChange={(event) => setTexto(event.target.value)}
      onBlur={() => texto !== valor && onSalvar(texto)}
      className={NOTAS_CLASS}
    />
  )
}

/**
 * Uma lista de valores com "×" e o "+ <item>" que abre um campo no fim (E-mails, Telefones). O item novo salva no blur
 * ou no Enter; vazio, o campo fecha; fora do formato (ou recusado por quem salva, como o `duplicado`), o erro aparece
 * embaixo e nada é gravado.
 */
export function ListaEditavel({
  nome,
  itens,
  rotuloItem,
  max,
  exibir = (item) => item,
  validar,
  onSalvar,
}: {
  nome: string
  itens: readonly string[]
  rotuloItem: string
  max: number
  exibir?: (item: string) => string
  /** O item normalizado, ou o texto do erro. */
  validar: (texto: string) => { ok: true; valor: string } | { ok: false; erro: string }
  /** `null` gravou; texto, o erro (o campo continua aberto). */
  onSalvar: (itens: string[]) => Promise<string | null>
}) {
  const [novo, setNovo] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const abriu = novo !== null

  useEffect(() => {
    if (abriu) ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [abriu])

  const concluir = async (): Promise<void> => {
    if (novo === null || salvando) return
    const texto = novo.trim()
    if (!texto) {
      setNovo(null)
      setErro(null)
      return
    }
    const validado = validar(texto)
    if (!validado.ok) {
      setErro(validado.erro)
      return
    }
    if (itens.includes(validado.valor)) {
      setNovo(null)
      setErro(null)
      return
    }
    setSalvando(true)
    const falha = await onSalvar([...itens, validado.valor])
    setSalvando(false)
    if (falha) setErro(falha)
    else {
      setNovo(null)
      setErro(null)
    }
  }

  const tirar = async (item: string): Promise<void> => {
    setErro(null)
    const falha = await onSalvar(itens.filter((outro) => outro !== item))
    if (falha) setErro(falha)
  }

  return (
    <>
      {itens.map((item) => (
        <div key={item} data-funil-lista-item={nome} className="flex min-h-7 min-w-0 items-center gap-2 text-13 text-text">
          <span className="min-w-0 flex-1 truncate tabular">{exibir(item)}</span>
          <button type="button" aria-label={`Tirar ${exibir(item)}`} data-funil-lista-tirar={nome} onClick={() => void tirar(item)} className={TIRAR_CLASS}>
            <Icon icon={X} size={14} />
          </button>
        </div>
      ))}
      {novo !== null ? (
        <div
          ref={ref}
          className={CAMPO_CLASS}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setNovo(null)
            setErro(null)
          }}
        >
          <TextField value={novo} onChange={setNovo} onBlur={() => void concluir()} onEnter={() => void concluir()} ariaLabel={rotuloItem} maxLength={254} disabled={salvando} data={{ 'data-funil-lista-novo': nome }} />
        </div>
      ) : (
        itens.length < max && (
          <button type="button" data-action={`funil-${nome}-add`} onClick={() => setNovo('')} className={ADICIONAR_CLASS}>
            <Icon icon={Plus} size={14} />
            {rotuloItem}
          </button>
        )
      )}
      <ErroCampo texto={erro} />
    </>
  )
}

const EMAIL_INVALIDO = 'E-mail fora do formato. Use, por exemplo, nome@empresa.com.br.'
const TELEFONE_INVALIDO = 'Telefone fora do formato. Use, por exemplo, (11) 98765-4321.'

const validarEmail = (texto: string): { ok: true; valor: string } | { ok: false; erro: string } => {
  const email = normalizarEmail(texto)
  return email ? { ok: true, valor: email } : { ok: false, erro: EMAIL_INVALIDO }
}

const validarTelefone = (texto: string): { ok: true; valor: string } | { ok: false; erro: string } => {
  const telefone = normalizarTelefone(texto)
  return telefone ? { ok: true, valor: telefone } : { ok: false, erro: TELEFONE_INVALIDO }
}

/**
 * Bloco Oportunidades da ficha do contato e da empresa (R31, R34, R27): título como link, etapa e valor; as arquivadas
 * também aparecem, com o rótulo "arquivada" e sem link (o detalhe mostra só as do quadro).
 */
export function BlocoOportunidades({ oportunidades, etapas, vazio }: { oportunidades: readonly Oportunidade[]; etapas: readonly Etapa[]; vazio: string }) {
  const navigate = useNavigate()
  const nomeEtapa = new Map(etapas.map((etapa) => [etapa.id, etapa.nome]))
  return (
    <section data-funil-bloco="oportunidades" aria-label="Oportunidades">
      <TituloBloco>Oportunidades</TituloBloco>
      {oportunidades.length === 0 ? (
        <p className="py-2 text-13 text-text-muted">{vazio}</p>
      ) : (
        <ul className="flex flex-col">
          {oportunidades.map((oportunidade) => (
            <li key={oportunidade.id} data-funil-ficha-oportunidade={oportunidade.id} data-funil-ficha-oportunidade-arquivada={oportunidade.arquivado ? '' : undefined} className="flex min-h-8 items-center gap-3 border-b border-line py-1 text-13">
              {oportunidade.arquivado ? (
                <span className="min-w-0 flex-1 truncate text-text">{oportunidade.titulo}</span>
              ) : (
                <span className="min-w-0 flex-1 truncate">
                  <button type="button" className={FUNIL_LINK_CLASS} onClick={() => void navigate(funilPath('oportunidades', oportunidade.id))}>
                    {oportunidade.titulo}
                  </button>
                </span>
              )}
              {oportunidade.arquivado && <span className="shrink-0 text-11 font-medium text-text-faint">arquivada</span>}
              <span className="shrink-0 text-12 text-text-muted">{nomeEtapa.get(oportunidade.etapaId) ?? ''}</span>
              <span className="w-[96px] shrink-0 text-right text-text tabular">{formatarBRL(oportunidade.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** As oportunidades em que o contato está (as arquivadas também, R27), as mais novas primeiro. */
const oportunidadesDo = (view: FunilView, contatoId: string): Oportunidade[] => view.state.oportunidades.filter((item) => item.contatoIds.includes(contatoId)).sort((a, b) => b.criadoEm - a.criadoEm)

/**
 * Ficha do contato (contrato 114, R31, R5, artboard 05): o nome editável, o subtítulo com cargo, empresa e origem, as
 * ações (e-mail, WhatsApp, nova oportunidade e arquivar com confirmação na linha), os campos que salvam no blur ou no
 * Enter, a sugestão de empresa pelo domínio (só vira empresa no clique) e os blocos Oportunidades e Linha do tempo.
 */
export function ContatoFicha({ view, contato, onArquivado }: { view: FunilView; contato: Contato; onArquivado: () => void }) {
  const navigate = useNavigate()
  const ids = useId()
  const { state } = view
  const id = contato.id
  const [timeline, setTimeline] = useState<TimelineCarregada | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [arquivando, setArquivando] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  // A linha do tempo vem do main (os caches de reuniões, e-mails e conversas ficam lá) e é pedida de novo a cada gravação.
  useEffect(() => {
    let vivo = true
    void useFunil
      .getState()
      .timeline('contato', id)
      .then((result) => vivo && setTimeline({ id, result }))
    return () => {
      vivo = false
    }
  }, [id, view])

  const empresa = contato.empresaId ? (state.empresas.find((item) => item.id === contato.empresaId) ?? null) : null
  const carregada = timeline?.id === id ? timeline.result : null
  const linha = carregada?.ok ? carregada : null
  const para = composeDe([contato])
  const whatsapp = whatsappDestino(linha?.whatsappChatIds ?? [])
  const sugestao = sugestaoDeEmpresa(contato, state.empresas)
  const empresas: PickerItem[] = state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] }))

  /** Grava a ficha com a mudança; devolve o texto do erro (ou `null`). */
  const salvar = async (patch: Partial<ContatoInput>): Promise<string | null> => {
    setErro(null)
    const result = await useFunil.getState().saveContato({ id, nome: contato.nome, emails: contato.emails, telefones: contato.telefones, ...patch }, contato.origem)
    return result.ok ? null : result.mensagem
  }
  /** Os campos sem erro próprio mostram a falha no aviso do topo. */
  const salvarComAviso = (patch: Partial<ContatoInput>): void => {
    void salvar(patch).then((falha) => falha && setErro(falha))
  }

  const criarEmpresaSugerida = async (): Promise<void> => {
    if (!sugestao || ocupado) return
    setOcupado(true)
    setErro(null)
    const criada = await useFunil.getState().saveEmpresa({ nome: sugestao.nome, dominios: [sugestao.dominio] })
    if (!criada.ok || !criada.id) {
      setOcupado(false)
      setErro(criada.ok ? 'Não foi possível criar a empresa. Tente de novo.' : criada.mensagem)
      return
    }
    const falha = await salvar({ empresaId: criada.id })
    setOcupado(false)
    if (falha) setErro(falha)
  }

  const arquivar = async (): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().archiveContato(id)
    setOcupado(false)
    if (result.ok) onArquivado()
    else setErro(result.mensagem)
  }

  const escreverEmail = (): void => {
    if (!para.length) return
    const navState: EmailNavigationState = { compose: { to: para } }
    void navigate(EMAIL_ROOT_PATH, { state: navState })
  }

  const novaOportunidade = (): void => {
    const navState: FunilNavigationState = { nova: { contatoIds: [id], empresaId: contato.empresaId } }
    void navigate(funilPath('oportunidades'), { state: navState })
  }

  return (
    <div data-funil-ficha="contato" data-funil-ficha-id={id} className="flex max-w-[760px] flex-col">
      <EditableTitle value={contato.nome} label="Nome do contato" maxLength={FUNIL_NOME_MAX} onCommit={(nome) => salvarComAviso({ nome })} />
      <p data-funil-ficha-subtitulo className="mt-0.5 text-12 text-text-muted tabular">
        {textoSubtituloContato(contato, empresa?.nome ?? null)}
      </p>
      <div data-funil-acoes className="mt-2.5 flex flex-wrap items-center gap-2">
        {/* O botão desabilitado não recebe o ponteiro (`disabled:pointer-events-none`): a razão fica no invólucro. */}
        <span className="inline-flex" title={para.length ? undefined : 'Este contato não tem e-mail'}>
          <ActionButton icon={Mail} label="Escrever e-mail" action="funil-contato-email" disabled={!para.length} onClick={escreverEmail} />
        </span>
        {whatsapp && <ActionButton icon={Smartphone} label="Abrir WhatsApp" action="funil-contato-whatsapp" onClick={() => void navigate(whatsapp.path, { state: whatsapp.state })} />}
        <ActionButton icon={Plus} label="Nova oportunidade" action="funil-contato-nova-oportunidade" onClick={novaOportunidade} />
        {arquivando ? (
          <span className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar arquivamento">
            <span className="text-13 text-text">Arquivar? O contato sai da lista e continua nas oportunidades.</span>
            <ActionButton icon={X} label="Cancelar" action="funil-contato-arquivar-cancelar" onClick={() => setArquivando(false)} />
            <ActionButton icon={Archive} label="Arquivar" tone="danger" action="funil-contato-arquivar-confirmar" disabled={ocupado} onClick={() => void arquivar()} />
          </span>
        ) : (
          <ActionButton icon={Archive} label="Arquivar" tone="danger" action="funil-contato-arquivar" onClick={() => setArquivando(true)} />
        )}
      </div>
      {erro && (
        <Note
          id="funil-contato-erro"
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
        <LinhaCampo nome="empresa" rotulo="Empresa" rotuloId={`${ids}-empresa`}>
          <div className="w-full max-w-[240px]">
            <SearchPicker
              nome="funil-contato-empresa"
              label="Empresa"
              placeholder="Escolher ou criar…"
              itens={empresas}
              valor={empresa ? { id: empresa.id, nome: empresa.nome } : null}
              onChange={(item) => (item?.id ?? null) !== contato.empresaId && salvarComAviso({ empresaId: item?.id ?? null })}
              onCriar={(nome) => salvarComAviso({ empresaNome: nome })}
            />
          </div>
          {sugestao && (
            <p data-funil-empresa-sugestao className="flex flex-wrap items-center gap-2 text-12 text-text-muted">
              <Icon icon={Lightbulb} size={14} className="shrink-0" />
              <span>
                Sugestão: {sugestao.nome} ({sugestao.dominio})
              </span>
              <ActionButton icon={Building2} label="Criar empresa" action="funil-empresa-sugerida" disabled={ocupado} onClick={() => void criarEmpresaSugerida()} />
            </p>
          )}
        </LinhaCampo>
        <LinhaCampo nome="cargo" rotulo="Cargo">
          <CampoSalvo valor={contato.cargo ?? ''} rotulo="Cargo" maxLength={FUNIL_NOME_MAX} onSalvar={(cargo) => salvarComAviso({ cargo: cargo || null })} data={{ 'data-funil-contato-cargo': '' }} />
        </LinhaCampo>
        <LinhaCampo nome="emails" rotulo="E-mails">
          <ListaEditavel key={`emails:${id}`} nome="email" itens={contato.emails} rotuloItem="E-mail" max={FUNIL_EMAILS_MAX} validar={validarEmail} onSalvar={(emails) => salvar({ emails })} />
        </LinhaCampo>
        <LinhaCampo nome="telefones" rotulo="Telefones">
          <ListaEditavel key={`telefones:${id}`} nome="telefone" itens={contato.telefones} rotuloItem="Telefone" max={FUNIL_TELEFONES_MAX} exibir={telefoneLegivel} validar={validarTelefone} onSalvar={(telefones) => salvar({ telefones })} />
        </LinhaCampo>
        <LinhaCampo nome="notas" rotulo="Notas">
          <NotasSalvas valor={contato.notas} rotulo="Notas" onSalvar={(notas) => salvarComAviso({ notas })} />
        </LinhaCampo>
      </div>
      <BlocoOportunidades oportunidades={oportunidadesDo(view, id)} etapas={state.etapas} vazio="Nenhuma oportunidade com este contato." />
      <section data-funil-bloco="linha-do-tempo" aria-label="Linha do tempo">
        <TituloBloco>Linha do tempo</TituloBloco>
        {carregada === null ? null : !carregada.ok ? (
          <p className="py-2 text-13 text-text-muted">{'mensagem' in carregada ? carregada.mensagem : 'Não foi possível ler a linha do tempo.'}</p>
        ) : carregada.itens.length === 0 ? (
          <p className="py-2 text-13 text-text-muted">Nada na linha do tempo ainda.</p>
        ) : (
          <Timeline itens={carregada.itens} compacto />
        )}
      </section>
    </div>
  )
}

/** O que a ficha de criação devolve a quem abriu: o id do contato e, se juntou num que já existia, o nome dele. */
export interface ContatoCriado {
  id: string
  mescladoEm: string | null
}

/**
 * Novo contato (contrato 114, R32; segue o artboard 05): Nome (com o foco), Empresa, Cargo, um E-mail e um Telefone.
 * "Criar" só com nome e com e-mail ou telefone; o e-mail ou telefone que já é de alguém junta os dados nele (R4) e quem
 * abriu mostra o aviso. "Cancelar" e o Esc voltam.
 */
export function NovoContatoFicha({ view, onCriado, onCancelar }: { view: FunilView; onCriado: (criado: ContatoCriado) => void; onCancelar: () => void }) {
  const ids = useId()
  const { state } = view
  const [nome, setNome] = useState('')
  const [empresa, setEmpresa] = useState<PickerItem | null>(null)
  const [cargo, setCargo] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('[data-funil-novo-nome]')?.focus()
  }, [])

  const pronto = nome.trim() !== '' && (email.trim() !== '' || telefone.trim() !== '')
  const empresas: PickerItem[] = state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] }))

  const criar = async (): Promise<void> => {
    if (!pronto || salvando) return
    const emailNormalizado = email.trim() ? normalizarEmail(email) : null
    const telefoneNormalizado = telefone.trim() ? normalizarTelefone(telefone) : null
    if (email.trim() && !emailNormalizado) {
      setErro(EMAIL_INVALIDO)
      return
    }
    if (telefone.trim() && !telefoneNormalizado) {
      setErro(TELEFONE_INVALIDO)
      return
    }
    setSalvando(true)
    setErro(null)
    // O nome de quem já tinha o e-mail ou o telefone, para o aviso da mescla (a mescla nunca troca o nome, R4).
    const antes = new Map(state.contatos.map((contato) => [contato.id, contato.nome]))
    const input: ContatoInput = {
      nome: nome.trim(),
      emails: emailNormalizado ? [emailNormalizado] : [],
      telefones: telefoneNormalizado ? [telefoneNormalizado] : [],
      cargo: cargo.trim() || null,
      ...(empresa ? (empresa.novo ? { empresaNome: empresa.nome } : { empresaId: empresa.id }) : {}),
    }
    const result = await useFunil.getState().saveContato(input, 'manual')
    setSalvando(false)
    if (!result.ok) {
      setErro(result.mensagem)
      return
    }
    if (!result.id) return
    onCriado({ id: result.id, mescladoEm: result.mesclado ? (antes.get(result.id) ?? nome.trim()) : null })
  }

  const linha = (campo: string, rotulo: string, controle: ReactNode) => (
    <LinhaCampo nome={campo} rotulo={rotulo} rotuloId={`${ids}-${campo}`}>
      {controle}
    </LinhaCampo>
  )

  return (
    <div
      ref={ref}
      data-funil-ficha="novo-contato"
      className="flex max-w-[760px] flex-col"
      onKeyDown={(event) => {
        // O Esc que fechou a lista do SearchPicker já veio tratado.
        if (event.key !== 'Escape' || event.defaultPrevented) return
        event.preventDefault()
        onCancelar()
      }}
    >
      <h2 className="text-15 font-bold tracking-[-0.2px] text-title">Novo contato</h2>
      <p className="mt-0.5 text-12 text-text-muted">Nome e pelo menos um e-mail ou telefone.</p>
      <div className="mt-3 flex flex-col border-t border-line">
        {linha(
          'nome',
          'Nome',
          <div className={CAMPO_CLASS}>
            <TextField value={nome} onChange={setNome} onEnter={() => void criar()} ariaLabel="Nome" maxLength={FUNIL_NOME_MAX} disabled={salvando} data={{ 'data-funil-novo-nome': '' }} />
          </div>,
        )}
        {linha(
          'empresa',
          'Empresa',
          <div className="w-full max-w-[240px]">
            <SearchPicker
              nome="funil-novo-empresa"
              label="Empresa"
              placeholder="Escolher ou criar…"
              itens={empresas}
              valor={empresa}
              disabled={salvando}
              onChange={setEmpresa}
              onCriar={(texto) => setEmpresa({ id: `nova:${texto}`, nome: texto, novo: true })}
            />
          </div>,
        )}
        {linha(
          'cargo',
          'Cargo',
          <div className={CAMPO_CLASS}>
            <TextField value={cargo} onChange={setCargo} onEnter={() => void criar()} ariaLabel="Cargo" maxLength={FUNIL_NOME_MAX} disabled={salvando} data={{ 'data-funil-novo-cargo': '' }} />
          </div>,
        )}
        {linha(
          'email',
          'E-mail',
          <div className={CAMPO_CLASS}>
            <TextField value={email} onChange={setEmail} onEnter={() => void criar()} ariaLabel="E-mail" maxLength={254} disabled={salvando} data={{ 'data-funil-novo-email': '' }} />
          </div>,
        )}
        {linha(
          'telefone',
          'Telefone',
          <div className={CAMPO_CLASS}>
            <TextField value={telefone} onChange={setTelefone} onEnter={() => void criar()} ariaLabel="Telefone" maxLength={40} disabled={salvando} data={{ 'data-funil-novo-telefone': '' }} />
          </div>,
        )}
      </div>
      {erro && (
        <Note id="funil-novo-contato-erro" icon={TriangleAlert} role="alert" className="mt-3">
          {erro}
        </Note>
      )}
      <div className="mt-3 flex items-center gap-2">
        <Button icon={Plus} action="funil-contato-criar" disabled={!pronto || salvando} onClick={() => void criar()}>
          Criar
        </Button>
        <button type="button" data-action="funil-contato-cancelar" onClick={onCancelar} disabled={salvando} className={CANCELAR_CLASS}>
          Cancelar
        </button>
      </div>
    </div>
  )
}
