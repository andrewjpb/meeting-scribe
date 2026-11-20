// Contrato 83: scripts/export-tokens.mjs copia tokens.css e base.css para docs/telas/ds/lap-reunioes/tokens.json. O
// teste roda o exportador numa pasta temporária, confere que o JSON reflete o CSS (densidade, cores dos dois temas,
// escala de texto), que duas rodadas dão o mesmo arquivo e que o tokens.json do repositório está em dia.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../scripts/export-tokens.mjs')
const COMMITTED = resolve(__dirname, '../../../docs/telas/ds/lap-reunioes/tokens.json')
const dir = mkdtempSync(join(tmpdir(), 'export-tokens-'))

function exportTo(name: string): string {
  const out = join(dir, name)
  execFileSync(process.execPath, [SCRIPT, out], { stdio: 'pipe' })
  return readFileSync(out, 'utf8')
}

interface Tokens {
  cores: { claro: Record<string, string>; escuro: Record<string, string>; comuns: Record<string, string> }
  espacos: Record<string, string>
  raios: Record<string, string>
  densidade: Record<string, string>
  barraLateral: Record<string, string>
  larguras: Record<string, string>
  texto: Record<string, { 'font-size': string; 'line-height': string }>
  estilos: Record<string, Record<string, string>>
}

const first = exportTo('a.json')
const tokens = JSON.parse(first) as Tokens

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('export-tokens', () => {
  it('leva a densidade de tokens.css', () => {
    expect(tokens.densidade).toEqual({
      'control-h': '32px',
      'control-compact-h': '28px',
      'row-h': '44px',
      'row-compact-h': '32px',
      'panel-head-h': '44px',
      'page-x': '32px',
      'page-top': '20px',
    })
    expect(tokens.barraLateral).toEqual({ 'side-row': '32px', 'side-subrow': '28px', 'side-indent': '28px' })
    expect(tokens.larguras['sidebar-width']).toBe('224px')
    expect(tokens.larguras['settings-control-width']).toBe('340px')
  })

  it('leva as cores dos dois temas com as mesmas variáveis', () => {
    expect(tokens.cores.claro['bg']).toBe('#ffffff')
    expect(tokens.cores.escuro['bg']).toBe('#061a3d')
    expect(tokens.cores.claro['accent']).toBe('#1e5bb8')
    expect(Object.keys(tokens.cores.escuro)).toEqual(Object.keys(tokens.cores.claro))
    expect(tokens.cores.claro).not.toHaveProperty('color-scheme')
    expect(tokens.cores.comuns['logo-dot']).toBe('#3b82f6')
  })

  it('leva espaços, raios, a escala de texto e o rótulo de seção', () => {
    expect(Object.values(tokens.espacos)).toEqual(['4px', '8px', '12px', '16px', '24px', '32px', '48px', '64px'])
    expect(tokens.raios).toEqual({ 'radius-control': '4px', 'radius-panel': '6px' })
    expect(tokens.texto['13']).toEqual({ 'font-size': '13px', 'line-height': '20px' })
    expect(tokens.texto['20']).toEqual({ 'font-size': '20px', 'line-height': '26px' })
    expect(tokens.estilos['label']).toMatchObject({ 'font-size': '11px', 'font-weight': '500' })
    expect(tokens.estilos['label']).not.toHaveProperty('text-transform')
  })

  it('é determinístico e o tokens.json do repositório está em dia', () => {
    expect(exportTo('b.json')).toBe(first)
    expect(readFileSync(COMMITTED, 'utf8')).toBe(first)
  })
})
