import { Funnel, Link2, Plus, RefreshCw, TriangleAlert, X } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { FUNIL_VERSION, type FunilState, type Oportunidade } from '@shared/funil'
import { normalizarEmail } from '@shared/funil-logic'
import type { FunilPropostaCampos, FunilPropostaView, PropostaOportunidade } from '@shared/funil-proposta'
import { funilPath } from '@shared/routes'
import { Button } from '../../design/Button'
import { CONTROL_CLASS, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { modelLabel } from '../chat/format'
import { contatoLigado, useFunilCompartilhado, useFunilIndisponivel } from '../funil/ContactLink'
import { chaveBusca, parseValor, valorParaEdicao, type PickerItem } from '../funil/funilFormat'
import { CANCELAR_CLASS } from '../funil/KanbanCard'
import { etapaInicial, textoEfeito, type PropostaDaReuniao } from '../funil/proposalStore'
import { SearchPicker } from '../funil/SearchPicker'
import { FUNIL_LINK_CLASS } from '../funil/Timeline'
import { timeLabel } from './format'

const LABEL = 'text-12 text-text-muted'
/** Empresa que ainda não existe no funil: o item do `SearchPicker` com "(nova)" (o main cria ao aplicar, D20). */
const EMPRESA_NOVA = 'nova:'

/** O e-mail dentro do chip: preenchido parece texto (o campo aparece no foco); vazio, o campo à mostra (R39). */
const CHIP_EMAIL = 'no-drag h-5 max-w-[220px] min-w-0 rounded-[var(--radius-control)] border px-1 text-12 select-text placeholder:text-text-faint'
const chipEmailTom = (valor: string): string => (valor ? 'border-transparent bg-transparent text-text-muted hover:border-line-strong focus:border-line-strong focus:bg-bg-raised' : 'border-line-strong bg-bg-raised text-text')

type Verbo = 'criada' | 'atualizada' | 'vinculada'

interface ContatoDoCartao {
  nome: string
  /** Vazio: o contato não é criado e o nome vai para a nota "Citados na reunião" (R39). */
  email: string
}

interface OpportunityCardProps {
  meetingId: string
  view: FunilPropostaView
  aplicar: PropostaDaReuniao['aplicar']
  descartar: PropostaDaReuniao['descartar']
}

/** Sem a view do funil (ainda carregando ou a leitura falhou): o cartão aparece assim mesmo, sem listas. */
const FUNIL_VAZIO: FunilState = { version: FUNIL_VERSION, contatos: [], empresas: [], oportunidades: [], etapas: [], eventos: [], ignorados: [], ultimoAvisoEm: null }

/** As abertas não arquivadas, pela ordem do quadro (o `Select` do "Vincular a existente…"). */
function abertas(state: FunilState): Oportunidade[] {
  const etapas = new Map(state.etapas.map((etapa) => [etapa.id, etapa]))
  return state.oportunidades
    .filter((op) => !op.arquivado && etapas.get(op.etapaId)?.tipo === 'aberta')
    .sort((a, b) => (etapas.get(a.etapaId)?.ordem ?? 0) - (etapas.get(b.etapaId)?.ordem ?? 0) || a.ordem - b.ordem)
}

/** Na volta à aba, de onde veio a oportunidade aceita (o arquivo só guarda o id). */
function verboAceito(proposta: PropostaOportunidade | null, op: Oportunidade | undefined, meetingId: string): Verbo {
  if (proposta?.acao === 'atualizar') return 'atualizada'
  return op && op.origem === 'reuniao' && op.meetingIds[0] === meetingId ? 'criada' : 'vinculada'
}

/**
 * Cartão "Oportunidade detectada" da aba Resumo (contrato 116, R39, artboard 09): os campos da proposta editáveis e
 * "Criar" (ou "Atualizar"), "Vincular a existente…" e "Ignorar". Nada é gravado sem um desses cliques. Aceita, vira a
 * linha "Oportunidade criada: <título>"; ignorada, some.
 */
export function OpportunityCard({ meetingId, view, aplicar, descartar }: OpportunityCardProps) {
  const funil = useFunilCompartilhado()
  const indisponivel = useFunilIndisponivel()
  const navigate = useNavigate()
  const arquivo = view.arquivo
  const [feito, setFeito] = useState<Verbo | null>(null)
  if (!arquivo) return null
  const state = funil?.state ?? FUNIL_VAZIO
  if (arquivo.status === 'accepted' && arquivo.oportunidadeId) {
    const op = state.oportunidades.find((item) => item.id === arquivo.oportunidadeId)
    const verbo = feito ?? verboAceito(arquivo.proposta, op, meetingId)
    const id = arquivo.oportunidadeId
    return (
      <p data-funil-proposta-feita={verbo} className="flex flex-wrap items-center gap-2 text-13 text-text">
        <Icon icon={Funnel} className="shrink-0 text-text-muted" />
        <span>Oportunidade {verbo}:</span>
        <button type="button" data-funil-proposta-link={id} className={FUNIL_LINK_CLASS} onClick={() => void navigate(funilPath('oportunidades', id))}>
          {op?.titulo ?? arquivo.proposta?.titulo ?? 'Oportunidade'}
        </button>
      </p>
    )
  }
  if (arquivo.status !== 'proposed' || !arquivo.proposta) return null
  return <Cartao view={view} proposta={arquivo.proposta} cabecalho={`${modelLabel(arquivo.model)} · ${timeLabel(new Date(arquivo.createdAt))}`} state={state} indisponivel={indisponivel} aplicar={aplicar} descartar={descartar} onFeito={setFeito} />
}

function Cartao({
  view,
  proposta,
  cabecalho,
  state,
  indisponivel,
  aplicar,
  descartar,
  onFeito,
}: {
  view: FunilPropostaView
  proposta: PropostaOportunidade
  cabecalho: string
  state: FunilState
  /** A leitura do funil falhou (o texto); o cartão fica, sem as listas, e "Criar" espera a etapa. */
  indisponivel: string | null
  aplicar: PropostaDaReuniao['aplicar']
  descartar: PropostaDaReuniao['descartar']
  onFeito: (verbo: Verbo) => void
}) {
  const ids = useId()
  const navigate = useNavigate()
  const atualizar = proposta.acao === 'atualizar'
  const existente = atualizar ? state.oportunidades.find((op) => op.id === proposta.oportunidadeId) : undefined
  const [titulo, setTitulo] = useState(proposta.titulo)
  const [etapaEscolhida, setEtapaId] = useState<string | null>(null)
  const etapaId = etapaEscolhida ?? etapaInicial(state.etapas, proposta.etapaSugerida)?.id ?? ''
  const [empresa, setEmpresa] = useState<string | null>(proposta.empresa)
  const [valor, setValor] = useState(() => valorParaEdicao(proposta.valor))
  const [contatos, setContatos] = useState<ContatoDoCartao[]>(() => proposta.contatos.map((contato) => ({ nome: contato.nome, email: contato.email ?? '' })))
  const [previsao, setPrevisao] = useState(proposta.previsao ?? '')
  const [passoTexto, setPassoTexto] = useState(proposta.proximoPasso?.texto ?? '')
  const [passoData, setPassoData] = useState(proposta.proximoPasso?.data ?? '')
  const listaAbertas = abertas(state)
  const [vinculando, setVinculando] = useState(false)
  const [alvoEscolhido, setAlvo] = useState<string | null>(null)
  const alvo = alvoEscolhido ?? view.duplicata?.id ?? listaAbertas[0]?.id ?? ''
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const etapasAbertas = [...state.etapas].filter((etapa) => etapa.tipo === 'aberta').sort((a, b) => a.ordem - b.ordem)
  const empresas: PickerItem[] = state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] }))
  const empresaExistente = empresa ? state.empresas.find((item) => chaveBusca(item.nome) === chaveBusca(empresa)) : undefined
  const empresaItem: PickerItem | null = empresa ? (empresaExistente ? { id: empresaExistente.id, nome: empresaExistente.nome } : { id: `${EMPRESA_NOVA}${empresa}`, nome: `${empresa} (nova)`, novo: true }) : null
  const ligados = contatos.map((contato) => (normalizarEmail(contato.email) !== null ? contatoLigado(state.contatos, { email: contato.email }) : null))
  const naLista = new Set(ligados.flatMap((contato) => (contato ? [contato.id] : [])))
  const pessoas: PickerItem[] = state.contatos.filter((contato) => !contato.arquivado && !naLista.has(contato.id)).map((contato) => ({ id: contato.id, nome: contato.nome, detalhe: contato.emails[0] }))
  const efeito = textoEfeito({
    contatosNovos: contatos.filter((contato, index) => normalizarEmail(contato.email) !== null && !ligados[index]).length,
    empresaNova: empresa !== null && empresa.trim() !== '' && !empresaExistente,
    citados: contatos.filter((contato) => !contato.email.trim()).map((contato) => contato.nome),
  })

  const campos = (): FunilPropostaCampos | null => {
    const centavos = valor.trim() ? parseValor(valor) : null
    if (valor.trim() && centavos === null) {
      setErro('Valor fora do formato. Use, por exemplo, 1.234,56.')
      return null
    }
    return {
      titulo: titulo.trim(),
      empresa: empresa?.trim() || null,
      contatos: contatos.map((contato) => ({ nome: contato.nome.trim(), email: contato.email.trim() || null })),
      etapaId,
      valor: centavos,
      previsao: previsao || null,
      proximoPasso: passoTexto.trim() ? { texto: passoTexto.trim(), data: passoData || null } : null,
    }
  }

  const executar = async (vincularA?: string): Promise<void> => {
    if (ocupado) return
    setErro(null)
    const pedido = campos()
    if (!pedido) return
    setOcupado(true)
    const result = await aplicar(pedido, vincularA)
    setOcupado(false)
    if (result.ok) onFeito(vincularA !== undefined ? 'vinculada' : atualizar ? 'atualizada' : 'criada')
    else setErro(result.mensagem)
  }

  const ignorar = async (): Promise<void> => {
    if (ocupado) return
    setErro(null)
    setOcupado(true)
    const ok = await descartar()
    setOcupado(false)
    if (!ok) setErro('Não foi possível ignorar agora. Tente de novo.')
  }

  const campo = (rotulo: string, id: string, conteudo: ReactNode, largo = false): ReactNode => (
    <>
      <label htmlFor={id} className={LABEL}>
        {rotulo}
      </label>
      <div className={`flex min-w-0 ${largo ? 'col-span-3' : ''}`}>{conteudo}</div>
    </>
  )

  return (
    <section data-funil-proposta={proposta.acao} aria-label={atualizar ? 'Atualizar oportunidade' : 'Oportunidade detectada'} className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised p-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="flex min-w-0 items-center gap-2 text-14 leading-5 font-semibold text-title">
            <Icon icon={Funnel} className="shrink-0" />
            <span className="min-w-0 truncate">{atualizar ? `Atualizar oportunidade: ${existente?.titulo ?? proposta.titulo}` : 'Oportunidade detectada'}</span>
          </h3>
          <span data-funil-proposta-modelo="" className="shrink-0 text-12 text-text-muted tabular">
            {cabecalho}
          </span>
        </div>
        {proposta.justificativa && (
          <p data-funil-proposta-porque="" className="label text-pretty select-text">
            Por quê: {proposta.justificativa}
          </p>
        )}
      </div>

      <div className="grid grid-cols-[84px_minmax(0,1fr)_72px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        {campo('Título', `${ids}-titulo`, <TextField id={`${ids}-titulo`} value={titulo} onChange={setTitulo} maxLength={200} disabled={ocupado} data={{ 'data-funil-proposta-titulo': '' }} />)}
        {campo(
          'Etapa',
          `${ids}-etapa`,
          <select id={`${ids}-etapa`} data-funil-proposta-etapa="" value={etapaId} disabled={ocupado} onChange={(event) => setEtapaId(event.target.value)} className={`${CONTROL_CLASS} w-full min-w-0 px-2.5`}>
            {etapasAbertas.map((etapa) => (
              <option key={etapa.id} value={etapa.id}>
                {etapa.nome}
              </option>
            ))}
          </select>,
        )}
        {campo(
          'Empresa',
          `${ids}-empresa`,
          <SearchPicker
            nome="proposta-empresa"
            id={`${ids}-empresa`}
            label="Empresa"
            placeholder="Escolher ou criar…"
            itens={empresas}
            valor={empresaItem}
            onChange={(item) => setEmpresa(item ? (item.id.startsWith(EMPRESA_NOVA) ? item.id.slice(EMPRESA_NOVA.length) : item.nome) : null)}
            onCriar={setEmpresa}
            disabled={ocupado}
          />,
        )}
        {campo('Valor (R$)', `${ids}-valor`, <TextField id={`${ids}-valor`} value={valor} onChange={setValor} maxLength={20} disabled={ocupado} data={{ 'data-funil-proposta-valor': '' }} />)}
        {campo(
          'Contatos',
          `${ids}-contatos`,
          <div className="flex w-full min-w-0 flex-col gap-1">
            {contatos.length > 0 && (
              <div className="flex min-w-0 flex-wrap gap-1">
                {contatos.map((contato, index) => (
                  <span
                    key={index}
                    data-funil-proposta-contato={index}
                    className={`inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] pr-1 pl-2 text-12 text-text ${ligados[index] ? 'bg-bg-sunken' : 'bg-hl'}`}
                  >
                    <span className="min-w-0 truncate">{contato.nome}</span>
                    <input
                      type="email"
                      aria-label={`E-mail de ${contato.nome}`}
                      placeholder="e-mail"
                      data-funil-proposta-email={index}
                      value={contato.email}
                      size={Math.max(8, contato.email.length + 1)}
                      maxLength={254}
                      autoComplete="off"
                      spellCheck={false}
                      disabled={ocupado}
                      onChange={(event) => setContatos(contatos.map((item, i) => (i === index ? { ...item, email: event.target.value } : item)))}
                      className={`${CHIP_EMAIL} ${chipEmailTom(contato.email)}`}
                    />
                    <button
                      type="button"
                      aria-label={`Tirar ${contato.nome}`}
                      data-funil-proposta-tirar={index}
                      disabled={ocupado}
                      onClick={() => setContatos(contatos.filter((_, i) => i !== index))}
                      className="inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title"
                    >
                      <Icon icon={X} size={14} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <SearchPicker
              multiplo
              nome="proposta-contatos"
              id={`${ids}-contatos`}
              label="Adicionar contato"
              placeholder="Adicionar contato"
              itens={pessoas}
              valor={[]}
              onChange={(itens) => {
                const novos = itens.flatMap((item) => {
                  const contato = state.contatos.find((outro) => outro.id === item.id)
                  return contato ? [{ nome: contato.nome, email: contato.emails[0] ?? '' }] : []
                })
                setContatos([...contatos, ...novos])
              }}
              onCriar={(nome) => setContatos([...contatos, { nome, email: '' }])}
              disabled={ocupado}
            />
          </div>,
          true,
        )}
        {campo(
          'Previsão',
          `${ids}-previsao`,
          <input id={`${ids}-previsao`} type="date" data-funil-proposta-previsao="" value={previsao} disabled={ocupado} onChange={(event) => setPrevisao(event.target.value)} className={`${CONTROL_CLASS} w-full min-w-0 px-2 select-text`} />,
        )}
        <span aria-hidden="true" className="col-span-2" />
        {campo(
          'Próximo passo',
          `${ids}-passo`,
          <div className="flex w-full min-w-0 items-center gap-2">
            <div className="flex min-w-0 flex-1">
              <TextField id={`${ids}-passo`} value={passoTexto} onChange={setPassoTexto} maxLength={500} disabled={ocupado} data={{ 'data-funil-proposta-passo': '' }} />
            </div>
            <input type="date" aria-label="Data do próximo passo" data-funil-proposta-passo-data="" value={passoData} disabled={ocupado} onChange={(event) => setPassoData(event.target.value)} className={`${CONTROL_CLASS} w-[150px] shrink-0 px-2 select-text`} />
          </div>,
          true,
        )}
      </div>

      {indisponivel && (
        <Note id="funil-proposta-indisponivel" icon={TriangleAlert} role="status">
          Funil indisponível: as etapas, as empresas e os contatos não carregaram. {indisponivel}
        </Note>
      )}

      {view.duplicata && (
        <Note id="funil-proposta-duplicata" icon={Link2}>
          <span data-funil-aviso-duplicata={view.duplicata.id}>
            Já existe «
            <button type="button" data-action="funil-proposta-duplicata-abrir" className={FUNIL_LINK_CLASS} onClick={() => view.duplicata && void navigate(funilPath('oportunidades', view.duplicata.id))}>
              {view.duplicata.titulo}
            </button>
            » aberta para esta empresa. Use “Vincular a existente…” para juntar esta reunião a ela.
          </span>
        </Note>
      )}

      {vinculando && (
        <div data-funil-proposta-vincular-linha="" className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${ids}-vincular`} className={LABEL}>
            Vincular a
          </label>
          <select id={`${ids}-vincular`} data-funil-proposta-vincular-select="" value={alvo} disabled={ocupado} onChange={(event) => setAlvo(event.target.value)} className={`${CONTROL_CLASS} min-w-[240px] flex-1 px-2.5`}>
            {listaAbertas.map((op) => (
              <option key={op.id} value={op.id}>
                {op.titulo}
              </option>
            ))}
          </select>
          <Button action="funil-proposta-vincular-confirmar" variant="secondary" onClick={() => void executar(alvo)} disabled={ocupado || !alvo}>
            Vincular
          </Button>
        </div>
      )}

      {erro && (
        <Note id="funil-proposta-erro" icon={TriangleAlert} role="alert">
          {erro}
        </Note>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button action="funil-proposta-aplicar" icon={atualizar ? RefreshCw : Plus} onClick={() => void executar()} disabled={ocupado || !titulo.trim() || !etapaId}>
          {atualizar ? 'Atualizar' : 'Criar'}
        </Button>
        <Button action="funil-proposta-vincular" variant="secondary" icon={Link2} onClick={() => setVinculando(!vinculando)} disabled={ocupado || listaAbertas.length === 0}>
          Vincular a existente…
        </Button>
        <button type="button" data-action="funil-proposta-ignorar" onClick={() => void ignorar()} disabled={ocupado} className={CANCELAR_CLASS}>
          Ignorar
        </button>
        {efeito && (
          <span data-funil-proposta-efeito="" className="ml-auto text-12 text-pretty text-text-muted">
            {efeito}
          </span>
        )}
      </div>
    </section>
  )
}
