// O `FUNIL.md` (contrato 115, R41, D16): o gerador único do texto que o modelo lê, usado pelas execuções de agente
// com "Pode ler o funil" (R45) e pela fonte Funil do Assistente (contrato 117). Puro: recebe a view do serviço, os
// títulos das reuniões, o relógio e o fuso, e devolve o Markdown. Arquivada nunca entra (R27). Contrato 124 (R16): a
// linha "Próximo passo" virou "Tarefas abertas", com as tarefas recebidas na entrada.
import type { Etapa, FunilView, Oportunidade } from '../../shared/funil'
import { esfriada, formatarBRL } from '../../shared/funil-logic'
import type { Tarefa } from '../../shared/tarefas'
import { abertasDaOportunidade } from '../../shared/tarefas-logic'

const DIA_MS = 86_400_000
/** Ganhas e perdidas que entram, pelo `fechadoEm`. */
export const FUNIL_MD_FECHADAS_DIAS = 90
export const FUNIL_MD_CONTATOS_MAX = 500
export const FUNIL_MD_TRUNCADA = 'lista truncada; peça pelo nome'
const VAZIO = '—'
/** Tarefas abertas listadas por oportunidade (R16). */
export const FUNIL_MD_TAREFAS_MAX = 5

/** `AAAA-MM-DD` de um instante no fuso pedido. */
export function diaNoFuso(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at))
}

/** `AAAA-MM-DD` como `DD/MM/AAAA`; fora do formato, como veio. */
function dataBR(dia: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia)
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : dia
}

/** `AAAA-MM-DD` como `DD/MM`; fora do formato, como veio. */
function diaMes(dia: string): string {
  const partes = /^\d{4}-(\d{2})-(\d{2})$/.exec(dia)
  return partes ? `${partes[2]}/${partes[1]}` : dia
}

/** `DD/MM/AAAA HH:MM` no fuso pedido. */
function dataHora(at: number, timeZone: string): string {
  const partes = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const parte = (tipo: Intl.DateTimeFormatPartTypes): string => partes.find((item) => item.type === tipo)?.value ?? ''
  return `${parte('day')}/${parte('month')}/${parte('year')} ${parte('hour')}:${parte('minute')}`
}

/** Uma linha só: quebra de linha vira espaço (o texto da pessoa não abre seção nova no Markdown). */
const linha = (texto: string): string => texto.replace(/\s*\n\s*/g, ' ').trim()

const tipoDaEtapa = (etapa: Etapa): string => (etapa.tipo === 'aberta' ? 'aberta' : 'final')

export function funilMarkdown(input: { view: FunilView; tarefas: readonly Tarefa[]; diasEsfriar: number; reunioes: ReadonlyMap<string, string>; now: number; timeZone: string }): string {
  const { view, tarefas, diasEsfriar, reunioes, now, timeZone } = input
  const { state } = view
  const etapas = [...state.etapas].sort((a, b) => a.ordem - b.ordem)
  const etapaPorId = new Map(etapas.map((etapa) => [etapa.id, etapa]))
  const ordemDaEtapa = new Map(etapas.map((etapa, indice) => [etapa.id, indice]))
  const empresaPorId = new Map(state.empresas.map((empresa) => [empresa.id, empresa.nome]))
  const contatoPorId = new Map(state.contatos.map((contato) => [contato.id, contato]))
  const empresaDe = (id: string | null): string => (id === null ? VAZIO : linha(empresaPorId.get(id) ?? VAZIO))
  // As tarefas de cada oportunidade separadas uma vez (o funil pode ter milhares de oportunidades e de tarefas).
  const tarefasPorOportunidade = new Map<string, Tarefa[]>()
  for (const tarefa of tarefas) {
    const id = tarefa.vinculos.oportunidadeId
    if (id === null) continue
    const lista = tarefasPorOportunidade.get(id)
    if (lista) lista.push(tarefa)
    else tarefasPorOportunidade.set(id, [tarefa])
  }
  const ultimaDe = (oportunidade: Oportunidade): number => view.ultimas[oportunidade.id] ?? Math.max(oportunidade.movidoEm, oportunidade.atualizadoEm)

  const saida: string[] = ['# Funil de vendas', '', `Gerado em ${dataHora(now, timeZone)} (${timeZone}).`, '', '## Etapas', '']
  for (const etapa of etapas) saida.push(`- ${linha(etapa.nome)} (${tipoDaEtapa(etapa)})`)

  saida.push('', '## Oportunidades abertas', '')
  const abertas = state.oportunidades
    .filter((oportunidade) => !oportunidade.arquivado && etapaPorId.get(oportunidade.etapaId)?.tipo === 'aberta')
    .sort((a, b) => (ordemDaEtapa.get(a.etapaId) ?? 0) - (ordemDaEtapa.get(b.etapaId) ?? 0) || a.ordem - b.ordem)
  if (abertas.length === 0) saida.push('Nenhuma.')
  for (const oportunidade of abertas) {
    const etapa = etapaPorId.get(oportunidade.etapaId) as Etapa
    const contatos = oportunidade.contatoIds
      .map((id) => contatoPorId.get(id))
      .filter((contato) => contato !== undefined)
      .map((contato) => (contato.emails[0] ? `${linha(contato.nome)} <${contato.emails[0]}>` : linha(contato.nome)))
    const abertasDela = abertasDaOportunidade(tarefasPorOportunidade.get(oportunidade.id) ?? [], oportunidade.id)
      .slice(0, FUNIL_MD_TAREFAS_MAX)
      .map((tarefa) => (tarefa.prazo ? `${linha(tarefa.titulo)} (até ${diaMes(tarefa.prazo)})` : linha(tarefa.titulo)))
    const ultima = view.ultimas[oportunidade.id]
    const ligadas = oportunidade.meetingIds.map((id) => `${id} · ${linha(reunioes.get(id) ?? 'Reunião apagada')}`)
    saida.push(
      `### ${linha(oportunidade.titulo)} · id: ${oportunidade.id}`,
      '',
      `- Empresa: ${empresaDe(oportunidade.empresaId)}`,
      `- Contatos: ${contatos.length ? contatos.join(', ') : VAZIO}`,
      `- Etapa: ${linha(etapa.nome)}`,
      `- Valor: ${formatarBRL(oportunidade.valor)}`,
      `- Previsão: ${oportunidade.previsao ? dataBR(oportunidade.previsao) : VAZIO}`,
      `- Tarefas abertas: ${abertasDela.length ? abertasDela.join('; ') : VAZIO}`,
      `- Última interação: ${ultima === undefined ? VAZIO : dataHora(ultima, timeZone)}`,
    )
    if (esfriada(oportunidade, etapa, ultimaDe(oportunidade), diasEsfriar, now)) saida.push('- **esfriada**')
    saida.push(`- Reuniões: ${ligadas.length ? ligadas.join('; ') : VAZIO}`, '')
  }
  if (abertas.length) saida.pop()

  saida.push('', `## Ganhas e perdidas nos últimos ${FUNIL_MD_FECHADAS_DIAS} dias`, '')
  const desde = now - FUNIL_MD_FECHADAS_DIAS * DIA_MS
  const fechadas = state.oportunidades
    .filter((oportunidade) => {
      const tipo = etapaPorId.get(oportunidade.etapaId)?.tipo
      return !oportunidade.arquivado && (tipo === 'ganho' || tipo === 'perdido') && oportunidade.fechadoEm !== null && oportunidade.fechadoEm >= desde
    })
    .sort((a, b) => (b.fechadoEm ?? 0) - (a.fechadoEm ?? 0))
  if (fechadas.length === 0) saida.push('Nenhuma.')
  for (const oportunidade of fechadas) {
    const etapa = etapaPorId.get(oportunidade.etapaId) as Etapa
    const motivo = etapa.tipo === 'perdido' && oportunidade.motivoPerda ? ` · motivo: ${linha(oportunidade.motivoPerda)}` : ''
    saida.push(`- ${linha(oportunidade.titulo)} · id: ${oportunidade.id} · ${linha(etapa.nome)} · ${formatarBRL(oportunidade.valor)} · ${dataBR(diaNoFuso(oportunidade.fechadoEm as number, timeZone))}${motivo}`)
  }

  saida.push('', '## Contatos', '')
  const contatos = state.contatos.filter((contato) => !contato.arquivado).sort((a, b) => b.atualizadoEm - a.atualizadoEm)
  if (contatos.length === 0) saida.push('Nenhum.')
  for (const contato of contatos.slice(0, FUNIL_MD_CONTATOS_MAX)) {
    saida.push(`- ${contato.id} · ${linha(contato.nome)} · ${empresaDe(contato.empresaId)} · ${contato.emails.join(', ') || VAZIO} · ${contato.telefones.join(', ') || VAZIO}`)
  }
  if (contatos.length > FUNIL_MD_CONTATOS_MAX) saida.push('', FUNIL_MD_TRUNCADA)
  return `${saida.join('\n')}\n`
}
