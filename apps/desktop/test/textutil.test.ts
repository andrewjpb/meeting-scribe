// Contrato 166 (pastas-assistente D4, CA4): o `textutil` de verdade num `.docx` gerado por ele mesmo a partir de um
// `.txt` temporário. Sem `/usr/bin/textutil` (fora do macOS), os testes ficam de fora.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TEXTUTIL_PATH, textutilToText } from '../src/main/chat/textutil'

const hasTextutil = existsSync(TEXTUTIL_PATH)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'textutil-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function docx(text: string): string {
  const txt = join(dir, 'origem.txt')
  writeFileSync(txt, text)
  const out = join(dir, 'contrato.docx')
  execFileSync(TEXTUTIL_PATH, ['-convert', 'docx', '-output', out, txt])
  return out
}

describe.skipIf(!hasTextutil)('textutilToText (contrato 166, CA4)', () => {
  it('o texto do .docx, sem gravar nada ao lado', async () => {
    const path = docx('Cláusula 1: vigência 12 meses\n')
    const before = readdirSync(dir).sort()
    expect(await textutilToText(path, { timeoutMs: 20_000, maxChars: 20_000 })).toContain('Cláusula 1: vigência 12 meses')
    expect(readdirSync(dir).sort()).toEqual(before)
  })

  it('corta em maxChars', async () => {
    const path = docx('a'.repeat(500))
    expect((await textutilToText(path, { timeoutMs: 20_000, maxChars: 100 })).length).toBe(100)
  })

  it('arquivo que não abre → erro com mensagem fixa, sem o caminho', async () => {
    const path = join(dir, 'segredo-nao-existe.docx')
    await expect(textutilToText(path, { timeoutMs: 20_000, maxChars: 100 })).rejects.toThrow('não foi possível extrair o texto do documento')
    await expect(textutilToText(path, { timeoutMs: 20_000, maxChars: 100 })).rejects.not.toThrow(/segredo/)
  })

  it('"Parar" (sinal abortado) → erro', async () => {
    const path = docx('texto')
    const abort = new AbortController()
    abort.abort()
    await expect(textutilToText(path, { timeoutMs: 20_000, maxChars: 100, signal: abort.signal })).rejects.toThrow('não foi possível extrair o texto do documento')
  })
})
