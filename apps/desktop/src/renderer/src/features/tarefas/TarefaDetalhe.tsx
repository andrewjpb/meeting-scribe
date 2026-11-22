import { Bell, CalendarDays, Check, CircleX, Funnel, Link as LinkIcon, Mail, NotebookText, Plus, RotateCcw, Smartphone, Trash2, TriangleAlert, User, Users, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { semAcento } from '@shared/funil-logic'
import type { Meeting } from '@shared/meetings'
import { emailPath, funilPath, meetingPath, ROUTE_PATHS, type EmailNavigationState, type WhatsAppNavigationState } from '@shared/routes'
import { TAREFA_DETALHE_MAX, TAREFA_TITULO_MAX, type EventoTarefaTipo, type ResponsavelTarefa, type Tarefa, type TarefaSalvar, type TarefasView } from '@shared/tarefas'
import { lembretePadrao } from '@shared/tarefas-logic'
import { useSettings } from '../../app/settingsStore'
import { ActionButton } from '../../design/ActionButton'
import { EditableTitle } from '../../design/EditableTitle'
import { CONTROL_CLASS, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { Switch } from '../../design/Switch'
import { ADICIONAR_CLASS, NOTAS_CLASS, TituloBloco } from '../funil/ContatoFicha'
import { dataHora, dataLonga, type PickerItem } from '../funil/funilFormat'
import { useFunil } from '../funil/funilStore'
import { CANCELAR_CLASS } from '../funil/KanbanCard'
import { SearchPicker } from '../funil/SearchPicker'
import { FUNIL_LINK_CLASS } from '../funil/Timeline'
import { CaixaFeito } from './TarefaLinha'
import { diaEHora, textoEvento, textoLembrete, textoOrigem } from './tarefasFormat'
import { useTarefas } from './tarefasStore'

const DIA_MS = 86_400_000
/** Reuniões que "Vincular reunião" oferece (D18). */
const VINCULAR_DIAS = 60

const timeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** O `Select` do detalhe: 32 px, como o `Select` de `design/Field.tsx`, com a largura de quem usa. */
const SELECT_CLASS = `${CONTROL_CLASS} w-[240px] min-w-0 px-2.5`
/** "Abrir", "Abrir e-mail" e "Abrir conversa": texto discreto à direita do vínculo (artboard 04). */
const ABRIR_CLASS =
  'no-drag inline-flex h-7 shrink-0 items-center rounded-[var(--radius-control)] px-2 text-12 text-text-muted transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

const STATUS_ROTULO: Record<Tarefa['status'], string> = { aberta: 'Aberta', feita: 'Feita', cancelada: 'Cancelada' }

const EVENTO_ICONE: Record<EventoTarefaTipo, LucideIcon> = {
  criada: Plus,
  prazo: CalendarDays,
  lembrete: Bell,
  feita: Check,
  reaberta: RotateCcw,
  cancelada: CircleX,
  vinculo: LinkIcon,
  responsavel: User,
}

/** Uma linha de campo do detalhe (artboard 04): o rótulo de 96 px à esquerda e o controle à direita, fio embaixo. */
function Linha({ nome, rotulo, rotuloId, children }: { nome: string; rotulo: string; rotuloId?: string | undefined; children: ReactNode }) {
  return (
    <div data-tarefa-linha={nome} className="flex min-h-10 items-start gap-2 border-b border-line py-1">
      <span id={rotuloId} className="w-24 shrink-0 pt-2 text-12 text-text-muted">
        {rotulo}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

/**
 * Uma linha de vínculo (artboard 04): ícone, o nome do vínculo em 96 px, o valor e a ação à direita. Com `campo` (o valor é
 * um campo de 32 px), o rótulo fica centrado na altura do campo (contrato 130, M4).
 */
function Vinculo({ nome, icone, rotulo, children, acao, campo = false }: { nome: string; icone: LucideIcon; rotulo: string; children: ReactNode; acao?: ReactNode; campo?: boolean }) {
  return (
    <div data-tarefa-vinculo={nome} className="flex min-h-8 items-start gap-2 border-b border-line py-1 text-13">
      <span data-tarefa-vinculo-rotulo className={`flex w-[120px] shrink-0 items-center gap-2 text-12 text-text-muted ${campo ? 'h-8' : 'pt-1'}`}>
        <Icon icon={icone} className="shrink-0" />
        {rotulo}
      </span>
      <div className={`flex min-w-0 flex-1 flex-col gap-1 ${campo ? '' : 'pt-0.5'}`}>{children}</div>
      {acao}
    </div>
  )
}

type ModoLembrete = 'nenhum' | 'padrao' | 'em'

/** O modo do lembrete gravado: sem aviso, o padrão do prazo (igual ao calculado, D-6) ou um momento escolhido. */
function modoDoLembrete(tarefa: Pick<Tarefa, 'lembreteEm' | 'prazo'>, hora: string): ModoLembrete {
  if (tarefa.lembreteEm === null) return 'nenhum'
  return tarefa.prazo !== null && tarefa.lembreteEm === lembretePadrao(tarefa.prazo, hora, timeZone()) ? 'padrao' : 'em'
}

/** O dia de amanhã, `AAAA-MM-DD`, a partir do "hoje" da view. */
function amanhaDe(hoje: string): string {
  return new Date(Date.parse(`${hoje}T00:00:00Z`) + DIA_MS).toISOString().slice(0, 10)
}

/**
 * Detalhe ao lado (contrato 123, R5, R8, artboard 04): a caixa de feito e o título editável, o estado e a criação, as
 * ações Concluir/Reabrir, Cancelar e Apagar (com confirmação na linha), os campos que gravam ao sair (Prazo, Lembrete,
 * Responsável, Importante, Detalhe), os Vínculos (oportunidade e contatos pelo `SearchPicker` do funil, a reunião pela
 * lista própria dos últimos 60 dias, e-mail e conversa só com "Abrir") e o Histórico, o mais recente primeiro.
 */
export function TarefaDetalhe({ tarefa, view, onApagada }: { tarefa: Tarefa; view: TarefasView; onApagada: () => void }) {
  const navigate = useNavigate()
  const ids = useId()
  const funil = useFunil((state) => state.view)
  const hora = useSettings((state) => state.settings.tarefas.horaLembrete)
  const { id } = tarefa
  const [erro, setErro] = useState<string | null>(null)
  const [apagando, setApagando] = useState(false)
  const [ocupado, setOcupado] = useState(false)

  /** Grava só o que mudou; o erro vai para a nota do topo. */
  const salvar = async (campos: Omit<TarefaSalvar, 'id'>): Promise<void> => {
    setErro(null)
    const result = await useTarefas.getState().salvar({ id, ...campos })
    if (!result.ok) setErro(result.mensagem)
  }

  const mudarStatus = async (status: Tarefa['status']): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useTarefas.getState().status(id, status)
    setOcupado(false)
    if (!result.ok) setErro(result.mensagem)
  }

  const apagar = async (): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    setErro(null)
    const result = await useTarefas.getState().apagar(id)
    setOcupado(false)
    if (result.ok) onApagada()
    else setErro(result.mensagem)
  }

  // ---- Prazo
  const [prazo, setPrazo] = useState(tarefa.prazo ?? '')
  const [prazoGravado, setPrazoGravado] = useState(tarefa.prazo)
  if (tarefa.prazo !== prazoGravado) {
    setPrazoGravado(tarefa.prazo)
    setPrazo(tarefa.prazo ?? '')
  }
  const salvarPrazo = (): void => {
    const novo = /^\d{4}-\d{2}-\d{2}$/.test(prazo) ? prazo : null
    if (novo !== tarefa.prazo) void salvar({ prazo: novo })
  }

  // ---- Lembrete
  const modoGravado = modoDoLembrete(tarefa, hora)
  const [modoEscolhido, setModoEscolhido] = useState<ModoLembrete | null>(null)
  const modo = modoEscolhido ?? modoGravado
  const inicioEm = (): { dia: string; hora: string } => (tarefa.lembreteEm !== null ? diaEHora(tarefa.lembreteEm, timeZone()) : { dia: tarefa.prazo ?? amanhaDe(view.hoje), hora })
  const [em, setEm] = useState(inicioEm)
  const [lembreteGravado, setLembreteGravado] = useState(tarefa.lembreteEm)
  if (tarefa.lembreteEm !== lembreteGravado) {
    setLembreteGravado(tarefa.lembreteEm)
    setModoEscolhido(null)
    if (tarefa.lembreteEm !== null) setEm(diaEHora(tarefa.lembreteEm, timeZone()))
  }
  const escolherLembrete = (valor: ModoLembrete): void => {
    if (valor === 'em') {
      setModoEscolhido('em')
      setEm(inicioEm())
      return
    }
    setModoEscolhido(null)
    void salvar({ lembrete: valor })
  }
  const salvarEm = (): void => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(em.dia) || !/^\d{2}:\d{2}$/.test(em.hora)) return
    const at = new Date(`${em.dia}T${em.hora}:00`).getTime()
    if (Number.isFinite(at) && at !== tarefa.lembreteEm) void salvar({ lembrete: at })
  }
  const avisoEfetivo = textoLembrete(tarefa.lembreteEm, tarefa.lembreteDisparadoEm, view.hoje, timeZone())

  // ---- Responsável
  const [modoResp, setModoResp] = useState<ResponsavelTarefa['tipo'] | null>(null)
  const tipoResp = modoResp ?? tarefa.responsavel.tipo
  const [nomeResp, setNomeResp] = useState(tarefa.responsavel.tipo === 'nome' ? tarefa.responsavel.nome : '')
  // Comparado pelo conteúdo: cada view nova traz objetos novos, e a escolha ainda não gravada ("Contato…") fica.
  const respChave = JSON.stringify(tarefa.responsavel)
  const [respGravado, setRespGravado] = useState(respChave)
  if (respChave !== respGravado) {
    setRespGravado(respChave)
    setModoResp(null)
    setNomeResp(tarefa.responsavel.tipo === 'nome' ? tarefa.responsavel.nome : '')
  }
  const escolherResponsavel = (valor: ResponsavelTarefa['tipo']): void => {
    if (valor === 'eu') {
      setModoResp(null)
      if (tarefa.responsavel.tipo !== 'eu') void salvar({ responsavel: { tipo: 'eu' } })
      return
    }
    setModoResp(valor)
  }
  const salvarNome = (): void => {
    const nome = nomeResp.trim()
    if (nome && !(tarefa.responsavel.tipo === 'nome' && tarefa.responsavel.nome === nome)) void salvar({ responsavel: { tipo: 'nome', nome } })
  }

  // ---- Detalhe
  const [detalhe, setDetalhe] = useState(tarefa.detalhe)
  const [detalheGravado, setDetalheGravado] = useState(tarefa.detalhe)
  if (tarefa.detalhe !== detalheGravado) {
    setDetalheGravado(tarefa.detalhe)
    setDetalhe(tarefa.detalhe)
  }

  // ---- Vínculos
  const contatos = (funil?.state.contatos ?? []).filter((contato) => !contato.arquivado)
  const nomeContato = (contatoId: string): string => view.nomes.contatos[contatoId] ?? contatos.find((contato) => contato.id === contatoId)?.nome ?? 'Contato'
  const pessoas: PickerItem[] = contatos.map((contato) => ({ id: contato.id, nome: contato.nome, detalhe: contato.emails[0] }))
  const etapas = new Map((funil?.state.etapas ?? []).map((etapa) => [etapa.id, etapa]))
  const oportunidades: PickerItem[] = (funil?.state.oportunidades ?? []).filter((item) => !item.arquivado).map((item) => ({ id: item.id, nome: item.titulo, detalhe: etapas.get(item.etapaId)?.nome }))
  const opId = tarefa.vinculos.oportunidadeId
  const oportunidade = opId ? (funil?.state.oportunidades.find((item) => item.id === opId) ?? null) : null
  const opValor: PickerItem | null = opId ? { id: opId, nome: view.nomes.oportunidades[opId] ?? oportunidade?.titulo ?? 'Oportunidade' } : null
  const contatosValor: PickerItem[] = tarefa.vinculos.contatoIds.map((contatoId) => ({ id: contatoId, nome: nomeContato(contatoId) }))
  const respContato: PickerItem | null = tarefa.responsavel.tipo === 'contato' ? { id: tarefa.responsavel.contatoId, nome: nomeContato(tarefa.responsavel.contatoId) } : null

  const [vincular, setVincular] = useState(false)
  const [busca, setBusca] = useState('')
  const [reunioes, setReunioes] = useState<Meeting[] | null>(null)
  const [listaFalhou, setListaFalhou] = useState(false)
  useEffect(() => {
    if (!vincular) return
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
  }, [vincular])
  const [agora] = useState(() => Date.now())
  const termo = semAcento(busca).toLowerCase().trim()
  const reunioesRecentes = (reunioes ?? [])
    .filter((meeting) => Date.parse(meeting.startedAt) >= agora - VINCULAR_DIAS * DIA_MS)
    .filter((meeting) => !termo || semAcento(meeting.title).toLowerCase().includes(termo))
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
  const meetingId = tarefa.vinculos.meetingId
  const nomeReuniao = meetingId ? (view.nomes.reunioes[meetingId] ?? reunioes?.find((meeting) => meeting.id === meetingId)?.title ?? 'Reunião') : null

  const abrirEmail = (): void => {
    const email = tarefa.vinculos.email
    if (!email) return
    // A7: com a pasta do servidor, abre nela (a tela trata a pasta que não existe mais); sem ela, a Caixa de Entrada.
    if (email.mailbox === null) {
      const state: EmailNavigationState = { messageId: email.id }
      void navigate(emailPath(email.accountId, 'inbox'), { state })
    } else {
      const state: EmailNavigationState = { messageId: email.id, mailbox: email.mailbox }
      void navigate(emailPath(email.accountId, { path: email.mailbox }), { state })
    }
  }
  const chatId = tarefa.vinculos.whatsappChatId
  const abrirConversa = (): void => {
    if (!chatId) return
    const state: WhatsAppNavigationState = { chatId }
    void navigate(ROUTE_PATHS.whatsapp, { state })
  }

  const origem = textoOrigem(tarefa, view.nomes)
  const aberta = tarefa.status === 'aberta'
  const historico = [...tarefa.historico].reverse()

  return (
    <div data-tarefa-detalhe={id} data-tarefa-detalhe-status={tarefa.status} className="flex max-w-[760px] flex-col">
      <div className="flex min-w-0 items-center gap-2.5">
        <CaixaFeito tarefa={tarefa} data={{ 'data-tarefa-detalhe-feito': '' }} onErro={setErro} />
        <div className="min-w-0 flex-1">
          <EditableTitle value={tarefa.titulo} label="Título da tarefa" maxLength={TAREFA_TITULO_MAX} onCommit={(titulo) => void salvar({ titulo })} />
        </div>
      </div>
      <p data-tarefa-detalhe-subtitulo className="mt-0.5 pl-[26px] text-12 text-text-muted tabular">
        {STATUS_ROTULO[tarefa.status]} · criada em {dataLonga(tarefa.criadaEm)} · {origem.texto}
      </p>
      <div data-tarefa-acoes className="mt-2.5 flex flex-wrap items-center gap-2 pl-[26px]">
        {aberta ? (
          <>
            <ActionButton icon={Check} label="Concluir" action="tarefa-concluir" disabled={ocupado} onClick={() => void mudarStatus('feita')} />
            <ActionButton icon={CircleX} label="Cancelar" action="tarefa-cancelar" disabled={ocupado} onClick={() => void mudarStatus('cancelada')} />
          </>
        ) : (
          <ActionButton icon={RotateCcw} label="Reabrir" action="tarefa-reabrir" disabled={ocupado} onClick={() => void mudarStatus('aberta')} />
        )}
        {apagando ? (
          <span data-tarefa-apagar-confirmacao className="flex flex-wrap items-center gap-2" role="group" aria-label="Confirmar a exclusão">
            <span className="text-13 text-text">Apagar a tarefa? Não dá para desfazer.</span>
            <ActionButton icon={X} label="Cancelar" action="tarefa-apagar-cancelar" onClick={() => setApagando(false)} />
            <ActionButton icon={Trash2} label="Apagar" tone="danger" action="tarefa-apagar-confirmar" disabled={ocupado} onClick={() => void apagar()} />
          </span>
        ) : (
          <ActionButton icon={Trash2} label="Apagar" tone="danger" action="tarefa-apagar" onClick={() => setApagando(true)} />
        )}
      </div>
      {erro && (
        <Note
          id="tarefa-detalhe-erro"
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

      <div className="mt-3 flex flex-col">
        <Linha nome="prazo" rotulo="Prazo" rotuloId={`${ids}-prazo`}>
          <input
            type="date"
            data-tarefa-campo="prazo"
            aria-labelledby={`${ids}-prazo`}
            value={prazo}
            onChange={(event) => setPrazo(event.target.value)}
            onBlur={salvarPrazo}
            className={`${CONTROL_CLASS} w-[160px] min-w-0 px-2 select-text`}
          />
        </Linha>
        <Linha nome="lembrete" rotulo="Lembrete" rotuloId={`${ids}-lembrete`}>
          <select data-tarefa-campo="lembrete" aria-labelledby={`${ids}-lembrete`} value={modo} onChange={(event) => escolherLembrete(event.target.value as ModoLembrete)} className={SELECT_CLASS}>
            <option value="nenhum">Sem aviso</option>
            <option value="padrao" disabled={tarefa.prazo === null}>
              No prazo às {hora}
            </option>
            <option value="em">Em…</option>
          </select>
          {modo === 'em' && (
            <>
              <input
                type="date"
                data-tarefa-campo="lembrete-dia"
                aria-label="Dia do aviso"
                value={em.dia}
                onChange={(event) => setEm({ ...em, dia: event.target.value })}
                onBlur={salvarEm}
                className={`${CONTROL_CLASS} w-[140px] min-w-0 px-2 select-text`}
              />
              <input
                type="time"
                data-tarefa-campo="lembrete-hora"
                aria-label="Hora do aviso"
                value={em.hora}
                onChange={(event) => setEm({ ...em, hora: event.target.value })}
                onBlur={salvarEm}
                className={`${CONTROL_CLASS} w-[96px] min-w-0 px-2 select-text`}
              />
            </>
          )}
          {avisoEfetivo && (
            <span data-tarefa-lembrete-texto className="text-12 text-text-muted tabular">
              {avisoEfetivo}
            </span>
          )}
        </Linha>
        <Linha nome="responsavel" rotulo="Responsável" rotuloId={`${ids}-responsavel`}>
          <select data-tarefa-campo="responsavel" aria-labelledby={`${ids}-responsavel`} value={tipoResp} onChange={(event) => escolherResponsavel(event.target.value as ResponsavelTarefa['tipo'])} className={SELECT_CLASS}>
            <option value="eu">Eu</option>
            <option value="contato">Contato…</option>
            <option value="nome">Outra pessoa…</option>
          </select>
          {tipoResp === 'contato' && (
            <div className="w-[240px]">
              <SearchPicker
                nome="tarefa-responsavel"
                label="Contato responsável"
                placeholder="Buscar contato"
                itens={pessoas}
                valor={respContato}
                onChange={(item) => item && item.id !== respContato?.id && void salvar({ responsavel: { tipo: 'contato', contatoId: item.id } })}
              />
            </div>
          )}
          {tipoResp === 'nome' && (
            <div className="flex w-[240px]">
              <TextField value={nomeResp} onChange={setNomeResp} onBlur={salvarNome} onEnter={salvarNome} ariaLabel="Nome de quem faz" placeholder="Nome de quem faz" maxLength={TAREFA_TITULO_MAX} data={{ 'data-tarefa-campo': 'responsavel-nome' }} />
            </div>
          )}
        </Linha>
        <Linha nome="importante" rotulo="Importante" rotuloId={`${ids}-importante`}>
          <span className="flex h-8 items-center">
            <Switch checked={tarefa.importante} labelledBy={`${ids}-importante`} action="tarefa-importante" onChange={(importante) => void salvar({ importante })} />
          </span>
        </Linha>
        <Linha nome="detalhe" rotulo="Detalhe" rotuloId={`${ids}-detalhe`}>
          <textarea
            data-tarefa-campo="detalhe"
            aria-labelledby={`${ids}-detalhe`}
            rows={2}
            value={detalhe}
            maxLength={TAREFA_DETALHE_MAX}
            onChange={(event) => setDetalhe(event.target.value)}
            onBlur={() => detalhe !== tarefa.detalhe && void salvar({ detalhe })}
            className={NOTAS_CLASS}
          />
        </Linha>
      </div>

      <section aria-label="Vínculos" data-tarefa-vinculos>
        <TituloBloco>Vínculos</TituloBloco>
        <Vinculo
          nome="oportunidade"
          icone={Funnel}
          rotulo="Oportunidade"
          campo
          acao={
            opId && oportunidade ? (
              <button type="button" data-action="tarefa-abrir-oportunidade" className={ABRIR_CLASS} onClick={() => void navigate(funilPath('oportunidades', opId))}>
                Abrir
              </button>
            ) : undefined
          }
        >
          <div className="w-full max-w-[280px]">
            <SearchPicker
              nome="tarefa-oportunidade"
              label="Oportunidade"
              placeholder="Escolher oportunidade"
              itens={oportunidades}
              valor={opValor}
              onChange={(item) => (item?.id ?? null) !== opId && void salvar({ vinculos: { oportunidadeId: item?.id ?? null } })}
            />
          </div>
        </Vinculo>
        <Vinculo nome="contatos" icone={Users} rotulo="Contatos" campo>
          <div className="w-full max-w-[400px]">
            <SearchPicker nome="tarefa-contatos" label="Contatos" placeholder="Contato" multiplo itens={pessoas} valor={contatosValor} onChange={(itens) => void salvar({ vinculos: { contatoIds: itens.map((item) => item.id) } })} />
          </div>
        </Vinculo>
        <Vinculo
          nome="reuniao"
          icone={NotebookText}
          rotulo="Reunião"
          acao={
            meetingId ? (
              <button type="button" data-action="tarefa-desvincular-reuniao" className={ABRIR_CLASS} onClick={() => void salvar({ vinculos: { meetingId: null } })}>
                Desvincular
              </button>
            ) : undefined
          }
        >
          {meetingId ? (
            <span className="min-w-0 truncate pt-0.5">
              <button type="button" className={FUNIL_LINK_CLASS} onClick={() => void navigate(meetingPath(meetingId))}>
                {nomeReuniao}
              </button>
            </span>
          ) : vincular ? (
            <div data-tarefa-vincular-reuniao className="flex max-w-[480px] flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <TextField value={busca} onChange={setBusca} ariaLabel="Buscar reuniões dos últimos 60 dias" placeholder="Buscar reuniões dos últimos 60 dias" maxLength={200} data={{ 'data-tarefa-vincular-busca': '' }} />
                <button type="button" data-action="tarefa-vincular-fechar" onClick={() => setVincular(false)} className={CANCELAR_CLASS}>
                  Fechar
                </button>
              </div>
              {reunioes === null ? null : listaFalhou ? (
                <p className="px-1 py-1 text-13 text-text-muted">Não foi possível ler a lista de reuniões. Feche e abra de novo.</p>
              ) : reunioesRecentes.length === 0 ? (
                <p className="px-1 py-1 text-13 text-text-muted">{termo ? 'Nenhuma reunião com esse título.' : 'Nenhuma reunião nos últimos 60 dias.'}</p>
              ) : (
                <ul className="flex max-h-[200px] flex-col overflow-y-auto">
                  {reunioesRecentes.map((meeting) => (
                    <li key={meeting.id}>
                      <button
                        type="button"
                        data-tarefa-vincular-opcao={meeting.id}
                        onClick={() => {
                          setVincular(false)
                          void salvar({ vinculos: { meetingId: meeting.id } })
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
            </div>
          ) : (
            <button
              type="button"
              data-action="tarefa-vincular-reuniao"
              onClick={() => {
                setBusca('')
                setVincular(true)
              }}
              className={`${ADICIONAR_CLASS} -ml-1`}
            >
              <Icon icon={LinkIcon} size={14} />
              Vincular reunião
            </button>
          )}
        </Vinculo>
        {tarefa.vinculos.email && (
          <Vinculo
            nome="email"
            icone={Mail}
            rotulo="E-mail"
            acao={
              <button type="button" data-action="tarefa-abrir-email" className={ABRIR_CLASS} onClick={abrirEmail}>
                Abrir e-mail
              </button>
            }
          >
            <span className="truncate pt-0.5 text-text">{tarefa.vinculos.email.assunto || '(sem assunto)'}</span>
          </Vinculo>
        )}
        {chatId && (
          <Vinculo
            nome="whatsapp"
            icone={Smartphone}
            rotulo="WhatsApp"
            acao={
              <button type="button" data-action="tarefa-abrir-conversa" className={ABRIR_CLASS} onClick={abrirConversa}>
                Abrir conversa
              </button>
            }
          >
            <span className="truncate pt-0.5 text-text">{view.nomes.whatsapp[chatId] ?? 'Conversa'}</span>
          </Vinculo>
        )}
      </section>

      <section aria-label="Histórico">
        <TituloBloco>Histórico</TituloBloco>
        <ol data-tarefa-historico className="flex flex-col">
          {historico.map((evento, index) => (
            <li key={`${evento.em}:${index}`} data-tarefa-evento={evento.tipo} className="flex h-8 items-center gap-2 border-b border-line text-12">
              <Icon icon={EVENTO_ICONE[evento.tipo]} className="shrink-0 text-text-muted" />
              <span className="min-w-0 flex-1 truncate text-text">{textoEvento(evento)}</span>
              <time className="shrink-0 whitespace-nowrap text-text-faint tabular">{dataHora(evento.em)}</time>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}
