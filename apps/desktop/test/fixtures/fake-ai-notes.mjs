// Lote falso da IA anotando ao vivo (contrato 30) que o `claude` falso e o agente ACP falso devolvem: montado só com o
// pedido, sempre igual para o mesmo pedido. Cria um card por ciclo, o primeiro da lista abaixo cujo título ainda não
// está em <titulos_existentes>, com a primeira fala do trecho; e resolve o primeiro card de <cards_abertos>, com a
// última fala como motivo. Assim o primeiro ciclo cria "Confirmar a janela de manutenção" e o segundo o resolve e cria
// "Quem aprova o orçamento da réplica".

/** Espera antes de responder: dá tempo de a tela mostrar "anotando…". */
export const FAKE_AI_NOTES_DELAY_MS = 600

export const FAKE_AI_NOTES_TITLES = ['Confirmar a janela de manutenção', 'Quem aprova o orçamento da réplica', 'Plano de volta por escrito']

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const block = (content, tag) => new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(content)?.[1] ?? ''

/** O objeto JSON do lote para o pedido `content` (o texto do stdin ou do `session/prompt`). */
export function fakeAiNotes(content) {
  const lines = block(content, 'transcricao')
    .split('\n')
    .map((line) => /^\[([\d:]+)\] ([^:]+): (.*)$/.exec(line))
    .filter(Boolean)
    .map((match) => ({ at: match[1], speaker: match[2], text: unescape(match[3]) }))
  const known = new Set(
    block(content, 'titulos_existentes')
      .split('\n')
      .map((line) => unescape(line).trim().toLowerCase())
      .filter(Boolean),
  )
  const open = [...block(content, 'cards_abertos').matchAll(/^\[([^\]]+)\]/gm)].map((match) => match[1])
  const first = lines[0]
  const last = lines.at(-1)
  const title = FAKE_AI_NOTES_TITLES.find((candidate) => !known.has(candidate.toLowerCase()))
  return {
    novos: first && title ? [{ titulo: title, descricao: `Fala de ${first.speaker}: ${first.text}`, at: first.at }] : [],
    resolvidos: open.length && last ? [{ id: open[0], motivo: `Respondido: ${last.text}` }] : [],
  }
}
