// Correção falsa da mensagem do WhatsApp (contrato 35) do `claude` falso e do agente ACP falso: só texto, montado com a
// mensagem do pedido (dentro de <mensagem></mensagem>, escapada), sempre igual para o mesmo pedido. "oi tudo bem" vira
// "Oi, tudo bem?" (o smoke confere essa); o resto ganha a primeira letra maiúscula e ponto final. Para os testes:
// "[vazio]" responde nada, "[gigante]" responde um texto enorme, "[cercas]" responde entre cercas com a etiqueta em
// volta e "[devagar]" espera 3 s antes (o teste usa um prazo menor).

/** Espera da mensagem com "[devagar]". */
export const FAKE_CORRECT_SLOW_MS = 3000

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

export function fakeCorrection(content) {
  const raw = /<mensagem>\n([\s\S]*?)\n<\/mensagem>/.exec(content)?.[1] ?? ''
  const text = unescape(raw).trim()
  if (text.includes('[vazio]')) return '   '
  if (text.includes('[gigante]')) return 'texto '.repeat(1000)
  if (text === 'oi tudo bem') return 'Oi, tudo bem?'
  const fixed = `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`
  if (text.includes('[cercas]')) return `\`\`\`\n<mensagem>\n${fixed}\n</mensagem>\n\`\`\``
  return fixed
}

export function isSlowCorrection(content) {
  return content.includes('[devagar]')
}
