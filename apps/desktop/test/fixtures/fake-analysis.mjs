// Análise falsa ("Analisar até agora", contrato 19) que o `claude` falso e o agente ACP falso devolvem:
// montada só com as linhas da transcrição do pedido, como o resumo falso. As perguntas em aberto são as falas
// com "?"; há sempre um item em "Não ficou claro", um em "Para confirmar" e duas perguntas para fazer agora.
// Com análises anteriores no pedido, a primeira ref delas volta em `answered` (a tela a mostra riscada).

/** Espera antes de responder: dá tempo de a gravação e a tradução seguirem enquanto a análise gera. */
export const FAKE_ANALYSIS_DELAY_MS = 1500

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

/** O objeto JSON da análise para o pedido `content` (o texto do stdin ou do `session/prompt`). */
export function fakeAnalysis(content) {
  const body = /<transcricao>\n([\s\S]*?)\n<\/transcricao>/.exec(content)?.[1] ?? ''
  const lines = body
    .split('\n')
    .map((line) => /^\[([\d:]+)\] ([^:]+): (.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ at: match[1], speaker: match[2], text: unescape(match[3]) }))
  const participant = lines.find((line) => line.speaker !== 'Você')?.speaker ?? null
  const asked = lines.filter((line) => line.text.includes('?'))
  const first = lines[0]
  const previous = /<analises_anteriores>\n([\s\S]*?)\n<\/analises_anteriores>/.exec(content)?.[1] ?? ''
  const refs = [...previous.matchAll(/^\[(A\d+-[PNC]\d+)\]/gm)].map((match) => match[1])
  const openQuestions = (asked.length ? asked : first ? [first] : []).slice(0, 3).map((line) => ({ text: line.text, context: `Fala de ${line.speaker}.`, at: line.at }))
  return {
    // Numa segunda análise, a pergunta vira outra: a anterior foi "respondida".
    openQuestions: refs.length ? [{ text: 'Quem aprova o orçamento da réplica?', context: null, at: lines.at(-1)?.at ?? null }] : openQuestions,
    unclearTopics: first ? [{ topic: 'Janela da migração', why: 'A data mudou durante a conversa sem uma conclusão.', at: first.at }] : [],
    toConfirm: first ? [{ text: 'Data exata da janela de manutenção', owner: participant }] : [],
    suggestedQuestions: first ? ['Qual é a data final da janela?', 'Quem confirma com o cliente?'] : [],
    answered: refs.slice(0, 1),
  }
}
