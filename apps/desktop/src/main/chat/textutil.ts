// Word, RTF e ODT em texto para o Assistente (contrato 166, pastas-assistente D4): o `textutil` do macOS, sem shell, só
// lendo (`-stdout`, nunca `-output`: nada é gravado ao lado do arquivo). Tempo e saída com teto; o erro tem mensagem fixa,
// sem o caminho.
import { execFile } from 'node:child_process'

export const TEXTUTIL_PATH = '/usr/bin/textutil'
const OUTPUT_MAX_BYTES = 8 * 1024 * 1024

/** O texto do documento, cortado em `maxChars`. Falha, tempo esgotado ou "Parar": lança erro com mensagem fixa. */
export function textutilToText(path: string, opts: { timeoutMs: number; maxChars: number; signal?: AbortSignal | undefined }): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      TEXTUTIL_PATH,
      ['-convert', 'txt', '-stdout', path],
      { encoding: 'utf8', timeout: opts.timeoutMs, maxBuffer: OUTPUT_MAX_BYTES, ...(opts.signal ? { signal: opts.signal } : {}) },
      (error, stdout, stderr) => {
        // O `textutil` sai com 0 mesmo sem abrir o arquivo ("Error reading …" no stderr).
        if (error || /^Error\b/m.test(stderr)) reject(new Error('não foi possível extrair o texto do documento'))
        else resolve(stdout.length > opts.maxChars ? stdout.slice(0, opts.maxChars) : stdout)
      },
    )
  })
}
