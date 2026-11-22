// Formatação, visões e grupos da tela Tarefas (contrato 123, R2 a R5, D-10, D-11), reusados pela seção Tarefas do funil
// (125) e pelos botões do Resumo, do Email e do WhatsApp (126). Sem DOM: testado em test/renderer/tarefas-format.test.ts.
// A partição Vencidas/Hoje/Próximas/Sem prazo e a contagem das vencidas vêm de `shared/tarefas-logic.ts`, a mesma
// que o `TAREFAS.md`, o aviso "Hoje" e o serviço usam.
import type { FunilView } from '@shared/funil'
import { semAcento } from '@shared/funil-logic'
import type { SummaryTask } from '@shared/meeting-summary'
import { FEITAS_DIAS, TAREFA_TITULO_MAX, type EventoTarefa, type ResponsavelTarefa, type SugestaoTarefa, type Tarefa, type TarefaInput, type TarefasView } from '@shared/tarefas'
import { casaComResumo, contarVencidas, particao } from '@shared/tarefas-logic'
import { contatoLigado, type ContatoAlvo } from '../funil/ContactLink'

const DIA_MS = 86_400_000

/** As abas da tela, na ordem do `Segmented` (R2); a de abertura é Hoje. */
export type VisaoTarefas = 'hoje' | 'proximas' | 'todas' | 'feitas' | 'sugestoes'
/** As abas que mostram tarefas (Sugestões mostra candidatas). */
export type VisaoLista = Exclude<VisaoTarefas, 'sugestoes'>

export const VISOES_TAREFAS: readonly { value: VisaoTarefas; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'proximas', label: 'Próximas' },
  { value: 'todas', label: 'Todas' },
  { value: 'feitas', label: 'Feitas' },
  { value: 'sugestoes', label: 'Sugestões' },
]

/** "Agrupar por" (R4), na ordem do `Select`; o padrão é Prazo. */
export type ModoAgrupar = 'prazo' | 'oportunidade' | 'reuniao' | 'contato'

export const MODOS_AGRUPAR: readonly { value: ModoAgrupar; label: string }[] = [
  { value: 'prazo', label: 'Prazo' },
  { value: 'oportunidade', label: 'Oportunidade' },
  { value: 'reuniao', label: 'Reunião' },
  { value: 'contato', label: 'Contato' },
]

/** Texto comparável da busca: sem acento, sem caixa e sem espaço nas pontas. */
const chave = (texto: string): string => semAcento(texto).toLowerCase().trim()

/** `25/11` de `2026-11-25`. */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split('-')
  return `${d}/${mes}`
}

/** `AAAA-MM-DD` de um dia somado de `n` dias (o cálculo em UTC não sofre com a troca de horário). */
function somarDias(dia: string, n: number): string {
  const [ano, mes, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(ano ?? 1970, (mes ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10)
}

/** Dias inteiros de `de` até `ate` (os dois `AAAA-MM-DD`). */
function diasEntre(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS)
}

/** O domingo da semana de `hoje` (o próprio dia, se for domingo): o fim de "Esta semana" (D-11). */
function domingoDe(hoje: string): string {
  const semana = new Date(`${hoje}T00:00:00Z`).getUTCDay()
  return somarDias(hoje, (7 - semana) % 7)
}

export type IconeOrigem = 'reuniao' | 'oportunidade' | 'email' | 'whatsapp' | 'assistente' | 'automacao' | 'manual'

/** A origem de uma linha (R3): o ícone, o texto com o tipo ("Reunião: …") e só o nome (a lista estreita do detalhe). */
export interface OrigemTexto {
  icone: IconeOrigem
  texto: string
  nome: string
}

/**
 * A origem como a linha mostra (R3): "Reunião: <título>", "Oportunidade: <título>", "E-mail: <assunto>", "WhatsApp:
 * <conversa>", "Assistente", "Automação" ou "Manual". A migrada mostra a origem do vínculo (oportunidade, reunião,
 * e-mail ou conversa, nessa ordem) ou "Manual". Nome que a view não resolveu (item apagado) fica só com o tipo.
 */
export function textoOrigem(tarefa: Pick<Tarefa, 'origem' | 'vinculos'>, nomes: TarefasView['nomes']): OrigemTexto {
  const comNome = (icone: IconeOrigem, tipo: string, nome: string | undefined): OrigemTexto => (nome ? { icone, texto: `${tipo}: ${nome}`, nome } : { icone, texto: tipo, nome: tipo })
  const { origem, vinculos } = tarefa
  switch (origem.tipo) {
    case 'reuniao':
      return comNome('reuniao', 'Reunião', nomes.reunioes[origem.meetingId])
    case 'funil':
      return comNome('oportunidade', 'Oportunidade', nomes.oportunidades[origem.oportunidadeId])
    case 'email':
      return comNome('email', 'E-mail', origem.assunto || '(sem assunto)')
    case 'whatsapp':
      return comNome('whatsapp', 'WhatsApp', nomes.whatsapp[origem.chatId])
    case 'assistente':
      return { icone: 'assistente', texto: 'Assistente', nome: 'Assistente' }
    case 'automacao':
      return { icone: 'automacao', texto: 'Automação', nome: 'Automação' }
    case 'manual':
      return { icone: 'manual', texto: 'Manual', nome: 'Manual' }
    case 'migracao':
      if (vinculos.oportunidadeId) return comNome('oportunidade', 'Oportunidade', nomes.oportunidades[vinculos.oportunidadeId])
      if (vinculos.meetingId) return comNome('reuniao', 'Reunião', nomes.reunioes[vinculos.meetingId])
      if (vinculos.email) return comNome('email', 'E-mail', vinculos.email.assunto || '(sem assunto)')
      if (vinculos.whatsappChatId) return comNome('whatsapp', 'WhatsApp', nomes.whatsapp[vinculos.whatsappChatId])
      return { icone: 'manual', texto: 'Manual', nome: 'Manual' }
  }
}

/** Quem é o responsável (R3): `null` quando é "eu" (a linha não mostra); o nome do contato ou o texto digitado. */
export function textoResponsavel(responsavel: ResponsavelTarefa, nomes: TarefasView['nomes']): string | null {
  if (responsavel.tipo === 'eu') return null
  if (responsavel.tipo === 'nome') return responsavel.nome
  return nomes.contatos[responsavel.contatoId] ?? 'Contato'
}

/** O prazo à direita da linha (R3, D3 do mockup): "hoje", "dd/mm" ou, vencido, "dd/mm · há N d"; sem prazo, vazio. */
export function textoPrazo(prazo: string | null, hoje: string): { texto: string; vencida: boolean; atrasoDias: number } {
  if (prazo === null) return { texto: '', vencida: false, atrasoDias: 0 }
  if (prazo === hoje) return { texto: 'hoje', vencida: false, atrasoDias: 0 }
  if (prazo > hoje) return { texto: diaCurto(prazo), vencida: false, atrasoDias: 0 }
  const atrasoDias = diasEntre(prazo, hoje)
  return { texto: `${diaCurto(prazo)} · há ${atrasoDias} d`, vencida: true, atrasoDias }
}

/** O número ao lado de "Tarefas" na barra lateral (R1): as vencidas; nada quando zero ou sem a view. */
export function badgeVencidas(view: Pick<TarefasView, 'tarefas' | 'hoje'> | null): string {
  if (!view) return ''
  const total = contarVencidas(view.tarefas, view.hoje)
  return total > 0 ? String(total) : ''
}

/** A tarefa casa com a busca (R2): título, detalhe ou nome da origem, sem acento e sem caixa. */
function casaBusca(tarefa: Tarefa, termo: string, nomes: TarefasView['nomes']): boolean {
  return [tarefa.titulo, tarefa.detalhe, textoOrigem(tarefa, nomes).texto].some((texto) => chave(texto).includes(termo))
}

/**
 * As tarefas de uma visão (R2, D-10), já filtradas pela busca: Hoje = vencidas e depois as de hoje; Próximas = abertas
 * com prazo depois de hoje, por prazo; Todas = abertas por prazo (sem prazo por último) e criação; Feitas = feitas e
 * canceladas com o fechamento nos últimos 90 dias, a mais recente primeiro. Sugestões não tem tarefas.
 */
export function filtrarVisao(view: Pick<TarefasView, 'tarefas' | 'hoje' | 'nomes'>, visao: VisaoTarefas, busca: string, now: number = Date.now()): Tarefa[] {
  const partes = particao(view.tarefas, view.hoje)
  let lista: Tarefa[]
  if (visao === 'hoje') lista = [...partes.vencidas, ...partes.hoje]
  else if (visao === 'proximas') lista = partes.proximas
  else if (visao === 'todas') lista = [...partes.vencidas, ...partes.hoje, ...partes.proximas, ...partes.semPrazo]
  else if (visao === 'feitas') {
    const desde = now - FEITAS_DIAS * DIA_MS
    lista = view.tarefas.filter((tarefa) => tarefa.status !== 'aberta' && tarefa.feitaEm !== null && tarefa.feitaEm >= desde).sort((a, b) => (b.feitaEm ?? 0) - (a.feitaEm ?? 0))
  } else lista = []
  const termo = chave(busca)
  return termo ? lista.filter((tarefa) => casaBusca(tarefa, termo, view.nomes)) : lista
}

export interface GrupoTarefas {
  /** `vencidas`, `hoje`… no Prazo; o id da oportunidade, da reunião ou do contato; `sem-…` para o grupo sem vínculo. */
  chave: string
  nome: string
  tarefas: Tarefa[]
}

/** Os grupos do Prazo, nesta ordem (R4, D-11); "Antes de hoje" junta as fechadas de prazo passado (Feitas). */
const GRUPOS_PRAZO: readonly { chave: string; nome: string }[] = [
  { chave: 'vencidas', nome: 'Vencidas' },
  { chave: 'antes', nome: 'Antes de hoje' },
  { chave: 'hoje', nome: 'Hoje' },
  { chave: 'semana', nome: 'Esta semana' },
  { chave: 'depois', nome: 'Depois' },
  { chave: 'sem-prazo', nome: 'Sem prazo' },
]

function grupoDoPrazo(tarefa: Tarefa, hoje: string, domingo: string): string {
  const { prazo } = tarefa
  if (prazo === null) return 'sem-prazo'
  if (prazo < hoje) return tarefa.status === 'aberta' ? 'vencidas' : 'antes'
  if (prazo === hoje) return 'hoje'
  return prazo <= domingo ? 'semana' : 'depois'
}

/** O vínculo que decide o grupo: a oportunidade, a reunião (do vínculo ou da origem) ou o primeiro contato (D-11). */
function vinculoDe(tarefa: Tarefa, modo: Exclude<ModoAgrupar, 'prazo'>): string | null {
  if (modo === 'oportunidade') return tarefa.vinculos.oportunidadeId
  if (modo === 'contato') return tarefa.vinculos.contatoIds[0] ?? null
  return tarefa.vinculos.meetingId ?? (tarefa.origem.tipo === 'reuniao' ? tarefa.origem.meetingId : null)
}

const SEM: Record<Exclude<ModoAgrupar, 'prazo'>, { chave: string; nome: string; tipo: string }> = {
  oportunidade: { chave: 'sem-oportunidade', nome: 'Sem oportunidade', tipo: 'Oportunidade' },
  reuniao: { chave: 'sem-reuniao', nome: 'Sem reunião', tipo: 'Reunião' },
  contato: { chave: 'sem-contato', nome: 'Sem contato', tipo: 'Contato' },
}

/**
 * As tarefas em grupos (R4, D-11), cada um mantendo a ordem em que as tarefas vieram; grupo vazio não aparece. Prazo:
 * Vencidas · Hoje · Esta semana (até o domingo corrente) · Depois · Sem prazo. Oportunidade, Reunião e Contato (o
 * primeiro dos vínculos): um grupo por item, ordenados pelo prazo mais próximo do grupo (sem prazo por último), e o
 * grupo sem vínculo por último.
 */
export function agrupar(tarefas: readonly Tarefa[], modo: ModoAgrupar, view: Pick<TarefasView, 'hoje' | 'nomes'>): GrupoTarefas[] {
  if (modo === 'prazo') {
    const domingo = domingoDe(view.hoje)
    const porChave = new Map<string, Tarefa[]>()
    for (const tarefa of tarefas) {
      const chaveGrupo = grupoDoPrazo(tarefa, view.hoje, domingo)
      porChave.set(chaveGrupo, [...(porChave.get(chaveGrupo) ?? []), tarefa])
    }
    return GRUPOS_PRAZO.flatMap((grupo) => {
      const lista = porChave.get(grupo.chave)
      return lista?.length ? [{ ...grupo, tarefas: lista }] : []
    })
  }
  const sem = SEM[modo]
  const nomes = modo === 'oportunidade' ? view.nomes.oportunidades : modo === 'contato' ? view.nomes.contatos : view.nomes.reunioes
  const grupos = new Map<string, GrupoTarefas>()
  const semVinculo: Tarefa[] = []
  for (const tarefa of tarefas) {
    const id = vinculoDe(tarefa, modo)
    if (id === null) {
      semVinculo.push(tarefa)
      continue
    }
    const grupo = grupos.get(id) ?? { chave: id, nome: nomes[id] ?? sem.tipo, tarefas: [] }
    grupo.tarefas.push(tarefa)
    grupos.set(id, grupo)
  }
  const maisProximo = (grupo: GrupoTarefas): string | null => grupo.tarefas.reduce<string | null>((menor, tarefa) => (tarefa.prazo !== null && (menor === null || tarefa.prazo < menor) ? tarefa.prazo : menor), null)
  const ordenados = [...grupos.values()]
    .map((grupo, ordem) => ({ grupo, ordem, prazo: maisProximo(grupo) }))
    .sort((a, b) => {
      if (a.prazo !== b.prazo) {
        if (a.prazo === null) return 1
        if (b.prazo === null) return -1
        return a.prazo < b.prazo ? -1 : 1
      }
      return a.ordem - b.ordem
    })
    .map((item) => item.grupo)
  return semVinculo.length ? [...ordenados, { chave: sem.chave, nome: sem.nome, tarefas: semVinculo }] : ordenados
}

const VINCULO_ROTULO: Record<string, string> = { oportunidade: 'oportunidade', contatos: 'contatos', empresa: 'empresa', reuniao: 'reunião' }

/** Um evento do Histórico (R5) em pt-BR: "Criada", "Prazo 23/11", "Concluída", "Vínculos: oportunidade, contatos"… */
export function textoEvento(evento: Pick<EventoTarefa, 'tipo' | 'detalhe'>): string {
  switch (evento.tipo) {
    case 'criada':
      return 'Criada'
    case 'prazo':
      return evento.detalhe ? `Prazo ${diaCurto(evento.detalhe)}` : 'Prazo tirado'
    case 'lembrete':
      return 'Lembrete alterado'
    case 'feita':
      return 'Concluída'
    case 'reaberta':
      return 'Reaberta'
    case 'cancelada':
      return 'Cancelada'
    case 'responsavel':
      return 'Responsável alterado'
    case 'vinculo': {
      const partes = (evento.detalhe ?? '')
        .split(',')
        .map((parte) => parte.trim())
        .filter((parte) => parte)
        .map((parte) => VINCULO_ROTULO[parte] ?? parte)
      return partes.length ? `Vínculos: ${partes.join(', ')}` : 'Vínculos alterados'
    }
  }
}

/** Dia, mês, hora e minuto de um instante no fuso pedido. */
function partes(at: number, timeZone: string): { dia: string; hora: string } {
  const lista = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string => lista.find((parte) => parte.type === tipo)?.value ?? ''
  return { dia: `${valor('year')}-${valor('month')}-${valor('day')}`, hora: `${valor('hour')}:${valor('minute')}` }
}

/** O dia (`AAAA-MM-DD`) e a hora (`HH:MM`) de um lembrete, para os campos de "Em…". */
export function diaEHora(at: number, timeZone: string): { dia: string; hora: string } {
  return partes(at, timeZone)
}

/**
 * O aviso efetivo ao lado do Lembrete (R5, mockup): "hoje, 09:00", "amanhã, 10:30", "ontem, 09:00" ou "25/11, 09:00",
 * com " · já avisou" depois do disparo; sem lembrete, vazio.
 */
export function textoLembrete(lembreteEm: number | null, disparadoEm: number | null, hoje: string, timeZone: string): string {
  if (lembreteEm === null) return ''
  const { dia, hora } = partes(lembreteEm, timeZone)
  const rotulo = dia === hoje ? 'hoje' : dia === somarDias(hoje, 1) ? 'amanhã' : dia === somarDias(hoje, -1) ? 'ontem' : diaCurto(dia)
  return `${rotulo}, ${hora}${disparadoEm !== null ? ' · já avisou' : ''}`
}

/**
 * O que "Adicionar" cria (R26): o texto como título, o prazo da sugestão e a origem dela; a do resumo e a da conversa
 * ficam também ligadas à reunião ou à conversa, e a da análise nasce manual, ligada à reunião.
 */
export function tarefaDaSugestao(sugestao: SugestaoTarefa): TarefaInput {
  const titulo = sugestao.texto.trim().slice(0, TAREFA_TITULO_MAX)
  const { origem } = sugestao
  if (origem.tipo === 'reuniao') return { titulo, prazo: sugestao.prazo, origem: { tipo: 'reuniao', meetingId: origem.meetingId, texto: sugestao.texto.slice(0, 1_000) }, vinculos: { meetingId: origem.meetingId } }
  if (origem.tipo === 'whatsapp') return { titulo, prazo: sugestao.prazo, origem: { tipo: 'whatsapp', chatId: origem.chatId, texto: sugestao.texto.slice(0, 1_000) }, vinculos: { whatsappChatId: origem.chatId } }
  return { titulo, prazo: sugestao.prazo, origem: { tipo: 'manual' }, vinculos: { meetingId: origem.meetingId } }
}

// Contrato 126: a tabela "Tarefas" do Resumo (R22) e a frase do vínculo do "+ Tarefa" do e-mail (R24).

/** Uma linha da tabela do Resumo e a tarefa que veio dela (`null` enquanto não foi adicionada). */
export interface LinhaResumo {
  indice: number
  tarefaId: string | null
}

/**
 * Cada linha do resumo com a tarefa casada (R22, R23): mesma reunião e o mesmo texto pelo `slugTexto`. Com mais de uma
 * (a mesma linha adicionada de novo depois de apagada a primeira), a aberta vem antes; senão, a primeira da lista.
 */
export function linhasDoResumo(tasks: readonly Pick<SummaryTask, 'task'>[], meetingId: string, tarefas: readonly Tarefa[]): LinhaResumo[] {
  return tasks.map((task, indice) => {
    const casadas = tarefas.filter((tarefa) => casaComResumo(tarefa, meetingId, task.task))
    const tarefa = casadas.find((item) => item.status === 'aberta') ?? casadas[0]
    return { indice, tarefaId: tarefa?.id ?? null }
  })
}

/** Quantas linhas de "Você" ainda não viraram tarefa: com zero, "Adicionar as minhas" não aparece (R22). */
export function pendentesMinhas(tasks: readonly Pick<SummaryTask, 'owner'>[], linhas: readonly LinhaResumo[]): number {
  return linhas.filter((linha) => linha.tarefaId === null && tasks[linha.indice]?.owner === 'Você').length
}

/**
 * A célula Prazo da linha (R22, artboard 10): com `dueIso`, a data real "dd/mm" e, ao lado em cinza, o que foi dito
 * ("sexta-feira"); sem ela, só o que foi dito, como antes. Nada dito nem calculado, os dois `null` (a célula mostra "—").
 */
export function textoPrazoResumo(task: Pick<SummaryTask, 'due' | 'dueIso'>): { data: string | null; dito: string | null } {
  return { data: task.dueIso ? diaCurto(task.dueIso) : null, dito: task.due }
}

/**
 * A frase acima dos campos do "+ Tarefa" do e-mail (R24), pela mesma regra que o serviço usa ao criar (R9): o contato do
 * remetente e, se ele tiver exatamente uma oportunidade aberta e não arquivada, ela. "Ligada a <contato> · <oportunidade>",
 * "Ligada a <contato>" ou, sem contato (ou sem a view do funil), "Ligada a este e-mail". A oportunidade escolhida no
 * campo do formulário vale por cima da regra (é ela que o serviço grava).
 */
export function fraseVinculo(funil: Pick<FunilView, 'state'> | null, alvo: ContatoAlvo, escolhida: { nome: string } | null = null): string {
  const contato = funil ? contatoLigado(funil.state.contatos, alvo) : null
  const base = contato ? `Ligada a ${contato.nome}` : 'Ligada a este e-mail'
  if (escolhida) return `${base} · ${escolhida.nome}`
  if (!funil || !contato) return base
  const etapas = new Map(funil.state.etapas.map((etapa) => [etapa.id, etapa.tipo]))
  const abertas = funil.state.oportunidades.filter((op) => !op.arquivado && op.contatoIds.includes(contato.id) && etapas.get(op.etapaId) === 'aberta')
  return abertas.length === 1 && abertas[0] ? `Ligada a ${contato.nome} · ${abertas[0].titulo}` : `Ligada a ${contato.nome}`
}
