// Lê tokens.css e a tabela de cores de design.md: toda variável da tabela existe nos dois temas e
// cada par de contraste exigido por design.md passa (WCAG 2.x, luminância relativa).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const TOKENS = readFileSync(resolve(__dirname, '../src/renderer/src/design/tokens.css'), 'utf8')
const DESIGN = readFileSync(resolve(__dirname, '../../../docs/specs/desktop-shell/design.md'), 'utf8')

type Theme = 'light' | 'dark'

function block(selectorPattern: RegExp): string {
  const match = selectorPattern.exec(TOKENS)
  if (!match) throw new Error(`bloco ${selectorPattern} não encontrado em tokens.css`)
  const start = match.index + match[0].length
  return TOKENS.slice(start, TOKENS.indexOf('}', start))
}

function variables(css: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name && value) vars.set(name, value.trim())
  }
  return vars
}

const THEMES: Record<Theme, Map<string, string>> = {
  light: variables(block(/:root,\s*\[data-theme='light'\]\s*\{/)),
  dark: variables(block(/\[data-theme='dark'\]\s*\{/)),
}

/** Variáveis da tabela "Cores" de design.md (primeira coluna). */
const TABLE_VARIABLES = [...DESIGN.matchAll(/^\|\s*`(--[\w-]+)`\s*\|/gm)].map((m) => m[1] as string)

function parseHex(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1]
  if (!hex) throw new Error(`esperava cor #rrggbb, veio ${value}`)
  const n = Number.parseInt(hex, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number): number => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: string, b: string): number {
  const la = luminance(parseHex(a))
  const lb = luminance(parseHex(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

interface Rule {
  fg: string
  min: number
  surfaces: string[]
}

/**
 * Regras da frase "Contraste mínimo: ..." de design.md. Cada trecho entre `;` diz quais variáveis,
 * a razão mínima (`7:1`, `4,5:1`) e, depois de "sobre", as superfícies. Um trecho pode ter mais de
 * uma razão (`--side-text` 7:1 e `--side-muted` 4,5:1 sobre `--side-bg`): cada razão vale para as
 * variáveis citadas antes dela. Trecho sem "sobre" (`--text-faint` 3:1) usa `--bg` e `--bg-raised`,
 * as superfícies de texto.
 */
function contrastRules(design: string): Rule[] {
  const sentence = /^Contraste mínimo:(.*)$/m.exec(design)?.[1]
  if (!sentence) throw new Error('frase "Contraste mínimo:" não encontrada em design.md')
  const body = sentence.split('. ')[0] ?? ''
  const rules: Rule[] = []
  for (const clause of body.split(';')) {
    const [left = '', right] = clause.split(/\bsobre\b/)
    const surfaces = right ? [...right.matchAll(/`(--[\w-]+)`/g)].map((m) => m[1] as string) : ['--bg', '--bg-raised']
    let pending: string[] = []
    for (const [, name, ratio] of left.matchAll(/`(--[\w-]+)`|(\d+(?:,\d+)?):1/g)) {
      if (name) pending.push(name)
      else if (ratio) {
        const min = Number(ratio.replace(',', '.'))
        for (const fg of pending) rules.push({ fg, min, surfaces })
        pending = []
      }
    }
  }
  return rules
}

const RULES = contrastRules(DESIGN)

describe('tokens.css', () => {
  it('a tabela de design.md foi lida', () => {
    expect(TABLE_VARIABLES).toHaveLength(20)
  })

  it('as regras de contraste de design.md foram lidas', () => {
    const byVariable = Object.fromEntries(RULES.map((rule) => [rule.fg, `${rule.min}:1 sobre ${rule.surfaces.join(', ')}`]))
    expect(byVariable).toEqual({
      '--text': '7:1 sobre --bg, --bg-raised, --bg-sunken',
      '--title': '7:1 sobre --bg, --bg-raised, --bg-sunken',
      '--text-muted': '4.5:1 sobre --bg, --bg-raised',
      '--accent': '4.5:1 sobre --bg, --bg-raised',
      '--mic': '4.5:1 sobre --bg, --bg-raised',
      '--sys': '4.5:1 sobre --bg, --bg-raised',
      '--rec': '4.5:1 sobre --bg, --bg-raised',
      '--ok': '4.5:1 sobre --bg, --bg-raised',
      '--text-faint': '3:1 sobre --bg, --bg-raised',
      '--on-accent': '4.5:1 sobre --accent',
      '--side-text': '7:1 sobre --side-bg',
      '--side-muted': '4.5:1 sobre --side-bg',
    })
  })

  it.each(['light', 'dark'] as const)('define todas as variáveis da tabela no tema %s', (theme) => {
    const missing = TABLE_VARIABLES.filter((name) => !THEMES[theme].has(name))
    expect(missing).toEqual([])
  })

  const pairs = (['light', 'dark'] as const).flatMap((theme) =>
    RULES.flatMap(({ fg, min, surfaces }) => surfaces.map((bg) => ({ theme, fg, bg, min }))),
  )

  it.each(pairs)('$theme: $fg sobre $bg ≥ $min:1', ({ theme, fg, bg, min }) => {
    const vars = THEMES[theme]
    const ratio = contrast(vars.get(fg) ?? '', vars.get(bg) ?? '')
    expect(ratio, `${fg} sobre ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min)
  })

  it('desliga animação e transição com prefers-reduced-motion: reduce', () => {
    const media = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/.exec(TOKENS)?.[1] ?? ''
    expect(media).toMatch(/animation:\s*none\s*!important/)
    expect(media).toMatch(/transition:\s*none\s*!important/)
  })
})
