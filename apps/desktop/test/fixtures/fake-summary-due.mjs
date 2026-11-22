// Contrato 126 (R21): o `dueIso` das tarefas do resumo falso (`fake-claude.mjs` e `fake-acp-agent.mjs`). O "sexta-feira"
// dito vira a próxima sexta depois do dia do bloco `<data_da_reuniao>AAAA-MM-DD (dia da semana)</data_da_reuniao>`
// do pedido (a reunião numa sexta leva à da semana seguinte); sem o bloco, `null`, como o prompt pede.

/** A próxima sexta-feira depois do dia da reunião, em `AAAA-MM-DD`; sem `<data_da_reuniao>` no pedido, `null`. */
export function fridayAfterMeeting(input) {
  const day = /<data_da_reuniao>(\d{4}-\d{2}-\d{2})\b/.exec(input)?.[1]
  if (!day) return null
  const date = new Date(`${day}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return null
  const ahead = (5 - date.getUTCDay() + 7) % 7 || 7
  date.setUTCDate(date.getUTCDate() + ahead)
  return date.toISOString().slice(0, 10)
}
