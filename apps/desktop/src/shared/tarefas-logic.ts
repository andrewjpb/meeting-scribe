// Tarefas (contrato 121, D2): a lógica pura que a tela, o `TAREFAS.md`, o aviso "Hoje", o badge e o serviço usam
// do mesmo jeito. Sem Node e sem zod (roda no renderer). Datas como `AAAA-MM-DD` comparam como texto.
import { semAcento } from './funil-logic'
import type { ResponsavelTarefa, Tarefa } from './tarefas'

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/
const SLUG_MAX = 80

/** `AAAA-MM-DD` de uma data que existe no calendário (`2026-02-30` não passa). */
export function diaValido(dia: unknown): dia is string {
  if (typeof dia !== 'string') return false
  const partes = DIA.exec(dia)
  if (!partes) return false
  const [ano, mes, d] = [Number(partes[1]), Number(partes[2]), Number(partes[3])]
  const data = new Date(Date.UTC(ano, mes - 1, d))
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === d
}

/** `AAAA-MM-DD` de um instante no fuso pedido. */
export function diaNoFuso(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
}

/** Aberta e com prazo antes de hoje. */
export const vencida = (t: Pick<Tarefa, 'status' | 'prazo'>, hoje: string): boolean => t.status === 'aberta' && t.prazo !== null && t.prazo < hoje

/** Aberta e com prazo hoje. */
export const deHoje = (t: Pick<Tarefa, 'status' | 'prazo'>, hoje: string): boolean => t.status === 'aberta' && t.prazo === hoje

export const contarVencidas = (tarefas: readonly Tarefa[], hoje: string): number => tarefas.filter((t) => vencida(t, hoje)).length

/** Por prazo (sem prazo por último), depois pela criação e, por fim, pelo id (ordem estável). */
function porPrazo(a: Tarefa, b: Tarefa): number {
  if (a.prazo !== b.prazo) {
    if (a.prazo === null) return 1
    if (b.prazo === null) return -1
    return a.prazo < b.prazo ? -1 : 1
  }
  return porCriacao(a, b)
}

const porCriacao = (a: Tarefa, b: Tarefa): number => a.criadaEm - b.criadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Abertas ligadas à oportunidade, por prazo (sem prazo por último) e criação. */
export const abertasDaOportunidade = (tarefas: readonly Tarefa[], opId: string): Tarefa[] =>
  tarefas.filter((t) => t.status === 'aberta' && t.vinculos.oportunidadeId === opId).sort(porPrazo)

/**
 * Os lembretes que ainda vão avisar (contrato 131, R3): tarefas abertas com `lembreteEm` depois de `agora` e ainda não
 * disparadas, na ordem em que vieram. Os lembretes de e-mail do Assistente (`EMAILS.md`) saem daqui.
 */
export const lembretesFuturos = (tarefas: readonly Tarefa[], agora: number): (Tarefa & { lembreteEm: number })[] =>
  tarefas.filter((t): t is Tarefa & { lembreteEm: number } => t.status === 'aberta' && t.lembreteEm !== null && t.lembreteEm > agora && t.lembreteDisparadoEm === null)

/** O "próximo passo" derivado da oportunidade; `null` sem tarefa aberta. */
export const proximaDaOportunidade = (tarefas: readonly Tarefa[], opId: string): Tarefa | null => abertasDaOportunidade(tarefas, opId)[0] ?? null

export interface ParticaoTarefas {
  vencidas: Tarefa[]
  hoje: Tarefa[]
  proximas: Tarefa[]
  semPrazo: Tarefa[]
}

/** As abertas em Vencidas, Hoje, Próximas e Sem prazo; cada uma cai em exatamente uma. */
export function particao(tarefas: readonly Tarefa[], hoje: string): ParticaoTarefas {
  const saida: ParticaoTarefas = { vencidas: [], hoje: [], proximas: [], semPrazo: [] }
  for (const t of tarefas) {
    if (t.status !== 'aberta') continue
    if (t.prazo === null) saida.semPrazo.push(t)
    else if (t.prazo < hoje) saida.vencidas.push(t)
    else if (t.prazo === hoje) saida.hoje.push(t)
    else saida.proximas.push(t)
  }
  saida.vencidas.sort(porPrazo)
  saida.hoje.sort(porCriacao)
  saida.proximas.sort(porPrazo)
  saida.semPrazo.sort(porCriacao)
  return saida
}

/** Texto comparável: sem acento, minúsculas, cada trecho que não é letra nem número vira um `-`, até 80 caracteres. */
export function slugTexto(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
}

/** Chave estável de uma sugestão (R26): `reuniao:<meetingId>:<slug>`, `analise:…` ou `whatsapp:<chatId>:<slug>`. */
export const chaveSugestao = (origem: 'reuniao' | 'analise' | 'whatsapp', ref: string, texto: string): string => `${origem}:${ref}:${slugTexto(texto)}`

/** Diferença entre o relógio do fuso e o UTC no instante dado, em ms. */
function deslocamento(at: number, timeZone: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(at))
  const parte = (tipo: Intl.DateTimeFormatPartTypes): number => Number(partes.find((item) => item.type === tipo)?.value ?? 0)
  const relogio = Date.UTC(parte('year'), parte('month') - 1, parte('day'), parte('hour'), parte('minute'), parte('second'))
  return relogio - (at - (at % 1000))
}

/** Epoch ms do lembrete padrão: o dia do prazo, na hora pedida (`HH:MM`; fora do formato, 09:00), no fuso. */
export function lembretePadrao(prazo: string, hora: string, timeZone: string): number {
  const dia = DIA.exec(prazo)
  const relogio = HORA.exec(hora) ?? ['09:00', '09', '00']
  const local = Date.UTC(Number(dia?.[1]), Number(dia?.[2]) - 1, Number(dia?.[3]), Number(relogio[1]), Number(relogio[2]))
  const primeiro = local - deslocamento(local, timeZone)
  // Perto da troca de horário o deslocamento do palpite pode não ser o do resultado: confere uma vez.
  const segundo = local - deslocamento(primeiro, timeZone)
  return segundo
}

/**
 * Lembrete depois de mudar o prazo (R11, D-6). É "padrão" quando `lembreteEm` é igual ao padrão do prazo antigo;
 * qualquer outro valor é personalizado e fica. Sem prazo novo, o padrão sai. Prazo novo numa tarefa sem prazo e sem
 * lembrete ganha o padrão se `lembrarNoPrazo` está ligado.
 */
export function recalcularLembrete(input: {
  lembreteEm: number | null
  prazoAntigo: string | null
  prazoNovo: string | null
  hora: string
  lembrarNoPrazo: boolean
  timeZone: string
}): number | null {
  const { lembreteEm, prazoAntigo, prazoNovo, hora, lembrarNoPrazo, timeZone } = input
  const eraPadrao = prazoAntigo !== null && lembreteEm !== null && lembreteEm === lembretePadrao(prazoAntigo, hora, timeZone)
  if (prazoNovo === null) return eraPadrao ? null : lembreteEm
  if (eraPadrao || (lembreteEm === null && prazoAntigo === null && lembrarNoPrazo)) return lembretePadrao(prazoNovo, hora, timeZone)
  return lembreteEm
}

/** Nome comparável: sem acento, sem caixa e com espaços simples. */
const chaveNome = (nome: string): string => semAcento(nome).trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Responsável de uma tarefa do resumo (R22, D-16): "Você" (ou nenhum dono) é `eu`; o nome igual, sem acento e sem
 * caixa, ao de um participante da agenda cujo e-mail é de um contato vira esse contato; outro texto fica como nome.
 */
export function responsavelDoDono(
  owner: string | null,
  attendees: readonly { name: string; email: string }[],
  contatos: readonly { id: string; emails: readonly string[] }[],
): ResponsavelTarefa {
  const nome = owner?.trim() ?? ''
  if (!nome || chaveNome(nome) === 'voce') return { tipo: 'eu' }
  const chave = chaveNome(nome)
  for (const participante of attendees) {
    if (chaveNome(participante.name) !== chave) continue
    const email = participante.email.trim().toLowerCase()
    const contato = email ? contatos.find((item) => item.emails.some((outro) => outro.trim().toLowerCase() === email)) : undefined
    if (contato) return { tipo: 'contato', contatoId: contato.id }
  }
  return { tipo: 'nome', nome }
}

/** A tarefa veio desta linha do resumo (R22): mesma reunião e o mesmo texto pelo slug. */
export const casaComResumo = (tarefa: Pick<Tarefa, 'origem'>, meetingId: string, texto: string): boolean =>
  tarefa.origem.tipo === 'reuniao' && tarefa.origem.meetingId === meetingId && slugTexto(tarefa.origem.texto) === slugTexto(texto)

/**
 * A tarefa veio desta linha da análise (contrato 131, R1): origem `analise`, mesma reunião e o mesmo texto pelo slug.
 * Vale com qualquer status, como a do resumo: a feita e a cancelada também seguram a sugestão.
 */
export const casaComAnalise = (tarefa: Pick<Tarefa, 'origem'>, meetingId: string, texto: string): boolean =>
  tarefa.origem.tipo === 'analise' && tarefa.origem.meetingId === meetingId && slugTexto(tarefa.origem.texto) === slugTexto(texto)

/**
 * Prazo de um "quando" do WhatsApp (D-9): `AAAA-MM-DD` válido fica; `dd/mm` ganha o ano de hoje, ou o seguinte se a
 * data já passou; qualquer outro texto ("sexta", "amanhã") fica sem prazo.
 */
export function prazoDoQuando(quando: string | null | undefined, hoje: string): string | null {
  const texto = typeof quando === 'string' ? quando.trim() : ''
  if (diaValido(texto)) return texto
  const partes = /^(\d{1,2})\/(\d{1,2})$/.exec(texto)
  const ano = Number(DIA.exec(hoje)?.[1])
  if (!partes || !Number.isFinite(ano)) return null
  const montar = (a: number): string => `${a}-${partes[2]?.padStart(2, '0')}-${partes[1]?.padStart(2, '0')}`
  const desteAno = montar(ano)
  const dia = desteAno < hoje ? montar(ano + 1) : desteAno
  return diaValido(dia) ? dia : null
}
