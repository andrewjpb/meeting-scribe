// Passo 7 dos gates (scripts/check-shapes.sh): cada caso vira um arquivo numa pasta temporária e o
// script tem que reprovar ou aprovar.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = resolve(__dirname, '../scripts/check-shapes.sh')

function check(file: string, content: string): number {
  const dir = mkdtempSync(join(tmpdir(), 'check-shapes-'))
  try {
    writeFileSync(join(dir, file), content)
    return spawnSync('bash', [SCRIPT, dir], { encoding: 'utf8' }).status ?? -1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('check-shapes.sh', () => {
  it.each([
    ['a.css', '.x { box-shadow: 0 1px 2px black; }'],
    ['a.css', '.x {\n  box-shadow: 0 0 0 1px var(--line);\n}'],
    ['a.css', '.x { box-shadow: none; } .y { box-shadow: 0 1px 0 red; }'],
    ['a.tsx', '<div style={{ boxShadow: "0 1px 2px black" }} />'],
    ['a.tsx', "<div style={{ boxShadow: shadow }} />"],
    ['a.tsx', "<div style={{ borderRadius: 8 }} />"],
    ['a.tsx', "<div style={{ borderRadius: '12px' }} />"],
    ['a.tsx', "<div style={{ borderTopLeftRadius: 10, color: 'x' }} />"],
    ['a.tsx', "<div style={{ borderRadius: '50%' }} />"],
    ['a.tsx', "<div style={{ borderRadius: '1rem' }} />"],
    ['a.css', '.dot { border-radius: 50%; }'],
    ['a.css', '.card { border-radius: 0.5rem; }'],
    ['a.css', '.card { border-radius: 8px; }'],
    ['a.css', '.card { border-radius: 4px 8px; }'],
    ['a.css', '.card { border-radius: 4px 4px 12px 4px; }'],
    ['a.tsx', "<div style={{ borderRadius: '4px 8px' }} />"],
    ['a.tsx', '<div className="rounded-[50%]" />'],
    ['a.tsx', '<div className="rounded-[1rem]" />'],
    ['a.tsx', '<div className="rounded-t-[12px]" />'],
    ['a.tsx', '<div className="rounded-lg" />'],
    ['a.tsx', '<div className="rounded-full" />'],
    ['a.tsx', '<div className="shadow-sm" />'],
    ['a.tsx', '<div className="ring-2" />'],
  ])('reprova %s: %s', (file, content) => {
    expect(check(file, content)).toBe(1)
  })

  it.each([
    ['a.css', '.x { box-shadow: none; }'],
    ['a.css', '.x {\n  box-shadow: none !important;\n}'],
    ['a.css', '.x { border-radius: var(--radius-panel); }'],
    ['a.css', '.x { border-radius: 4px; } .y { border-radius: 6px; }'],
    ['a.css', '.x { border-radius: 4px 6px 4px 2px; }'],
    ['a.tsx', "<div style={{ borderRadius: '4px 6px' }} />"],
    ['a.tsx', "<div style={{ boxShadow: 'none' }} />"],
    ['a.tsx', "<div style={{ borderRadius: 4 }} />"],
    ['a.tsx', "<div style={{ borderRadius: '6px' }} />"],
    ['a.tsx', '<div className="rounded-[var(--radius-control)] rounded-[2px] shadow-none ring-0" />'],
    ['a.tsx', '<div className="w-[50%] mt-[1rem]" />'],
  ])('aprova %s: %s', (file, content) => {
    expect(check(file, content)).toBe(0)
  })
})
