// Contrato 158: as conferências de privacidade dos checks do Painel de e-mail no smoke, sem Electron (os testes as
// importam). O `detail` só com `chave=valor` de números e booleanos (R36) e nenhuma linha de log com dado das
// mensagens falsas (R7).

/** `analyzed=6 attention=6 error=false`: rótulos sem acento, valores só inteiros ou `true`/`false`. */
const NUMERIC_DETAIL = /^[A-Za-z]+=(?:\d+|true|false)(?: [A-Za-z]+=(?:\d+|true|false))*$/

/** O `detail` só tem `chave=valor` numéricos ou booleanos, separados por um espaço. */
export function numericDetail(detail: string): boolean {
  return NUMERIC_DETAIL.test(detail)
}

/** Quantas linhas de log contêm algum dos textos (assunto, remetente, endereço), sem diferença de caixa. */
export function leakedLines(lines: readonly string[], needles: readonly string[]): number {
  const wanted = needles.map((needle) => needle.trim().toLowerCase()).filter(Boolean)
  return lines.filter((line) => {
    const lower = line.toLowerCase()
    return wanted.some((needle) => lower.includes(needle))
  }).length
}
