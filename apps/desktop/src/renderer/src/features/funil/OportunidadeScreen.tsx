import { Archive, Check, ChevronLeft, CircleX, Link as LinkIcon, Mail, Plus, SearchX, Smartphone, TriangleAlert, Unlink, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type FocusEvent, type ReactNode, type RefObject } from 'react'
import { Link, useNavigate } from 'react-router'
import { FUNIL_NOME_MAX, FUNIL_NOTAS_MAX, type FunilFalha, type FunilTimelineResult, type FunilView, type Oportunidade, type OportunidadeInput } from '@shared/funil'
import { formatarBRL } from '@shared/funil-logic'
import type { Meeting } from '@shared/meetings'
import { EMAIL_ROOT_PATH, funilPath, meetingPath, type EmailNavigationState } from '@shared/routes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { EditableTitle } from '../../design/EditableTitle'
import { EmptyState } from '../../design/EmptyState'
import { CONTROL_CLASS, Select, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { tabId, tabPanelId, Tabs } from '../../design/Tabs'
import { SearchField } from '../meetings/SearchField'
import { CANCELAR_CLASS } from './KanbanCard'
import { chaveBusca, composeDe, dataHora, dataLonga, diaLocal, diaLongo, parseValor, podeArquivar, textoPassoDetalhe, textoSubtitulo, valorParaEdicao, whatsappDestino, type PickerItem } from './funilFormat'
import { useFunil } from './funilStore'
import { SearchPicker } from './SearchPicker'
import { FUNIL_LINK_CLASS, Timeline } from './Timeline'

type Aba = 'linha' | 'reunioes' | 'notas'
const ABAS: { value: Aba; label: string }[] = [
  { value: 'linha', label: 'Linha do tempo' },
  { value: 'reunioes', label: 'Reuniões' },
  { value: 'notas', label: 'Notas' },
]
const ABAS_ID = 'funil-oportunidade'

type Campo = 'empresa' | 'contatos' | 'valor' | 'previsao' | 'proximo-passo' | 'motivo'
/** Os campos do artboard 04 (`data-funil-campo`); Origem só se lê. */
type NomeCampo = Campo | 'origem'

/** "Vincular reunião" lista as reuniões destes últimos dias (R28). */
const VINCULAR_DIAS = 90
const DIA_MS = 86_400_000

/** O valor de um campo que vira editor no clique (como o `EditableTitle`, mas no corpo 13 do artboard 04). */
const VALOR_CLASS =
  'no-drag -mx-1.5 inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-left text-13 text-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-bg-sunken'
const NOTA_CLASS = `${CONTROL_CLASS} h-auto w-full min-w-0 px-2.5 py-1.5 leading-5 select-text placeholder:text-text-faint`

type TimelineCarregada = { id: string; result: FunilTimelineResult | FunilFalha }

interface Perda {
  etapaId: string
  motivo: string
  salvando: boolean
}

/** Saiu do grupo (o foco foi para fora dele): o editor do campo fecha. */
const saiuDo = (event: FocusEvent<HTMLElement>): boolean => !(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))

/** Foco no primeiro campo do editor, ao abrir. */
function useFocoInicial<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input')?.focus()
  }, [])
  return ref
}

/**
 * Detalhe da oportunidade (contrato 119, R27 a R29, artboard 04): o cabeçalho com o título editável, a etapa e "Apagar";
 * o subtítulo com os dias na etapa e a última interação; as ações (e-mail, WhatsApp, vincular reunião, ganhar, perder e,
 * fechada, arquivar); os campos em duas colunas, cada um salvo no blur ou no Enter; e as abas Linha do tempo, Reuniões e
 * Notas. Id que não existe (ou arquivado) mostra o estado vazio com o caminho de volta ao kanban.
 */
export function OportunidadeScreen({ view, id }: { view: FunilView; id: string }) {
  const navigate = useNavigate()
  const ids = useId()
  const { state } = view
  const oportunidade = state.oportunidades.find((item) => item.id === id && !item.arquivado) ?? null
  const [now, setNow] = useState(() => Date.now())
  const [aba, setAba] = useState<Aba>('linha')
  const [timeline, setTimeline] = useState<TimelineCarregada | null>(null)
  const [reunioes, setReunioes] = useState<Meeting[] | null>(null)
  /** A última leitura da lista de reuniões falhou: as vinculadas não viram "Reunião apagada" por isso. */
  const [listaFalhou, setListaFalhou] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [perda, setPerda] = useState<Perda | null>(null)
  const [editando, setEditando] = useState<Campo | null>(null)
  const [vincular, setVincular] = useState(false)
  const [busca, setBusca] = useState('')
  const [apagando, setApagando] = useState(false)
  const [arquivando, setArquivando] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [nota, setNota] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const contatosRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // A linha do tempo vem do main (reuniões, e-mails e conversas ficam nos caches de lá) e é pedida de novo a cada
  // gravação do funil (a view nova): nota, etapa e vínculo aparecem nela sem recarregar a tela.
  useEffect(() => {
    let vivo = true
    void useFunil
      .getState()
      .timeline('oportunidade', id)
      .then((result) => vivo && setTimeline({ id, result }))
    return () => {
      vivo = false
    }
  }, [id, view])

  // As reuniões (para os títulos da aba Reuniões, da Origem e da lista de "Vincular reunião"): lidas ao abrir a tela e de
  // novo a cada vez que a lista de vincular abre.
  const [leitura, setLeitura] = useState(0)
  useEffect(() => {
    let vivo = true
    window.__scribeApi.invoke('scribe:meetings-list').then(
      (lista) => {
        if (!vivo) return
        setReunioes(lista)
        setListaFalhou(false)
      },
      () => {
        if (!vivo) return
        setReunioes((atual) => atual ?? [])
        setListaFalhou(true)
      },
    )
    return () => {
      vivo = false
    }
  }, [leitura])

  // O motivo da perda pedido na linha do título ganha o foco.
  const pedindoMotivo = perda !== null
  useEffect(() => {
    if (pedindoMotivo) ref.current?.querySelector<HTMLInputElement>('[data-funil-motivo]')?.focus()
  }, [pedindoMotivo])

  const voltar = (): void => void navigate(funilPath('oportunidades'), { replace: true })

  if (!oportunidade) {
    return (
      <div data-funil-oportunidade-vazia className="flex flex-1 flex-col items-center px-[var(--page-x)]">
        <div className="grow-[3]" />
        <EmptyState
          illustration={
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong text-text-muted">
              <Icon icon={SearchX} />
            </span>
          }
          title="Essa oportunidade não existe mais."
          action={
            <Link to={funilPath('oportunidades')} className={`${NOTE_ACTION_CLASS} text-13`}>
              Voltar para Oportunidades
            </Link>
          }
        >
          Ela pode ter sido apagada ou arquivada.
        </EmptyState>
        <div className="grow-[7]" />
      </div>
    )
  }

  const etapas = [...state.etapas].sort((a, b) => a.ordem - b.ordem)
  const etapa = etapas.find((item) => item.id === oportunidade.etapaId) ?? null
  const ganho = etapas.find((item) => item.tipo === 'ganho') ?? null
  const perdido = etapas.find((item) => item.tipo === 'perdido') ?? null
  const contatos = oportunidade.contatoIds.map((contatoId) => state.contatos.find((contato) => contato.id === contatoId)).filter((contato) => contato !== undefined)
  const empresa = oportunidade.empresaId ? (state.empresas.find((item) => item.id === oportunidade.empresaId) ?? null) : null
  const carregada = timeline?.id === id ? timeline.result : null
  const linha = carregada?.ok ? carregada : null
  const ultima = linha?.ultimaInteracao ?? view.ultimas[id] ?? Math.max(oportunidade.movidoEm, oportunidade.atualizadoEm)
  const para = composeDe(contatos)
  const whatsapp = whatsappDestino(linha?.whatsappChatIds ?? [])
  const hoje = diaLocal(now)
  const notas = state.eventos.filter((evento) => evento.oportunidadeId === id && evento.tipo === 'nota').sort((a, b) => b.at - a.at)

  /** Grava só o que mudou (o título vai sempre: o store exige). */
  const salvar = async (patch: Omit<OportunidadeInput, 'id' | 'titulo'> & { titulo?: string }): Promise<boolean> => {
    setErro(null)
    const result = await useFunil.getState().saveOportunidade({ id, titulo: oportunidade.titulo, ...patch })
    if (!result.ok) setErro(result.mensagem)
    return result.ok
  }

  /** R6 pela tela: a oportunidade entra no fim da coluna da etapa nova (os cartões que já estavam lá não mudam de lugar). */
  const mover = async (etapaId: string, motivoPerda?: string): Promise<boolean> => {
    setErro(null)
    const ordem = state.oportunidades.filter((item) => item.etapaId === etapaId && !item.arquivado && item.id !== id).length
    const result = await useFunil.getState().moveOportunidade({ id, etapaId, ordem, ...(motivoPerda === undefined ? {} : { motivoPerda }) })
    if (!result.ok) setErro(result.mensagem)
    return result.ok
  }

  const escolherEtapa = (etapaId: string): void => {
    if (etapaId === oportunidade.etapaId) {
      setPerda(null)
      return
    }
    // Perdido pede o motivo na própria linha antes de gravar (R24, R27).
    if (etapaId === perdido?.id) {
      setPerda({ etapaId, motivo: '', salvando: false })
      return
    }
    setPerda(null)
    void mover(etapaId)
  }

  const salvarPerda = async (): Promise<void> => {
    if (!perda || !perda.motivo.trim() || perda.salvando) return
    setPerda({ ...perda, salvando: true })
    if (await mover(perda.etapaId, perda.motivo.trim())) setPerda(null)
    else setPerda((atual) => (atual ? { ...atual, salvando: false } : atual))
  }

  const apagar = async (): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().deleteOportunidade(id)
    setOcupado(false)
    if (result.ok) voltar()
    else setErro(result.mensagem)
  }

  const arquivar = async (): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().archiveOportunidade(id)
    setOcupado(false)
    if (result.ok) voltar()
    else setErro(result.mensagem)
  }

  const escreverEmail = (): void => {
    if (!para.length) return
    const navState: EmailNavigationState = { compose: { to: para } }
    void navigate(EMAIL_ROOT_PATH, { state: navState })
  }

  const salvarNota = async (): Promise<void> => {
    const texto = nota.trim()
    if (!texto || ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useFunil.getState().addNota(id, texto)
    setOcupado(false)
    if (result.ok) setNota('')
    else setErro(result.mensagem)
  }

  const fechar = (): void => setEditando(null)
  const campo = (nome: NomeCampo, rotulo: string, leitura: ReactNode, editor: ReactNode, editavel = true) => (
    <div key={nome} data-funil-campo={nome} className="flex min-h-8 items-start gap-2 border-t border-line py-1">
      <span id={`${ids}-${nome}`} className="w-24 shrink-0 pt-1 text-12 text-text-muted">
        {rotulo}
      </span>
      <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1.5 text-13">
        {editavel && editando === nome ? (
          editor
        ) : editavel ? (
          <button type="button" data-funil-campo-editar={nome} aria-describedby={`${ids}-${nome}`} title="Clique para editar" onClick={() => nome !== 'origem' && setEditando(nome)} className={VALOR_CLASS}>
            {leitura}
          </button>
        ) : (
          leitura
        )}
      </div>
    </div>
  )

  const passo = textoPassoDetalhe(oportunidade.proximoPasso, hoje)
  const origemMeeting = oportunidade.origem === 'reuniao' ? (oportunidade.meetingIds[0] ?? null) : null
  const origemTitulo = origemMeeting ? (reunioes?.find((meeting) => meeting.id === origemMeeting)?.title ?? null) : null
  const empresas: PickerItem[] = state.empresas.map((item) => ({ id: item.id, nome: item.nome, detalhe: item.dominios[0] }))
  const pessoas: PickerItem[] = state.contatos.filter((contato) => !contato.arquivado || oportunidade.contatoIds.includes(contato.id)).map((contato) => ({ id: contato.id, nome: contato.nome, detalhe: contato.emails[0] }))
  const escolhidos: PickerItem[] = contatos.map((contato) => ({ id: contato.id, nome: contato.nome }))
  const fechada = podeArquivar(etapa)

  const colunaEsquerda = [
    campo(
      'empresa',
      'Empresa',
      empresa ? <span className="truncate">{empresa.nome}</span> : <span className="text-text-muted">Sem empresa</span>,
      <div
        className="w-full max-w-[320px]"
        onBlur={(event) => saiuDo(event) && fechar()}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented) fechar()
        }}
      >
        <EditorInicial>
          <SearchPicker
            nome="funil-empresa"
            label="Empresa"
            placeholder="Escolher ou criar…"
            itens={empresas}
            valor={empresa ? { id: empresa.id, nome: empresa.nome } : null}
            onChange={(item) => {
              fechar()
              if ((item?.id ?? null) !== oportunidade.empresaId) void salvar({ empresaId: item?.id ?? null })
            }}
            onCriar={(nome) => {
              fechar()
              void salvar({ empresaNome: nome })
            }}
          />
        </EditorInicial>
      </div>,
    ),
    <div key="contatos" data-funil-campo="contatos" className="flex min-h-8 items-start gap-2 border-t border-line py-1">
      <span className="w-24 shrink-0 pt-1 text-12 text-text-muted">Contatos</span>
      <div className="flex min-h-6 min-w-0 flex-1 flex-wrap items-center gap-1.5 text-13">
        {editando === 'contatos' ? (
          <div
            ref={contatosRef}
            className="w-full"
            onBlur={(event) => saiuDo(event) && fechar()}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !event.defaultPrevented) fechar()
            }}
          >
            <EditorInicial>
              <SearchPicker
                multiplo
                nome="funil-contatos"
                label="Contatos"
                placeholder="Buscar contato"
                itens={pessoas}
                valor={escolhidos}
                onChange={(lista) => {
                  void salvar({ contatoIds: lista.map((item) => item.id) })
                  // O "×" do chip sai da tela com o foco: o foco volta ao campo, para o editor continuar fechando ao sair.
                  requestAnimationFrame(() => contatosRef.current?.querySelector<HTMLInputElement>('input')?.focus())
                }}
              />
            </EditorInicial>
          </div>
        ) : (
          <>
            {contatos.map((contato) => (
              <span key={contato.id} data-funil-contato={contato.id} className="inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-[var(--radius-control)] bg-bg-sunken pr-1 pl-2 text-12 text-text">
                <span className="min-w-0 truncate">{contato.nome}</span>
                <button
                  type="button"
                  aria-label={`Tirar ${contato.nome}`}
                  data-funil-contato-tirar={contato.id}
                  onClick={() => void salvar({ contatoIds: oportunidade.contatoIds.filter((outro) => outro !== contato.id) })}
                  className="no-drag inline-flex size-4 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:text-title"
                >
                  <Icon icon={X} size={14} />
                </button>
              </span>
            ))}
            <button
              type="button"
              data-action="funil-contato-add"
              onClick={() => setEditando('contatos')}
              className="no-drag inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
            >
              <Icon icon={Plus} size={14} />
              Contato
            </button>
          </>
        )}
      </div>
    </div>,
    campo(
      'valor',
      'Valor',
      <span data-funil-valor className={`tabular ${oportunidade.valor === null ? 'text-text-muted' : ''}`}>
        {formatarBRL(oportunidade.valor)}
      </span>,
      <CampoTexto
        rotulo="Valor (R$)"
        inicial={valorParaEdicao(oportunidade.valor)}
        maxLength={20}
        onFechar={fechar}
        onSalvar={async (texto) => {
          const centavos = texto.trim() ? parseValor(texto) : null
          if (texto.trim() && centavos === null) {
            setErro('Valor fora do formato. Use, por exemplo, 1.234,56.')
            return
          }
          if (centavos !== oportunidade.valor) await salvar({ valor: centavos })
        }}
      />,
    ),
  ]
  if (etapa?.tipo === 'perdido') {
    colunaEsquerda.push(
      campo(
        'motivo',
        'Motivo',
        oportunidade.motivoPerda ? <span className="truncate">{oportunidade.motivoPerda}</span> : <span className="text-text-muted">Sem motivo</span>,
        <CampoTexto rotulo="Motivo" inicial={oportunidade.motivoPerda ?? ''} maxLength={FUNIL_NOTAS_MAX} onFechar={fechar} onSalvar={async (texto) => void (await salvar({ motivoPerda: texto.trim() || null }))} />,
      ),
    )
  }

  const colunaDireita = [
    campo(
      'previsao',
      'Previsão',
      oportunidade.previsao ? <span className="tabular">{diaLongo(oportunidade.previsao)}</span> : <span className="text-text-muted">Sem previsão</span>,
      <CampoData
        rotulo="Previsão"
        inicial={oportunidade.previsao ?? ''}
        onFechar={fechar}
        onSalvar={async (dia) => {
          if ((dia || null) !== oportunidade.previsao) await salvar({ previsao: dia || null })
        }}
      />,
    ),
    campo(
      'proximo-passo',
      'Próximo passo',
      <>
        <span className={`truncate ${oportunidade.proximoPasso ? '' : 'text-text-muted'}`}>{passo.texto}</span>
        {passo.data && (
          <span data-funil-passo-vencido={passo.vencido ? '' : undefined} className={`shrink-0 text-12 whitespace-nowrap tabular ${passo.vencido ? 'text-rec' : 'text-text-muted'}`}>
            {passo.data}
          </span>
        )}
      </>,
      <CampoPasso
        inicial={oportunidade.proximoPasso}
        onFechar={fechar}
        onSalvar={async (texto, data) => {
          const proximoPasso = texto.trim() ? { texto: texto.trim(), data: data || null } : null
          if (JSON.stringify(proximoPasso) !== JSON.stringify(oportunidade.proximoPasso)) await salvar({ proximoPasso })
        }}
      />,
    ),
    campo(
      'origem',
      'Origem',
      <span data-funil-origem className="flex min-h-6 min-w-0 items-center truncate">
        {oportunidade.origem === 'assistente' ? (
          'Assistente'
        ) : oportunidade.origem === 'manual' ? (
          'Criada no funil'
        ) : origemMeeting && origemTitulo ? (
          <>
            Reunião ·&nbsp;
            <Link to={meetingPath(origemMeeting)} className={FUNIL_LINK_CLASS}>
              {origemTitulo}
            </Link>
          </>
        ) : (
          'Reunião'
        )}
      </span>,
      null,
      false,
    ),
  ]

  const reunioesRecentes = (reunioes ?? [])
    .filter((meeting) => !oportunidade.meetingIds.includes(meeting.id) && Date.parse(meeting.startedAt) >= now - VINCULAR_DIAS * DIA_MS)
    .filter((meeting) => !busca.trim() || chaveBusca(meeting.title).includes(chaveBusca(busca)))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))

  return (
    <div ref={ref} data-funil-oportunidade={id} className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-line px-8 pt-5">
        <Link
          to={funilPath('oportunidades')}
          draggable={false}
          data-action="funil-voltar"
          className="no-drag inline-flex h-4 items-center gap-1.5 rounded-[var(--radius-control)] pr-1 text-12 text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
        >
          <Icon icon={ChevronLeft} size={14} />
          Oportunidades
        </Link>
        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="max-w-full min-w-0">
              <EditableTitle value={oportunidade.titulo} label="Título da oportunidade" maxLength={FUNIL_NOME_MAX} onCommit={(titulo) => void salvar({ titulo })} />
            </div>
            <div data-funil-etapa-select className="flex">
              <label htmlFor={`${ids}-etapa`} className="sr-only">
                Etapa
              </label>
              <Select id={`${ids}-etapa`} value={perda?.etapaId ?? oportunidade.etapaId} options={etapas.map((item) => ({ value: item.id, label: item.nome }))} onChange={escolherEtapa} />
            </div>
            {perda && (
              <div
                data-funil-detalhe-perda
                className="flex min-w-0 items-center gap-2"
                onKeyDown={(event) => {
                  if (event.key !== 'Escape' || event.defaultPrevented) return
                  event.preventDefault()
                  setPerda(null)
                }}
              >
                <label htmlFor={`${ids}-motivo`} className="shrink-0 text-12 text-text-muted">
                  Motivo
                </label>
                <div className="flex w-[240px] min-w-0">
                  <TextField
                    id={`${ids}-motivo`}
                    value={perda.motivo}
                    onChange={(motivo) => setPerda((atual) => (atual ? { ...atual, motivo } : atual))}
                    onEnter={() => void salvarPerda()}
                    maxLength={2000}
                    disabled={perda.salvando}
                    data={{ 'data-funil-motivo': '' }}
                  />
                </div>
                <Button action="funil-motivo-salvar" onClick={() => void salvarPerda()} disabled={!perda.motivo.trim() || perda.salvando}>
                  Salvar
                </Button>
                <button type="button" data-action="funil-motivo-cancelar" onClick={() => setPerda(null)} disabled={perda.salvando} className={CANCELAR_CLASS}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
          {apagando ? (
            <div className="flex shrink-0 items-center gap-2" role="group" aria-label="Confirmar exclusão">
              <p className="mr-1 text-13 text-text">Apagar esta oportunidade e o histórico dela?</p>
              <Button action="funil-apagar-cancelar" variant="secondary" onClick={() => setApagando(false)}>
                Cancelar
              </Button>
              <Button action="funil-apagar-confirmar" variant="danger" disabled={ocupado} onClick={() => void apagar()}>
                Apagar
              </Button>
            </div>
          ) : (
            <Button action="funil-apagar" variant="danger" onClick={() => setApagando(true)}>
              Apagar
            </Button>
          )}
        </div>
        <p data-funil-subtitulo className="mt-1 text-12 text-text-muted tabular">
          {textoSubtitulo(oportunidade, etapa, ultima, now)}
        </p>
        <div data-funil-acoes className="mt-2.5 flex flex-wrap items-center gap-2">
          {/* O botão desabilitado não recebe o ponteiro (`disabled:pointer-events-none`): a razão fica no invólucro. */}
          <span className="inline-flex" title={para.length ? undefined : 'Nenhum contato desta oportunidade tem e-mail'}>
            <ActionButton icon={Mail} label="Escrever e-mail" action="funil-escrever-email" disabled={!para.length} onClick={escreverEmail} />
          </span>
          {whatsapp && <ActionButton icon={Smartphone} label="Abrir WhatsApp" action="funil-abrir-whatsapp" onClick={() => void navigate(whatsapp.path, { state: whatsapp.state })} />}
          <ActionButton
            icon={LinkIcon}
            label="Vincular reunião"
            action="funil-vincular-reuniao"
            onClick={() => {
              setBusca('')
              if (!vincular) setLeitura((atual) => atual + 1)
              setVincular(!vincular)
            }}
          />
          {ganho && <ActionButton icon={Check} label="Marcar como ganha" action="funil-marcar-ganha" disabled={etapa?.tipo === 'ganho'} onClick={() => void mover(ganho.id).then((ok) => ok && setPerda(null))} />}
          {perdido && <ActionButton icon={CircleX} label="Marcar como perdida" action="funil-marcar-perdida" disabled={etapa?.tipo === 'perdido'} onClick={() => setPerda({ etapaId: perdido.id, motivo: '', salvando: false })} />}
          {fechada &&
            (arquivando ? (
              <span className="flex items-center gap-2" role="group" aria-label="Confirmar arquivamento">
                <span className="text-13 text-text">Arquivar? Ela sai do quadro e continua na ficha do contato.</span>
                <ActionButton icon={X} label="Cancelar" action="funil-arquivar-cancelar" onClick={() => setArquivando(false)} />
                <ActionButton icon={Archive} label="Arquivar" action="funil-arquivar-confirmar" disabled={ocupado} onClick={() => void arquivar()} />
              </span>
            ) : (
              <ActionButton icon={Archive} label="Arquivar" action="funil-arquivar" onClick={() => setArquivando(true)} />
            ))}
        </div>
        {vincular && (
          <section data-funil-vincular aria-label="Vincular reunião" className="mt-2.5 flex max-w-[560px] flex-col gap-2 rounded-[var(--radius-panel)] border border-line p-2.5">
            <div className="flex items-center gap-2 [&>div[role=search]]:w-auto [&>div[role=search]]:flex-1">
              <SearchField value={busca} onChange={setBusca} label="Buscar reuniões dos últimos 90 dias" />
              <button type="button" data-action="funil-vincular-fechar" onClick={() => setVincular(false)} className={CANCELAR_CLASS}>
                Fechar
              </button>
            </div>
            {reunioes === null ? null : listaFalhou ? (
              <p className="px-1 py-1.5 text-13 text-text-muted">Não foi possível ler a lista de reuniões. Feche e abra de novo.</p>
            ) : reunioesRecentes.length === 0 ? (
              <p className="px-1 py-1.5 text-13 text-text-muted">{busca.trim() ? 'Nenhuma reunião com esse título.' : 'Nenhuma reunião nos últimos 90 dias para vincular.'}</p>
            ) : (
              <ul className="flex max-h-[240px] flex-col overflow-y-auto">
                {reunioesRecentes.map((meeting) => (
                  <li key={meeting.id}>
                    <button
                      type="button"
                      data-funil-vincular-reuniao={meeting.id}
                      onClick={() => {
                        setVincular(false)
                        void salvar({ meetingIds: [...oportunidade.meetingIds, meeting.id] })
                      }}
                      className="no-drag flex h-8 w-full min-w-0 items-center gap-2 rounded-[var(--radius-control)] px-2 text-left text-13 text-text hover:bg-bg-sunken"
                    >
                      <span className="min-w-0 flex-1 truncate">{meeting.title}</span>
                      <span className="shrink-0 text-12 text-text-faint tabular">{dataLonga(Date.parse(meeting.startedAt))}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <div className="mt-3 grid grid-cols-2 gap-x-8">
          <div className="flex min-w-0 flex-col">{colunaEsquerda}</div>
          <div className="flex min-w-0 flex-col">{colunaDireita}</div>
        </div>
        <div className="mt-2">
          <Tabs value={aba} tabs={ABAS} onChange={setAba} label="Conteúdo da oportunidade" id={ABAS_ID} />
        </div>
      </header>
      {erro && (
        <Note
          id="funil-oportunidade-erro"
          icon={TriangleAlert}
          role="alert"
          className="mx-8 mt-3"
          action={
            <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => setErro(null)}>
              Fechar
            </button>
          }
        >
          {erro}
        </Note>
      )}
      <div role="tabpanel" id={tabPanelId(ABAS_ID, aba)} aria-labelledby={tabId(ABAS_ID, aba)} data-tab-panel={aba} className="min-h-0 flex-1 overflow-y-auto px-8 pt-1 pb-5">
        <div className="max-w-[760px]">
          {aba === 'linha' &&
            (carregada === null ? null : !carregada.ok ? (
              <Note id="funil-timeline-falhou" icon={TriangleAlert} role="alert" className="mt-3">
                {'mensagem' in carregada ? carregada.mensagem : 'Não foi possível ler a linha do tempo.'}
              </Note>
            ) : carregada.itens.length === 0 ? (
              <p className="pt-3 text-13 text-text-muted">Nada na linha do tempo ainda.</p>
            ) : (
              <Timeline itens={carregada.itens} />
            ))}
          {aba === 'reunioes' && <AbaReunioes oportunidade={oportunidade} reunioes={reunioes} indisponivel={listaFalhou} onDesvincular={(meetingId) => void salvar({ meetingIds: oportunidade.meetingIds.filter((outro) => outro !== meetingId) })} />}
          {aba === 'notas' && (
            <div className="flex flex-col gap-2 pt-3">
              <label htmlFor={`${ids}-nota`} className="text-12 text-text-muted">
                Nova nota
              </label>
              <textarea id={`${ids}-nota`} data-funil-nota-texto rows={3} value={nota} maxLength={FUNIL_NOTAS_MAX} disabled={ocupado} onChange={(event) => setNota(event.target.value)} className={NOTA_CLASS} />
              <div>
                <Button action="funil-nota-salvar" disabled={!nota.trim() || ocupado} onClick={() => void salvarNota()}>
                  Salvar
                </Button>
              </div>
              {notas.length === 0 ? (
                <p className="pt-1 text-13 text-text-muted">Nenhuma nota ainda.</p>
              ) : (
                <ol className="mt-1 flex flex-col">
                  {notas.map((evento) => (
                    <li key={evento.id} data-funil-nota={evento.id} className="flex flex-col gap-0.5 border-b border-line py-2.5">
                      <time className="text-12 text-text-faint tabular">{dataHora(evento.at)}</time>
                      <p className="text-13 whitespace-pre-wrap text-text">{evento.texto}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Foco no campo do editor ao abrir (o editor abre pelo clique no valor). */
function EditorInicial({ children }: { children: ReactNode }) {
  const ref = useFocoInicial<HTMLDivElement>()
  return <div ref={ref}>{children}</div>
}

/** Valor e Motivo: um campo que salva no Enter ou ao sair; Esc fecha sem salvar. */
function CampoTexto({ rotulo, inicial, maxLength, onSalvar, onFechar }: { rotulo: string; inicial: string; maxLength: number; onSalvar: (texto: string) => Promise<void>; onFechar: () => void }) {
  const ref = useFocoInicial<HTMLDivElement>()
  const [texto, setTexto] = useState(inicial)
  const feito = useRef(false)
  const concluir = (): void => {
    if (feito.current) return
    feito.current = true
    onFechar()
    if (texto !== inicial) void onSalvar(texto)
  }
  return (
    <div
      ref={ref}
      className="flex w-full max-w-[320px]"
      onBlur={(event) => saiuDo(event) && concluir()}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        feito.current = true
        onFechar()
      }}
    >
      <TextField value={texto} onChange={setTexto} onEnter={concluir} ariaLabel={rotulo} maxLength={maxLength} data={{ 'data-funil-campo-input': '' }} />
    </div>
  )
}

/** Previsão: a data salva ao sair do campo ou no Enter; vazia, tira a previsão. */
function CampoData({ rotulo, inicial, onSalvar, onFechar }: { rotulo: string; inicial: string; onSalvar: (dia: string) => Promise<void>; onFechar: () => void }) {
  const ref = useFocoInicial<HTMLDivElement>()
  const [dia, setDia] = useState(inicial)
  const feito = useRef(false)
  const concluir = (): void => {
    if (feito.current) return
    feito.current = true
    onFechar()
    if (dia !== inicial) void onSalvar(dia)
  }
  return (
    <div
      ref={ref}
      className="flex"
      onBlur={(event) => saiuDo(event) && concluir()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          concluir()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          feito.current = true
          onFechar()
        }
      }}
    >
      <input type="date" aria-label={rotulo} data-funil-campo-input="" value={dia} onChange={(event) => setDia(event.target.value)} className={`${CONTROL_CLASS} min-w-0 px-2 select-text`} />
    </div>
  )
}

/** Próximo passo: o texto e a data, salvos juntos ao sair do par ou no Enter; texto vazio tira o passo. */
function CampoPasso({ inicial, onSalvar, onFechar }: { inicial: Oportunidade['proximoPasso']; onSalvar: (texto: string, data: string) => Promise<void>; onFechar: () => void }) {
  const ref = useFocoInicial<HTMLDivElement>()
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [data, setData] = useState(inicial?.data ?? '')
  const feito = useRef(false)
  const concluir = (): void => {
    if (feito.current) return
    feito.current = true
    onFechar()
    void onSalvar(texto, data)
  }
  return (
    <div
      ref={ref}
      className="flex w-full min-w-0 flex-wrap items-center gap-1.5"
      onBlur={(event) => saiuDo(event) && concluir()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          concluir()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          feito.current = true
          onFechar()
        }
      }}
    >
      <div className="flex min-w-[160px] flex-1">
        <TextField value={texto} onChange={setTexto} ariaLabel="Próximo passo" maxLength={2000} data={{ 'data-funil-campo-input': '' }} />
      </div>
      <input type="date" aria-label="Data do próximo passo" data-funil-passo-data="" value={data} onChange={(event) => setData(event.target.value)} className={`${CONTROL_CLASS} min-w-0 px-2 select-text`} />
    </div>
  )
}

/** Aba Reuniões (R29): as reuniões vinculadas, inclusive a que não existe mais, cada uma com "Desvincular". */
function AbaReunioes({ oportunidade, reunioes, indisponivel, onDesvincular }: { oportunidade: Oportunidade; reunioes: Meeting[] | null; indisponivel: boolean; onDesvincular: (meetingId: string) => void }) {
  if (reunioes === null) return null
  if (!oportunidade.meetingIds.length) return <p className="pt-3 text-13 text-text-muted">Nenhuma reunião vinculada. Use “Vincular reunião” para escolher uma.</p>
  return (
    <ol className="flex flex-col">
      {oportunidade.meetingIds.map((meetingId) => {
        const meeting = reunioes.find((item) => item.id === meetingId) ?? null
        // "Reunião apagada" só com a lista lida: sem ela, não dá para saber se a reunião existe.
        const apagada = !meeting && !indisponivel
        return (
          <li key={meetingId} data-funil-reuniao={meetingId} data-funil-reuniao-apagada={apagada ? '' : undefined} className="flex min-h-11 items-center gap-3 border-b border-line py-1.5">
            <div className="flex min-w-0 flex-1 flex-col">
              {meeting ? (
                <Link to={meetingPath(meeting.id)} className={`${FUNIL_LINK_CLASS} truncate text-13`}>
                  {meeting.title}
                </Link>
              ) : (
                <span className="truncate text-13 text-text-muted">{apagada ? 'Reunião apagada' : 'Reunião (lista indisponível)'}</span>
              )}
              {meeting && <span className="text-12 text-text-faint tabular">{dataHora(Date.parse(meeting.startedAt))}</span>}
            </div>
            <ActionButton icon={Unlink} label="Desvincular" action="funil-desvincular" onClick={() => onDesvincular(meetingId)} />
          </li>
        )
      })}
    </ol>
  )
}
