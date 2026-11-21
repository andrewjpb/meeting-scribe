// Sugestões de contato do funil (contrato 110, R11 e R12): participantes de reunião, remetentes e destinatários do
// e-mail em cache com 2 ou mais mensagens nos últimos 90 dias e conversas do WhatsApp com uma pessoa nos últimos 90
// dias. A agenda não é fonte. Módulo puro: recebe o que o serviço leu dos caches e devolve a lista, sem gravar nada.
import { phoneOfChatId } from './assistant'
import type { Contato, Ignorado, Sugestao, SugestaoCanal } from './funil'
import { chaveTelefone, mesmoTelefone, normalizarEmail, normalizarTelefone } from './funil-logic'

const DIA_MS = 86_400_000
/** Janela do e-mail e do WhatsApp (R11). */
export const SUGESTOES_JANELA_DIAS = 90
/** Mensagens trocadas na janela para o endereço virar sugestão (R11). */
export const SUGESTOES_EMAILS_MIN = 2

/** Local-part de endereço automático, que nunca vira contato (R11). */
const AUTOMATICO = /noreply|no-reply|nao-responda|newsletter|notification|mailer-daemon|bounce/

/** Ordem de desempate da origem e de exibição dos canais. */
const CANAIS: readonly SugestaoCanal[] = ['reuniao', 'email', 'whatsapp']

export interface SugestoesInput {
  reunioes: readonly { id: string; startedAt: string; attendees: readonly { name: string; email: string }[] }[]
  emails: readonly { date: number; from: readonly EnderecoEmail[]; to: readonly EnderecoEmail[]; cc: readonly EnderecoEmail[] }[]
  /** Endereços das contas de e-mail do usuário. */
  contasEmail: readonly string[]
  whatsapp: readonly { id: string; name: string; kind: 'person' | 'group'; phone?: string | undefined; lastAt: number | null }[]
  /** Número da conta do WhatsApp conectada. */
  meuTelefone: string | null
  contatos: readonly Contato[]
  ignorados: readonly Ignorado[]
  now: number
}

interface EnderecoEmail {
  name: string | null
  address: string
}

/** Uma ocorrência de candidato num canal, antes de agrupar. */
interface Ocorrencia {
  chave: string
  canal: SugestaoCanal
  nome: string
  interacoes: number
  ultimaEm: number
  email: string | null
  telefone: string | null
  whatsappChatId: string | null
}

/** Telefone do chat: o `phone` que o serviço sabe (`@lid`) ou o do id (precedente `chat/actions.ts:439`), por R3. */
export function telefoneDoChat(chat: { id: string; phone?: string | undefined }): string | null {
  const texto = chat.phone ?? phoneOfChatId(chat.id)
  return texto ? normalizarTelefone(texto) : null
}

const localPart = (email: string): string => email.slice(0, email.indexOf('@'))
const dataValida = (at: number): number => (Number.isFinite(at) ? at : 0)

export function sugestoesDeContato(input: SugestoesInput): Sugestao[] {
  const contas = new Set(input.contasEmail.map((conta) => normalizarEmail(conta)).filter((conta) => conta !== null))
  const ignorados = new Set(input.ignorados.map((item) => item.chave))
  const telefonesIgnorados = new Set(input.ignorados.filter((item) => item.chave.startsWith('tel:')).map((item) => chaveDe(item.chave.slice(4))))
  const emailsDeContato = new Set(input.contatos.flatMap((contato) => contato.emails))
  // `mesmoTelefone` é a igualdade das chaves sem o nono dígito: o índice usa a mesma chave.
  const telefonesDeContato = new Set(input.contatos.flatMap((contato) => contato.telefones.map(chaveDe)))
  const chatsDeContato = new Set(input.contatos.map((contato) => contato.whatsappChatId).filter((id) => id !== null))
  const desde = input.now - SUGESTOES_JANELA_DIAS * DIA_MS

  const emailAceito = (email: string): boolean =>
    !contas.has(email) && !AUTOMATICO.test(localPart(email)) && !ignorados.has(`email:${email}`) && !emailsDeContato.has(email)

  const ocorrencias: Ocorrencia[] = []

  // Participantes de reunião, sem janela: uma interação por reunião.
  for (const reuniao of input.reunioes) {
    const vistos = new Set<string>()
    for (const participante of reuniao.attendees) {
      const email = normalizarEmail(participante.email)
      if (email === null || vistos.has(email) || !emailAceito(email)) continue
      vistos.add(email)
      ocorrencias.push({ chave: `email:${email}`, canal: 'reuniao', nome: participante.name.trim(), interacoes: 1, ultimaEm: dataValida(Date.parse(reuniao.startedAt)), email, telefone: null, whatsappChatId: null })
    }
  }

  // E-mail: conta as mensagens da janela em que o endereço aparece; só entra com o mínimo.
  const porEndereco = new Map<string, { nome: string; mensagens: number; ultimaEm: number }>()
  for (const mensagem of input.emails) {
    if (!(mensagem.date >= desde)) continue
    const vistos = new Set<string>()
    for (const endereco of [...mensagem.from, ...mensagem.to, ...mensagem.cc]) {
      const email = normalizarEmail(endereco.address)
      if (email === null || vistos.has(email) || !emailAceito(email)) continue
      vistos.add(email)
      const atual = porEndereco.get(email) ?? { nome: '', mensagens: 0, ultimaEm: 0 }
      atual.mensagens++
      atual.ultimaEm = Math.max(atual.ultimaEm, mensagem.date)
      if (!atual.nome) atual.nome = endereco.name?.trim() ?? ''
      porEndereco.set(email, atual)
    }
  }
  for (const [email, { nome, mensagens, ultimaEm }] of porEndereco) {
    if (mensagens < SUGESTOES_EMAILS_MIN) continue
    ocorrencias.push({ chave: `email:${email}`, canal: 'email', nome, interacoes: mensagens, ultimaEm, email, telefone: null, whatsappChatId: null })
  }

  // WhatsApp: só conversa com uma pessoa e com mensagem na janela; o próprio número fica de fora.
  for (const chat of input.whatsapp) {
    if (chat.kind !== 'person' || chat.lastAt === null || !(chat.lastAt >= desde)) continue
    if (ignorados.has(`wa:${chat.id}`) || chatsDeContato.has(chat.id)) continue
    const telefone = telefoneDoChat(chat)
    if (telefone !== null) {
      if (input.meuTelefone !== null && mesmoTelefone(telefone, input.meuTelefone)) continue
      if (telefonesDeContato.has(chaveTelefone(telefone)) || telefonesIgnorados.has(chaveTelefone(telefone))) continue
    }
    // Conversa `@lid` sem número: a chave é a do chat (`wa:`), como em `Ignorado`.
    const chave = telefone !== null ? `tel:${telefone}` : `wa:${chat.id}`
    ocorrencias.push({ chave, canal: 'whatsapp', nome: chat.name.trim(), interacoes: 1, ultimaEm: chat.lastAt, email: null, telefone, whatsappChatId: chat.id })
  }

  // Agrupa pela chave; a telefônica pela chave sem o nono dígito (o mesmo número com e sem ele vira um só).
  const grupos = new Map<string, Ocorrencia[]>()
  for (const ocorrencia of ocorrencias) {
    const id = ocorrencia.chave.startsWith('tel:') ? `tel:${chaveTelefone(ocorrencia.chave.slice(4))}` : ocorrencia.chave
    const grupo = grupos.get(id)
    if (grupo) grupo.push(ocorrencia)
    else grupos.set(id, [ocorrencia])
  }

  const sugestoes: Sugestao[] = []
  for (const grupo of grupos.values()) {
    const [primeira] = grupo
    if (!primeira) continue
    const porCanal = new Map<SugestaoCanal, number>()
    for (const item of grupo) porCanal.set(item.canal, (porCanal.get(item.canal) ?? 0) + item.interacoes)
    const canais = CANAIS.filter((canal) => porCanal.has(canal))
    let origem: SugestaoCanal = canais[0] ?? primeira.canal
    for (const canal of canais) if ((porCanal.get(canal) ?? 0) > (porCanal.get(origem) ?? 0)) origem = canal
    const nome = grupo.find((item) => item.nome !== '')?.nome ?? (primeira.email ? localPart(primeira.email) : (primeira.telefone ?? primeira.chave))
    sugestoes.push({
      chave: primeira.chave,
      nome,
      canais,
      interacoes: grupo.reduce((soma, item) => soma + item.interacoes, 0),
      ultimaEm: Math.max(...grupo.map((item) => item.ultimaEm)),
      origem,
      email: primeira.email,
      telefone: grupo.find((item) => item.telefone !== null)?.telefone ?? null,
      whatsappChatId: grupo.find((item) => item.whatsappChatId !== null)?.whatsappChatId ?? null,
    })
  }
  return sugestoes.sort((a, b) => b.ultimaEm - a.ultimaEm)
}

/** Chave de comparação de um telefone em qualquer formato (R3); texto sem dígito fica como veio. */
function chaveDe(texto: string): string {
  const normalizado = normalizarTelefone(texto)
  return normalizado === null ? texto : chaveTelefone(normalizado)
}
