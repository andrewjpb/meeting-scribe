// Sugestões de tarefa (contrato 121, R26): o que o resumo e a análise das reuniões e os insights das conversas do
// WhatsApp apontam como coisa minha a fazer e que ainda não virou tarefa. Puro: o serviço junta as fontes e chama
// `sugestoesDeTarefa` a cada pedido da aba; nada é gravado além do que a pessoa ignora.
import type { SummaryTask } from './meeting-summary'
import { SUGESTOES_DIAS, SUGESTOES_MAX, type SugestaoIgnorada, type SugestaoTarefa, type Tarefa } from './tarefas'
import { casaComAnalise, casaComResumo, chaveSugestao, prazoDoQuando, slugTexto } from './tarefas-logic'
import { semAcento } from './funil-logic'

const DIA_MS = 86_400_000

export interface SugestoesInput {
  reunioes: readonly {
    id: string
    titulo: string
    /** ISO 8601. */
    startedAt: string
    resumo: readonly SummaryTask[] | null
    toConfirm: readonly { text: string; owner?: string | undefined }[]
  }[]
  conversas: readonly {
    chatId: string
    nome: string
    lastAt: number | null
    pendenciasMinhas: readonly string[]
    compromissos: readonly { texto: string; quando?: string | undefined }[]
  }[]
  tarefas: readonly Tarefa[]
  ignorados: readonly SugestaoIgnorada[]
  sugerirDasReunioes: boolean
  hoje: string
  now: number
}

/** "Você", sem acento e sem caixa. */
const ehVoce = (owner: string | null | undefined): boolean => semAcento(owner ?? '').trim().toLowerCase() === 'voce'

export function sugestoesDeTarefa(input: SugestoesInput): SugestaoTarefa[] {
  const desde = input.now - SUGESTOES_DIAS * DIA_MS
  const ignorados = new Set(input.ignorados.map((item) => item.chave))
  /**
   * Títulos já usados por tarefas de cada reunião e conversa (`reuniao:<id>` / `whatsapp:<id>`), pelo slug. A tarefa que
   * veio da análise (contrato 131) conta para a reunião dela, como a do resumo.
   */
  const titulos = new Map<string, Set<string>>()
  for (const tarefa of input.tarefas) {
    const { origem } = tarefa
    const ref = origem.tipo === 'reuniao' || origem.tipo === 'analise' ? `reuniao:${origem.meetingId}` : origem.tipo === 'whatsapp' ? `whatsapp:${origem.chatId}` : null
    if (ref === null) continue
    const lista = titulos.get(ref) ?? new Set<string>()
    lista.add(slugTexto(tarefa.titulo))
    titulos.set(ref, lista)
  }
  const jaVirou = (ref: string, texto: string): boolean => titulos.get(ref)?.has(slugTexto(texto)) ?? false

  const candidatas: SugestaoTarefa[] = []
  if (input.sugerirDasReunioes) {
    for (const reuniao of input.reunioes) {
      const em = Date.parse(reuniao.startedAt)
      if (!Number.isFinite(em) || em < desde) continue
      const ref = `reuniao:${reuniao.id}`
      for (const tarefa of reuniao.resumo ?? []) {
        if (tarefa.owner !== 'Você' || jaVirou(ref, tarefa.task)) continue
        if (input.tarefas.some((existente) => casaComResumo(existente, reuniao.id, tarefa.task))) continue
        candidatas.push({
          chave: chaveSugestao('reuniao', reuniao.id, tarefa.task),
          texto: tarefa.task,
          origem: { tipo: 'reuniao', meetingId: reuniao.id, titulo: reuniao.titulo },
          em,
          prazo: tarefa.dueIso ?? null,
          responsavelTexto: tarefa.owner,
        })
      }
      for (const item of reuniao.toConfirm) {
        const owner = item.owner?.trim() ?? ''
        if ((owner && !ehVoce(owner)) || jaVirou(ref, item.text)) continue
        // Contrato 131 (R1): a adicionada guarda o texto da análise na origem; com o título mudado depois, não volta.
        if (input.tarefas.some((existente) => casaComAnalise(existente, reuniao.id, item.text))) continue
        candidatas.push({
          chave: chaveSugestao('analise', reuniao.id, item.text),
          texto: item.text,
          origem: { tipo: 'analise', meetingId: reuniao.id, titulo: reuniao.titulo },
          em,
          prazo: null,
          responsavelTexto: owner || null,
        })
      }
    }
  }
  for (const conversa of input.conversas) {
    if (conversa.lastAt === null || conversa.lastAt < desde) continue
    const ref = `whatsapp:${conversa.chatId}`
    const itens = [...conversa.pendenciasMinhas.map((texto) => ({ texto, quando: undefined as string | undefined })), ...conversa.compromissos]
    for (const item of itens) {
      if (jaVirou(ref, item.texto)) continue
      candidatas.push({
        chave: chaveSugestao('whatsapp', conversa.chatId, item.texto),
        texto: item.texto,
        origem: { tipo: 'whatsapp', chatId: conversa.chatId, nome: conversa.nome },
        em: conversa.lastAt,
        prazo: prazoDoQuando(item.quando, input.hoje),
        responsavelTexto: null,
      })
    }
  }

  const vistas = new Set<string>()
  const saida: SugestaoTarefa[] = []
  for (const sugestao of candidatas.sort((a, b) => b.em - a.em)) {
    if (ignorados.has(sugestao.chave) || vistas.has(sugestao.chave)) continue
    vistas.add(sugestao.chave)
    saida.push(sugestao)
    if (saida.length === SUGESTOES_MAX) break
  }
  return saida
}
