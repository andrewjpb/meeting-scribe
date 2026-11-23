// Contrato 156 (CA10, R7): teste estático. Nos dois arquivos da passada, nenhuma chamada de log, `console.*`, `Error(` ou
// `lastRun.error` leva o assunto, o remetente, a prévia, a resposta ou o motivo de um e-mail.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(import.meta.dirname, '..', '..', 'src', 'main')
const FILES = ['email/dashboard.ts', 'claude-cli/email-dashboard.ts']
const PROIBIDO = /subject|\bfrom\b|preview|reply|reason|assunto|remetente|previa|resposta|motivo/i

/** Os argumentos de cada chamada que começa em `start` (até o parêntese que fecha, respeitando strings simples). */
function argumentsOf(text: string, start: RegExp): string[] {
  const found: string[] = []
  for (const match of text.matchAll(new RegExp(start.source, 'g'))) {
    let index = (match.index ?? 0) + match[0].length
    let depth = 1
    const begin = index
    while (index < text.length && depth > 0) {
      const char = text[index]
      if (char === '(') depth++
      else if (char === ')') depth--
      index++
    }
    found.push(text.slice(begin, index - 1))
  }
  return found
}

describe('Painel de e-mail: nada de e-mail em log nem erro (contrato 156, CA10)', () => {
  for (const file of FILES) {
    const text = readFileSync(join(SRC, file), 'utf8')
    it(file, () => {
      const calls = [
        ...argumentsOf(text, /\blog\(/),
        ...argumentsOf(text, /\bconsole\.\w+\(/),
        ...argumentsOf(text, /\bError\(/),
        ...argumentsOf(text, /dashboardRunError\(/),
      ]
      for (const call of calls) expect(call, call).not.toMatch(PROIBIDO)
      // `lastRun.error` só recebe o texto fixo.
      for (const match of text.matchAll(/error: ([^,}\n]+)/g)) expect(match[1], match[0]).not.toMatch(PROIBIDO)
      // As mensagens dos erros do "Mover" são fixas (sem `${`).
      const moveErrors = /DASHBOARD_MOVE_ERRORS = \{([\s\S]*?)\} as const/.exec(text)?.[1]
      if (moveErrors !== undefined) expect(moveErrors).not.toContain('${')
    })
  }
  it('o serviço só loga pelo `deps.log`, e numa linha só de números (fora a falha genérica)', () => {
    const text = readFileSync(join(SRC, 'email/dashboard.ts'), 'utf8')
    expect(text).not.toMatch(/console\./)
    expect(argumentsOf(text, /deps\.log\(/)).toHaveLength(2)
  })
})
