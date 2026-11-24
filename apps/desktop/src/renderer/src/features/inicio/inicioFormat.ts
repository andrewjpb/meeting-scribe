// Textos, a linha do tempo e as classes comuns da tela Início (contrato 135, D11), em pt-BR e no fuso local. Sem DOM:
// testado em test/renderer/inicio-format.test.ts. A agenda é a linha comprimida do mockup (escolha D2): só os eventos,
// com 08:00 e 19:00 nas pontas e um trecho "livre até HH:mm" entre eles, sem proporção com o horário, para caber o dia
// sem rolar.
import type { InicioChamada, InicioEvento, InicioFonte, InicioMacEstado } from '@shared/inicio'
import { ROUTE_PATHS } from '@shared/routes'
import type { InicioTela } from '@shared/settings-defaults'

const pad = (value: number): string => String(value).padStart(2, '0')
const MINUTO_MS = 60_000
const DIA_MS = 86_400_000

/** As pontas da linha do dia (D2): 08:00 e 19:00, a não ser que um evento comece antes ou termine depois. */
export const LINHA_INICIO_HORA = 8
export const LINHA_FIM_HORA = 19
/** Intervalo entre dois eventos que ganha "livre até HH:mm" quando o agora não está nele. */
export const LIVRE_MIN_MS = 2 * 3_600_000

/** "Bom dia" das 5 às 12, "Boa tarde" das 12 às 18, "Boa noite" no resto; com o primeiro nome, "Boa tarde, Andrew". */
export function saudacao(agora: Date, nome: string | null): string {
  const hora = agora.getHours()
  const texto = hora >= 5 && hora < 12 ? 'Bom dia' : hora >= 12 && hora < 18 ? 'Boa tarde' : 'Boa noite'
  const primeiro = nome?.trim()
  return primeiro ? `${texto}, ${primeiro}` : texto
}

const EXTENSO = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

/** "Segunda-feira, 23 de novembro de 2026". */
export function dataPorExtenso(data: Date): string {
  const texto = EXTENSO.format(data)
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`
}

/** "14:00" de um instante (ISO ou ms), no fuso local. */
export function horaMinuto(quando: string | number | Date): string {
  const data = quando instanceof Date ? quando : new Date(quando)
  return `${pad(data.getHours())}:${pad(data.getMinutes())}`
}

/** "livre até 14:00". */
export function textoLivreAte(quando: string | number): string {
  return `livre até ${horaMinuto(quando)}`
}

const plural = (n: number, singular: string, varios: string): string => `${n} ${n === 1 ? singular : varios}`

/** "4 eventos", "1 evento" ou "nenhum evento" (o cabeçalho da agenda). */
export function textoEventos(n: number): string {
  return n === 0 ? 'nenhum evento' : plural(n, 'evento', 'eventos')
}

/** "Amanhã: 3 eventos", "Amanhã: 1 evento" ou "Amanhã: nenhum evento". */
export function textoAmanha(n: number): string {
  return `Amanhã: ${textoEventos(n)}`
}

/** "Em andamento · faltam 20 min" (ou "faltam 1 h 05 min"); no último minuto, "termina agora". */
export function textoEmAndamento(fim: string, agora: number): string {
  const minutos = Math.ceil((Date.parse(fim) - agora) / MINUTO_MS)
  if (!(minutos > 0)) return 'Em andamento · termina agora'
  const resto = minutos < 60 ? `${minutos} min` : `${Math.floor(minutos / 60)} h ${pad(minutos % 60)} min`
  return `Em andamento · faltam ${resto}`
}

export const CHAMADA_ROTULO: Readonly<Record<InicioChamada, string>> = { meet: 'Google Meet', teams: 'Teams', zoom: 'Zoom' }
/** A etiqueta da fonte (escolha D4 do mockup): só o nome, sem cor de marca. */
export const FONTE_ROTULO: Readonly<Record<InicioFonte, string>> = { google: 'Google', microsoft: 'Microsoft', mac: 'Mac' }

/** "09:00 – 09:30 · Google Meet"; o de dia inteiro, "Dia inteiro". */
export function textoHorarioEvento(evento: Pick<InicioEvento, 'inicio' | 'fim' | 'diaInteiro' | 'chamada'>): string {
  const horario = evento.diaInteiro ? 'Dia inteiro' : `${horaMinuto(evento.inicio)} – ${horaMinuto(evento.fim)}`
  return evento.chamada ? `${horario} · ${CHAMADA_ROTULO[evento.chamada]}` : horario
}

const DIA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const

/** Dias de calendário de `data` até `agora`, no fuso local (positivo no passado). */
function diasAte(data: Date, agora: Date): number {
  const dia = (valor: Date): number => Date.UTC(valor.getFullYear(), valor.getMonth(), valor.getDate())
  return Math.round((dia(agora) - dia(data)) / DIA_MS)
}

/** Quando foi a reunião: "hoje, 09:00", "ontem, 16:30" ou "sexta, 20/11". */
export function textoQuandoFoi(data: Date, agora: Date): string {
  const dias = diasAte(data, agora)
  if (dias === 0) return `hoje, ${horaMinuto(data)}`
  if (dias === 1) return `ontem, ${horaMinuto(data)}`
  return `${DIA_SEMANA[data.getDay()] ?? ''}, ${pad(data.getDate())}/${pad(data.getMonth() + 1)}`
}

/** Quando vai ser (a próxima automação): "hoje, 18:00", "amanhã, 07:00" ou "sexta, 27/11, 07:00". */
export function textoQuandoVai(data: Date, agora: Date): string {
  const dias = diasAte(data, agora)
  if (dias === 0) return `hoje, ${horaMinuto(data)}`
  if (dias === -1) return `amanhã, ${horaMinuto(data)}`
  return `${DIA_SEMANA[data.getDay()] ?? ''}, ${pad(data.getDate())}/${pad(data.getMonth() + 1)}, ${horaMinuto(data)}`
}

/** "“Triagem do email” falhou às 07:00"; de outro dia, "… falhou ontem, 16:30" ou "… falhou sexta, 20/11". */
export function textoFalha(nome: string, quando: string | null, agora: number): string {
  const data = quando ? new Date(quando) : null
  if (!data || Number.isNaN(data.getTime())) return `“${nome}” falhou`
  const dia = textoQuandoFoi(data, new Date(agora))
  return dia.startsWith('hoje, ') ? `“${nome}” falhou às ${horaMinuto(data)}` : `“${nome}” falhou ${dia}`
}

/**
 * O texto depois do número em cada linha de Pendências: "3 conversas do WhatsApp sem resposta", "1 convite de agenda sem
 * resposta", "5 emails na pasta Pendentes" e (contrato 146) "5 emails não lidos".
 */
export const textoPendencia = {
  whatsapp: (n: number): string => `${n === 1 ? 'conversa' : 'conversas'} do WhatsApp sem resposta`,
  convites: (n: number): string => `${n === 1 ? 'convite' : 'convites'} de agenda sem resposta`,
  emails: (n: number): string => `${n === 1 ? 'email' : 'emails'} na pasta Pendentes`,
  emailsNaoLidos: (n: number): string => (n === 1 ? 'email não lido' : 'emails não lidos'),
} as const

/** Contrato 146 (CA3): "Atualizado às 14:32", a hora local da última leitura (o `atualizadoEm` da view). */
export function textoAtualizado(quando: string): string {
  return `Atualizado às ${horaMinuto(quando)}`
}

/** Contrato 146 (CA6): ao lado do "Atualizar" quando alguma fonte não foi relida. */
export const TEXTO_ATUALIZAR_FALHOU = 'Não foi possível atualizar tudo.'

export type EstadoEvento = 'passado' | 'atual' | 'futuro'

/** Um item da linha do dia, na ordem em que aparece. */
export type ItemLinha =
  | { tipo: 'limite'; hora: string }
  | { tipo: 'evento'; evento: InicioEvento; hora: string; estado: EstadoEvento }
  | { tipo: 'livre'; texto: string }
  | { tipo: 'agora'; hora: string }

/** O instante de uma hora cheia do dia local de `agora`. */
function horaDoDia(agora: number, hora: number): number {
  const data = new Date(agora)
  return new Date(data.getFullYear(), data.getMonth(), data.getDate(), hora, 0, 0, 0).getTime()
}

function estadoDe(evento: InicioEvento, agora: number): EstadoEvento {
  if (Date.parse(evento.fim) <= agora) return 'passado'
  return Date.parse(evento.inicio) <= agora ? 'atual' : 'futuro'
}

/**
 * A linha comprimida do dia (D2). Os de dia inteiro vêm primeiro ("dia todo"); depois a ponta das 08:00 (sem ela quando
 * um evento começa às 08:00 ou antes), os eventos pela hora de início, a marca "agora" antes do primeiro que ainda não
 * começou e a ponta das 19:00 (sem ela quando um evento termina às 19:00 ou depois). Entre dois eventos entra "livre até
 * HH:mm" quando o agora está no intervalo livre ou quando o intervalo passa de 2 h.
 */
export function linhaDoDia(eventos: readonly InicioEvento[], agora: number): ItemLinha[] {
  const saida: ItemLinha[] = []
  for (const evento of eventos) if (evento.diaInteiro) saida.push({ tipo: 'evento', evento, hora: 'dia todo', estado: 'futuro' })
  const comHora = eventos.filter((evento) => !evento.diaInteiro && !Number.isNaN(Date.parse(evento.inicio))).sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio))
  const pontaInicio = horaDoDia(agora, LINHA_INICIO_HORA)
  const pontaFim = horaDoDia(agora, LINHA_FIM_HORA)
  const primeiro = comHora[0]
  const ultimoFim = comHora.reduce((maior, evento) => Math.max(maior, Date.parse(evento.fim) || 0), 0)
  const mostraInicio = !primeiro || Date.parse(primeiro.inicio) > pontaInicio
  const mostraFim = comHora.length === 0 || ultimoFim < pontaFim

  let agoraFeito = false
  const poeAgora = (): void => {
    if (agoraFeito) return
    saida.push({ tipo: 'agora', hora: horaMinuto(agora) })
    agoraFeito = true
  }

  if (mostraInicio) {
    if (agora < pontaInicio) poeAgora()
    saida.push({ tipo: 'limite', hora: horaMinuto(pontaInicio) })
  }
  /** O fim mais tarde dos eventos já postos: até ali o dia está ocupado. */
  let ocupadoAte: number | null = null
  for (const evento of comHora) {
    const inicio = Date.parse(evento.inicio)
    if (!agoraFeito && agora < inicio) {
      poeAgora()
      const livreAgora = ocupadoAte === null || agora >= ocupadoAte
      if (livreAgora || (ocupadoAte !== null && inicio - ocupadoAte >= LIVRE_MIN_MS)) saida.push({ tipo: 'livre', texto: textoLivreAte(inicio) })
    } else if (ocupadoAte !== null && inicio - ocupadoAte >= LIVRE_MIN_MS) {
      saida.push({ tipo: 'livre', texto: textoLivreAte(inicio) })
    }
    saida.push({ tipo: 'evento', evento, hora: horaMinuto(inicio), estado: estadoDe(evento, agora) })
    const fim = Date.parse(evento.fim)
    if (!Number.isNaN(fim)) ocupadoAte = ocupadoAte === null ? fim : Math.max(ocupadoAte, fim)
  }
  if (mostraFim) {
    if (agora < pontaFim) poeAgora()
    saida.push({ tipo: 'limite', hora: horaMinuto(pontaFim) })
  }
  poeAgora()
  return saida
}

/** D2 (contrato 136): onde o app abre, pela preferência lida uma vez ao montar: Início (`/inicio`) ou Reuniões (`/`). */
export function rotaInicial(tela: InicioTela): string {
  return tela === 'reunioes' ? ROUTE_PATHS.reunioes : ROUTE_PATHS.inicio
}

/** A frase abaixo de "Sem eventos hoje" (artboard 03), só com as fontes que a agenda leu. */
export function textoSemEventos(contas: boolean, mac: InicioMacEstado): string {
  if (contas && mac === 'ok') return 'As agendas conectadas e o Calendário do Mac não têm nada marcado para hoje.'
  if (contas) return 'As agendas conectadas não têm nada marcado para hoje.'
  if (mac === 'ok') return 'O Calendário do Mac não tem nada marcado para hoje.'
  return 'Nenhuma agenda para ler hoje.'
}

/** A linha discreta do Calendário do Mac sem acesso (PRD); "conceder" é o botão ao lado. */
export const TEXTO_MAC_SEM_ACESSO = 'Calendário do Mac sem acesso'
/** No `pnpm dev` o `request-access` não sai (D5): a linha explica em vez de oferecer "conceder". */
export const TEXTO_MAC_DEV = 'Calendário do Mac sem acesso — no pnpm dev o acesso não dá para conceder, só no app instalado.'

/** O link da tela (o `.lnk` do mockup): 12 px em --accent, sublinhado, sem negrito. */
export const INICIO_LINK_CLASS =
  'no-drag shrink-0 rounded-[var(--radius-control)] text-12 text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'
/** Um cartão da coluna da direita: fio --line-strong, raio 6, fundo --bg-raised, sem sombra. */
export const INICIO_CARTAO_CLASS = 'flex flex-col rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised px-3 pt-2.5 pb-3'
/** O cabeçalho de um cartão: 24 px, título 14/20 em --title. */
export const INICIO_CARTAO_CABECALHO_CLASS = 'mb-1 flex h-6 items-center gap-2'
export const INICIO_CARTAO_TITULO_CLASS = 'text-14 leading-5 font-semibold text-title'
