// QR code do pareamento (contrato 24): tamanho por versão, localizadores, linhas de tempo, bits de formato e a
// escolha da máscara. A leitura de volta foi conferida com o leitor do macOS (comentário em `qr.ts`).
import { describe, expect, it } from 'vitest'
import { encodeQr } from '../../src/renderer/src/features/whatsapp/qr'

/** Lê os 15 bits de formato da cópia em volta do localizador de cima à esquerda. */
function formatBits(m: boolean[][]): number {
  const at = (x: number, y: number): number => (m[y]?.[x] ? 1 : 0)
  let bits = 0
  for (let i = 0; i <= 5; i++) bits |= at(8, i) << i
  bits |= at(8, 7) << 6
  bits |= at(8, 8) << 7
  bits |= at(7, 8) << 8
  for (let i = 9; i < 15; i++) bits |= at(14 - i, 8) << i
  return bits ^ 0x5412
}

function finderAt(m: boolean[][], x0: number, y0: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3))
      if (m[y0 + y]?.[x0 + x] !== (ring !== 2)) return false
    }
  }
  return true
}

describe('QR code', () => {
  it('escolhe a menor versão que cabe e desenha os padrões fixos', () => {
    for (const [text, size] of [
      ['LAP', 21],
      ['x'.repeat(14), 21],
      ['x'.repeat(15), 25],
      ['2@'.padEnd(240, 'a'), 61],
    ] as const) {
      const m = encodeQr(text)
      expect(m).toHaveLength(size)
      expect(m.every((row) => row.length === size)).toBe(true)
      expect(finderAt(m, 0, 0) && finderAt(m, size - 7, 0) && finderAt(m, 0, size - 7)).toBe(true)
      for (let i = 8; i < size - 8; i++) {
        expect(m[6]?.[i]).toBe(i % 2 === 0)
        expect(m[i]?.[6]).toBe(i % 2 === 0)
      }
      // Módulo escuro fixo da norma.
      expect(m[size - 8]?.[8]).toBe(true)
    }
  })

  it('os bits de formato dizem correção M e a máscara usada', () => {
    for (const mask of [0, 3, 7]) {
      const bits = formatBits(encodeQr('2@smoke-qr-falso', 'M', mask)) >> 10
      expect(bits).toBe((0 << 3) | mask)
    }
    expect(formatBits(encodeQr('LAP', 'L', 2)) >> 10).toBe((1 << 3) | 2)
    // Sem máscara fixa, uma das oito, sempre a mesma para o mesmo texto.
    const auto = formatBits(encodeQr('2@smoke-qr-falso')) >> 10
    expect(auto >> 3).toBe(0)
    expect(encodeQr('2@smoke-qr-falso')).toEqual(encodeQr('2@smoke-qr-falso'))
  })

  it('texto grande demais é recusado', () => {
    expect(() => encodeQr('x'.repeat(3000))).toThrow()
  })
})
