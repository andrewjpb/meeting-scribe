// Linha do tempo do funil (contrato 110, R8 a R10 e R29): reuniões, e-mails e conversas do WhatsApp ligados a um
// contato ou a uma oportunidade, mais o histórico da oportunidade, e a última interação (R7) de cada oportunidade
// para o `FunilView`. Módulo puro: recebe o que o serviço leu dos caches (reuniões, e-mail, WhatsApp) e devolve a
// lista; o resumo da reunião (`resumo`) o serviço preenche depois, só para as reuniões da lista. Contrato 124 (R18): as
// tarefas entram como itens `tarefa` (na oportunidade pelos eventos `tarefa`, no contato pelos vínculos), com a origem
// resumida pelos nomes das reuniões e das conversas que já vêm nas fontes.
import type { Contato, EventoFunil, FunilState, ItemLinhaDoTempo, Oportunidade } from './funil'
import { chaveTelefone, normalizarEmail, normalizarTelefone, ultimaInteracao } from './funil-logic'
import { telefoneDoChat } from './funil-sugestoes'
import type { Tarefa } from './tarefas'

const DIA_MS = 86_400_000
/** A oportunidade mostra os e-mails dos contatos a partir de `criadoEm` menos estes dias (R9). */
export const TIMELINE_EMAILS_ANTES_DIAS = 30
export const REUNIAO_APAGADA_TITULO = 'Reunião apagada'

export interface ReuniaoFonte {
  id: string
  title: string
  startedAt: string
  calendar?: { attendees: readonly { name: string; email: string }[] } | null | undefined
}

export interface EmailFonte {
  id: string
  accountId: string
  mailbox: string
  subject: string
  from: readonly { name: string | null; address: string }[]
  to: readonly { name: string | null; address: string }[]
  cc: readonly { name: string | null; address: string }[]
  date: number
}

export interface ChatFonte {
  id: string
  name: string
  phone?: string | undefined
  lastMessage: { at: number; text: string } | null
}

/** O que os caches têm agora: reuniões, mensagens de e-mail (INBOX e enviados) e conversas do WhatsApp. */
export interface FontesTimeline {
  reunioes: readonly ReuniaoFonte[]
  emails: readonly EmailFonte[]
  /** Endereços das contas do usuário: nunca ligam um e-mail a um contato (R9). */
  contasEmail: readonly string[]
  whatsapp: readonly ChatFonte[]
}

/** Contrato 124: as tarefas do arquivo (o serviço lê pelo serviço das tarefas); ausente vale nenhuma. */
export interface TarefasTimeline {
  tarefas?: readonly Tarefa[] | undefined
}

export interface TimelineResultado {
  itens: ItemLinhaDoTempo[]
  ultimaInteracao: number | null
  whatsappChatIds: string[]
}

const chaveEmail = (accountId: string, id: string): string => `${accountId}\n${id}`

/** Índices das fontes, montados uma vez por pedido (o `FunilView` cruza todas as oportunidades com eles). */
interface Indice {
  contas: Set<string>
  reunioesPorId: Map<string, ReuniaoFonte>
  reunioesPorEmail: Map<string, ReuniaoFonte[]>
  emailsPorId: Map<string, EmailFonte>
  emailsPorEndereco: Map<string, EmailFonte[]>
  chatsPorId: Map<string, ChatFonte>
  chatsPorTelefone: Map<string, ChatFonte[]>
}

function acrescentar<T>(mapa: Map<string, T[]>, chave: string, item: T): void {
  const lista = mapa.get(chave)
  if (!lista) mapa.set(chave, [item])
  else if (!lista.includes(item)) lista.push(item)
}

function indexar(fontes: FontesTimeline): Indice {
  const indice: Indice = {
    contas: new Set(fontes.contasEmail.map((conta) => normalizarEmail(conta)).filter((conta) => conta !== null)),
    reunioesPorId: new Map(),
    reunioesPorEmail: new Map(),
    emailsPorId: new Map(),
    emailsPorEndereco: new Map(),
    chatsPorId: new Map(),
    chatsPorTelefone: new Map(),
  }
  for (const reuniao of fontes.reunioes) {
    indice.reunioesPorId.set(reuniao.id, reuniao)
    for (const participante of reuniao.calendar?.attendees ?? []) {
      const email = normalizarEmail(participante.email)
      if (email !== null) acrescentar(indice.reunioesPorEmail, email, reuniao)
    }
  }
  for (const mensagem of fontes.emails) {
    indice.emailsPorId.set(chaveEmail(mensagem.accountId, mensagem.id), mensagem)
    for (const endereco of [...mensagem.from, ...mensagem.to, ...mensagem.cc]) {
      const email = normalizarEmail(endereco.address)
      if (email !== null) acrescentar(indice.emailsPorEndereco, email, mensagem)
    }
  }
  for (const chat of fontes.whatsapp) {
    indice.chatsPorId.set(chat.id, chat)
    const telefone = telefoneDoChat(chat)
    if (telefone !== null) acrescentar(indice.chatsPorTelefone, chaveTelefone(telefone), chat)
  }
  return indice
}

interface Ligados {
  /** Ids na ordem: as reuniões pelos participantes e depois as vinculadas (que podem não existir mais). */
  meetingIds: string[]
  emails: EmailFonte[]
  chats: ChatFonte[]
  whatsappChatIds: string[]
}

/**
 * Reuniões (R8), e-mails (R9) e conversas (R10) dos contatos, mais os vínculos explícitos da oportunidade. `desde`
 * corta os e-mails derivados pela data (a oportunidade, R9); o contato vê todos.
 */
function ligados(indice: Indice, contatos: readonly Contato[], extras: { meetingIds: readonly string[]; whatsappChatIds: readonly string[]; desde: number | null }): Ligados {
  const emails = new Set(contatos.flatMap((contato) => contato.emails.map((email) => normalizarEmail(email))).filter((email): email is string => email !== null && !indice.contas.has(email)))
  const meetingIds = new Set<string>()
  const mensagens = new Set<EmailFonte>()
  for (const email of emails) {
    for (const reuniao of indice.reunioesPorEmail.get(email) ?? []) meetingIds.add(reuniao.id)
    for (const mensagem of indice.emailsPorEndereco.get(email) ?? []) if (extras.desde === null || mensagem.date >= extras.desde) mensagens.add(mensagem)
  }
  for (const id of extras.meetingIds) meetingIds.add(id)

  const chatIds = new Set<string>()
  for (const contato of contatos) {
    if (contato.whatsappChatId) chatIds.add(contato.whatsappChatId)
    for (const telefone of contato.telefones) {
      const normalizado = normalizarTelefone(telefone)
      if (normalizado !== null) for (const chat of indice.chatsPorTelefone.get(chaveTelefone(normalizado)) ?? []) chatIds.add(chat.id)
    }
  }
  for (const id of extras.whatsappChatIds) chatIds.add(id)
  const chats = [...chatIds].map((id) => indice.chatsPorId.get(id)).filter((chat) => chat !== undefined)
  return { meetingIds: [...meetingIds], emails: [...mensagens], chats, whatsappChatIds: [...chatIds] }
}

const nomeDe = (endereco: { name: string | null; address: string }): string => endereco.name?.trim() || endereco.address

function itemEmail(mensagem: EmailFonte): ItemLinhaDoTempo {
  return {
    tipo: 'email',
    at: mensagem.date,
    accountId: mensagem.accountId,
    messageId: mensagem.id,
    mailbox: mensagem.mailbox,
    assunto: mensagem.subject,
    de: mensagem.from.map(nomeDe).join(', '),
    para: mensagem.to.map(nomeDe).join(', '),
    noCache: false,
  }
}

function itensBase(indice: Indice, ligacoes: Ligados): ItemLinhaDoTempo[] {
  const itens: ItemLinhaDoTempo[] = []
  for (const id of ligacoes.meetingIds) {
    const reuniao = indice.reunioesPorId.get(id)
    if (!reuniao) itens.push({ tipo: 'reuniao', at: null, meetingId: id, titulo: REUNIAO_APAGADA_TITULO, resumo: null, apagada: true })
    else {
      const at = Date.parse(reuniao.startedAt)
      itens.push({ tipo: 'reuniao', at: Number.isFinite(at) ? at : null, meetingId: id, titulo: reuniao.title, resumo: null, apagada: false })
    }
  }
  for (const mensagem of ligacoes.emails) itens.push(itemEmail(mensagem))
  for (const chat of ligacoes.chats) {
    if (chat.lastMessage) itens.push({ tipo: 'whatsapp', at: chat.lastMessage.at, chatId: chat.id, nome: chat.name, ultimaMensagem: chat.lastMessage.text })
  }
  return itens
}

/** Data decrescente; sem data (a reunião apagada) no fim, na ordem em que entrou. */
function ordenar(itens: ItemLinhaDoTempo[]): ItemLinhaDoTempo[] {
  return itens
    .map((item, posicao) => ({ item, posicao }))
    .sort((a, b) => {
      if (a.item.at === null || b.item.at === null) return a.item.at === b.item.at ? a.posicao - b.posicao : a.item.at === null ? 1 : -1
      return b.item.at - a.item.at || a.posicao - b.posicao
    })
    .map(({ item }) => item)
}

function maiorData(itens: readonly ItemLinhaDoTempo[]): number | null {
  let maior: number | null = null
  for (const item of itens) if (item.at !== null && (maior === null || item.at > maior)) maior = item.at
  return maior
}

/**
 * Origem da tarefa em pt-BR (R18), com o título da reunião e o nome da conversa das fontes; reunião ou conversa que
 * não está mais nelas fica sem o nome.
 */
export function origemResumida(tarefa: Pick<Tarefa, 'origem'>, fontes: Pick<FontesTimeline, 'reunioes' | 'whatsapp'>): string {
  const { origem } = tarefa
  switch (origem.tipo) {
    case 'manual':
      return 'criada por você'
    case 'reuniao': {
      const titulo = fontes.reunioes.find((reuniao) => reuniao.id === origem.meetingId)?.title
      return titulo ? `da reunião ${titulo}` : 'de uma reunião'
    }
    case 'whatsapp': {
      const nome = fontes.whatsapp.find((chat) => chat.id === origem.chatId)?.name
      return nome ? `da conversa com ${nome}` : 'de uma conversa do WhatsApp'
    }
    case 'email':
      return origem.assunto ? `do e-mail ${origem.assunto}` : 'de um e-mail'
    case 'assistente':
      return 'pelo Assistente'
    case 'automacao':
      return 'por um agente'
    case 'funil':
      return 'da oportunidade'
    case 'migracao':
      return origem.de === 'proximo-passo' ? 'do próximo passo antigo' : 'de um lembrete antigo'
  }
}

/** Item `tarefa` de uma tarefa que existe. */
function itemTarefa(tarefa: Tarefa, at: number, acao: 'criada' | 'feita', fontes: FontesTimeline): ItemLinhaDoTempo {
  return { tipo: 'tarefa', at, tarefaId: tarefa.id, titulo: tarefa.titulo, prazo: tarefa.prazo, origem: origemResumida(tarefa, fontes), acao, existe: true }
}

/**
 * Linha do tempo de um contato: reuniões em que ele participou, e-mails com ele e as conversas dele (R8 a R10).
 * Contrato 124 (R18): as tarefas com o contato nos vínculos, criada e (fechada como feita) feita. A última interação
 * continua só com reuniões, e-mails e conversas.
 */
export function timelineDoContato(input: FontesTimeline & TarefasTimeline & { contato: Contato }): TimelineResultado {
  const indice = indexar(input)
  const ligacoes = ligados(indice, [input.contato], { meetingIds: [], whatsappChatIds: [], desde: null })
  const base = itensBase(indice, ligacoes)
  const ultima = maiorData(base)
  for (const tarefa of input.tarefas ?? []) {
    if (!tarefa.vinculos.contatoIds.includes(input.contato.id)) continue
    base.push(itemTarefa(tarefa, tarefa.criadaEm, 'criada', input))
    if (tarefa.status === 'feita' && tarefa.feitaEm !== null) base.push(itemTarefa(tarefa, tarefa.feitaEm, 'feita', input))
  }
  return { itens: ordenar(base), ultimaInteracao: ultima, whatsappChatIds: ligacoes.whatsappChatIds }
}

/** Quando os e-mails derivados da oportunidade começam (R9). */
const inicioEmails = (oportunidade: Oportunidade): number => oportunidade.criadoEm - TIMELINE_EMAILS_ANTES_DIAS * DIA_MS

/** R7: os e-mails vinculados contam pela `data` guardada mesmo fora do cache (o `ultimaInteracao` do 107 soma `oportunidade.emails`). */
function ultimaDe(indice: Indice, oportunidade: Oportunidade, ligacoes: Ligados): number {
  const explicitos = oportunidade.emails.map((email) => indice.emailsPorId.get(chaveEmail(email.accountId, email.id))).filter((mensagem) => mensagem !== undefined)
  return ultimaInteracao({
    oportunidade,
    reunioes: ligacoes.meetingIds.map((id) => indice.reunioesPorId.get(id)).filter((reuniao) => reuniao !== undefined),
    emails: [...ligacoes.emails, ...explicitos],
    whatsapp: ligacoes.chats.flatMap((chat) => (chat.lastMessage ? [{ at: chat.lastMessage.at }] : [])),
  })
}

/**
 * Linha do tempo de uma oportunidade (R9, R29): o que é dos contatos dela (e-mails a partir de `criadoEm` menos 30
 * dias), as reuniões vinculadas (a que não existe mais vira "Reunião apagada"), os e-mails vinculados (o que saiu
 * do cache aparece pelo resumo guardado, com `noCache`), as conversas vinculadas e o histórico dela.
 */
export function timelineDaOportunidade(input: FontesTimeline & TarefasTimeline & { oportunidade: Oportunidade; contatos: readonly Contato[]; eventos: readonly EventoFunil[] }): TimelineResultado {
  const { oportunidade } = input
  const indice = indexar(input)
  const contatos = input.contatos.filter((contato) => oportunidade.contatoIds.includes(contato.id))
  const ligacoes = ligados(indice, contatos, { meetingIds: oportunidade.meetingIds, whatsappChatIds: oportunidade.whatsappChatIds, desde: inicioEmails(oportunidade) })
  const itens = itensBase(indice, ligacoes)
  const vistos = new Set(ligacoes.emails.map((mensagem) => chaveEmail(mensagem.accountId, mensagem.id)))
  for (const email of oportunidade.emails) {
    const chave = chaveEmail(email.accountId, email.id)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    const mensagem = indice.emailsPorId.get(chave)
    if (mensagem) itens.push(itemEmail(mensagem))
    else itens.push({ tipo: 'email', at: email.data, accountId: email.accountId, messageId: email.id, mailbox: null, assunto: email.assunto, de: email.de, para: '', noCache: true })
  }
  const tarefas = new Map((input.tarefas ?? []).map((tarefa) => [tarefa.id, tarefa]))
  for (const evento of input.eventos) {
    if (evento.oportunidadeId !== oportunidade.id) continue
    if (evento.tipo !== 'tarefa') {
      itens.push({ tipo: 'evento', at: evento.at, evento })
      continue
    }
    // Contrato 124 (R18): criada e feita viram item `tarefa`; a mudança de prazo fica só no histórico.
    if (!evento.tarefa || evento.tarefa.acao === 'prazo') continue
    const { id, acao } = evento.tarefa
    const tarefa = tarefas.get(id)
    if (tarefa) itens.push(itemTarefa(tarefa, evento.at, acao, input))
    else itens.push({ tipo: 'tarefa', at: evento.at, tarefaId: id, titulo: evento.texto, prazo: null, origem: '', acao, existe: false })
  }
  return { itens: ordenar(itens), ultimaInteracao: ultimaDe(indice, oportunidade, ligacoes), whatsappChatIds: ligacoes.whatsappChatIds }
}

/** Última interação (R7) de cada oportunidade não arquivada, com os índices montados uma vez só. */
export function ultimasInteracoes(input: FontesTimeline & { state: FunilState }): Record<string, number> {
  const indice = indexar(input)
  const contatos = new Map(input.state.contatos.map((contato) => [contato.id, contato]))
  const ultimas: Record<string, number> = {}
  for (const oportunidade of input.state.oportunidades) {
    if (oportunidade.arquivado) continue
    const deles = oportunidade.contatoIds.map((id) => contatos.get(id)).filter((contato) => contato !== undefined)
    const ligacoes = ligados(indice, deles, { meetingIds: oportunidade.meetingIds, whatsappChatIds: oportunidade.whatsappChatIds, desde: inicioEmails(oportunidade) })
    ultimas[oportunidade.id] = ultimaDe(indice, oportunidade, ligacoes)
  }
  return ultimas
}
