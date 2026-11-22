// O `TAREFAS.md` (contrato 121, R27, D21): o gerador único do texto que o modelo lê, usado pela fonte Tarefas do
// Assistente (127) e pelas execuções de agente com "Pode ler as tarefas" (124). Puro: recebe as tarefas, os nomes
// das oportunidades, contatos e reuniões, o dia de hoje e o fuso. Só abertas; sem e-mail, telefone nem detalhe.
import { TAREFAS_MD_MAX, type Tarefa } from '../../shared/tarefas'
import { particao } from '../../shared/tarefas-logic'

const ID_CURTO = 8

export interface TarefasMarkdownInput {
  tarefas: readonly Tarefa[]
  nomes: { oportunidades: ReadonlyMap<string, string>; contatos: ReadonlyMap<string, string>; reunioes: ReadonlyMap<string, string> }
  /** `AAAA-MM-DD` no fuso. */
  hoje: string
  timeZone: string
}

/** Uma linha só: quebra de linha vira espaço (o texto da pessoa não abre seção nova no Markdown). */
const linha = (texto: string): string => texto.replace(/\s*\n\s*/g, ' ').trim()

/** `AAAA-MM-DD` como `dd/mm`. */
function diaMes(dia: string): string {
  const partes = /^\d{4}-(\d{2})-(\d{2})$/.exec(dia)
  return partes ? `${partes[2]}/${partes[1]}` : dia
}

/** `dd/mm HH:MM` no fuso pedido. */
function diaHora(at: number, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((item) => item.type === tipo)?.value ?? ''
  return `${parte('day')}/${parte('month')} ${parte('hour')}:${parte('minute')}`
}

export function tarefasMarkdown(input: TarefasMarkdownInput): string {
  const { tarefas, nomes, hoje, timeZone } = input
  const responsavel = (tarefa: Tarefa): string => {
    const quem = tarefa.responsavel
    if (quem.tipo === 'eu') return 'Eu'
    if (quem.tipo === 'nome') return linha(quem.nome)
    return linha(nomes.contatos.get(quem.contatoId) ?? 'Contato')
  }
  const descrever = (tarefa: Tarefa): string => {
    const partes = [tarefa.id.slice(0, ID_CURTO), linha(tarefa.titulo), tarefa.prazo ? `prazo ${diaMes(tarefa.prazo)}` : 'sem prazo', `responsável: ${responsavel(tarefa)}`]
    const { oportunidadeId, contatoIds, meetingId } = tarefa.vinculos
    const oportunidade = oportunidadeId === null ? undefined : nomes.oportunidades.get(oportunidadeId)
    if (oportunidade) partes.push(`oportunidade: ${linha(oportunidade)}`)
    const contatos = contatoIds.map((id) => nomes.contatos.get(id)).filter((nome) => nome !== undefined).map(linha)
    if (contatos.length) partes.push(`contatos: ${contatos.join(', ')}`)
    const reuniao = meetingId === null ? undefined : nomes.reunioes.get(meetingId)
    if (reuniao) partes.push(`reunião: ${linha(reuniao)}`)
    return `- ${partes.join(' · ')}`
  }

  const saida: string[] = [
    '# Tarefas',
    '',
    `As tarefas abertas do app em ${diaMes(hoje)}/${hoje.slice(0, 4)}, com prazo, responsável e vínculos; o id curto identifica cada uma. Para citar uma tarefa, escreva [Tarefa · <título>].`,
  ]
  const grupos = particao(tarefas, hoje)
  const secoes: [string, Tarefa[]][] = [
    ['Vencidas', grupos.vencidas],
    ['Hoje', grupos.hoje],
    ['Próximas', grupos.proximas],
    ['Sem prazo', grupos.semPrazo],
  ]
  let restam = TAREFAS_MD_MAX
  for (const [titulo, lista] of secoes) {
    saida.push('', `## ${titulo}`, '')
    if (lista.length === 0) {
      saida.push('Nenhuma.')
      continue
    }
    const cabem = lista.slice(0, restam)
    restam -= cabem.length
    saida.push(...cabem.map(descrever))
    // Lista cortada no limite: o modelo precisa saber que há mais, para não afirmar que a seção está vazia.
    if (cabem.length < lista.length) saida.push(`… e mais ${lista.length - cabem.length} (lista truncada).`)
  }

  saida.push('', '## Lembretes', '')
  const comAviso = tarefas
    .filter((tarefa) => tarefa.status === 'aberta' && tarefa.lembreteEm !== null)
    .sort((a, b) => (a.lembreteEm as number) - (b.lembreteEm as number))
  if (comAviso.length === 0) saida.push('Nenhum lembrete.')
  for (const tarefa of comAviso) {
    const avisou = tarefa.lembreteDisparadoEm === null ? '' : ' · já avisou'
    saida.push(`- ${tarefa.id.slice(0, ID_CURTO)} · ${linha(tarefa.titulo)} · aviso ${diaHora(tarefa.lembreteEm as number, timeZone)}${avisou}`)
  }
  return `${saida.join('\n')}\n`
}
