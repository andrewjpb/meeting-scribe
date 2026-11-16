// Codificador de QR code (contrato 24, CA2): o app desenha o QR a partir do texto que o serviço devolve em `/pair`,
// sem biblioteca nem pedido de rede. Modo byte (UTF-8), correção de erro M (ou L), versões 1 a 40, a máscara de
// menor penalidade. Segue a norma ISO/IEC 18004 no mesmo desenho do codificador de referência de Nayuki (MIT).
// Conferido em 16/11/2026 com o leitor de QR do macOS (CoreImage): versões 1, 6, 10, 11 e 29, as oito máscaras e
// texto com acentos, todos lidos de volta iguais.

export type QrLevel = 'L' | 'M'

const FORMAT_BITS: Record<QrLevel, number> = { L: 1, M: 0 }
// Por versão (índice 0 sem uso): códigos de correção por bloco e número de blocos.
const ECC_PER_BLOCK: Record<QrLevel, readonly number[]> = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
}
const ECC_BLOCKS: Record<QrLevel, readonly number[]> = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
}

const bit = (value: number, index: number): boolean => ((value >>> index) & 1) !== 0

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2
    result -= (25 * align - 10) * align - 55
    if (version >= 7) result -= 36
  }
  return result
}

const dataCodewords = (version: number, level: QrLevel): number =>
  Math.floor(rawDataModules(version) / 8) - (ECC_PER_BLOCK[level][version] ?? 0) * (ECC_BLOCKS[level][version] ?? 0)

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMultiply(result[j] ?? 0, root)
      if (j + 1 < result.length) result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0)
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    divisor.forEach((coef, i) => {
      result[i] = (result[i] ?? 0) ^ gfMultiply(coef, factor)
    })
  }
  return result
}

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const count = Math.floor(version / 7) + 2
  const step = Math.floor((version * 8 + count * 3 + 5) / (count * 4 - 4)) * 2
  const result = [6]
  for (let pos = version * 4 + 17 - 7; result.length < count; pos -= step) result.splice(1, 0, pos)
  return result
}

/** Matriz do QR (`true` é escuro), `modules[y][x]`. `mask` fixa a máscara (testes); sem ela, a de menor penalidade. */
export function encodeQr(text: string, level: QrLevel = 'M', mask?: number): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let version = 1
  for (; ; version++) {
    if (version > 40) throw new Error('texto grande demais para um QR code')
    const countBits = version <= 9 ? 8 : 16
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version, level) * 8) break
  }
  const bits: number[] = []
  const push = (value: number, length: number): void => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  const capacity = dataCodewords(version, level) * 8
  push(0, Math.min(4, capacity - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((acc, b) => (acc << 1) | b, 0))

  // Correção de erro e intercalação dos blocos.
  const blocks = ECC_BLOCKS[level][version] ?? 1
  const eccLen = ECC_PER_BLOCK[level][version] ?? 0
  const raw = Math.floor(rawDataModules(version) / 8)
  const shortBlocks = blocks - (raw % blocks)
  const shortLen = Math.floor(raw / blocks)
  const divisor = rsDivisor(eccLen)
  const parts: number[][] = []
  for (let i = 0, k = 0; i < blocks; i++) {
    const chunk = data.slice(k, k + shortLen - eccLen + (i < shortBlocks ? 0 : 1))
    k += chunk.length
    const ecc = rsRemainder(chunk, divisor)
    if (i < shortBlocks) chunk.push(0)
    parts.push([...chunk, ...ecc])
  }
  const codewords: number[] = []
  for (let i = 0; i < (parts[0]?.length ?? 0); i++) {
    parts.forEach((part, j) => {
      if (i !== shortLen - eccLen || j >= shortBlocks) codewords.push(part[i] ?? 0)
    })
  }

  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const fixed = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const set = (x: number, y: number, dark: boolean): void => {
    const row = modules[y]
    const fixedRow = fixed[y]
    if (!row || !fixedRow) return
    row[x] = dark
    fixedRow[x] = true
  }

  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx
        const y = cy + dy
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, dist !== 2 && dist !== 4)
      }
    }
  }
  const aligns = alignmentPositions(version)
  aligns.forEach((ay, i) => {
    aligns.forEach((ax, j) => {
      const last = aligns.length - 1
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    })
  })

  const drawFormat = (maskId: number): void => {
    const value = (FORMAT_BITS[level] << 3) | maskId
    let rem = value
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const format = ((value << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(format, i))
    set(8, 7, bit(format, 6))
    set(8, 8, bit(format, 7))
    set(7, 8, bit(format, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(format, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(format, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(format, i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    let rem = version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const value = (version << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit(value, i))
      set(b, a, bit(value, i))
    }
  }

  // Dados em zigue-zague, de baixo para cima e de cima para baixo, em pares de colunas.
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        const row = modules[y]
        if (row && !fixed[y]?.[x] && index < codewords.length * 8) {
          row[x] = bit(codewords[index >>> 3] ?? 0, 7 - (index & 7))
          index++
        }
      }
    }
  }

  const applyMask = (maskId: number): void => {
    for (let y = 0; y < size; y++) {
      const row = modules[y]
      if (!row) continue
      for (let x = 0; x < size; x++) {
        const invert = [
          (x + y) % 2 === 0,
          y % 2 === 0,
          x % 3 === 0,
          (x + y) % 3 === 0,
          (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
          ((x * y) % 2) + ((x * y) % 3) === 0,
          (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
          (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
        ][maskId]
        if (invert && !fixed[y]?.[x]) row[x] = !row[x]
      }
    }
  }

  let chosen = mask
  if (chosen === undefined) {
    let best = Number.POSITIVE_INFINITY
    for (let candidate = 0; candidate < 8; candidate++) {
      applyMask(candidate)
      drawFormat(candidate)
      const score = penalty(modules)
      if (score < best) {
        best = score
        chosen = candidate
      }
      applyMask(candidate)
    }
  }
  const final = chosen ?? 0
  applyMask(final)
  drawFormat(final)
  return modules
}

/** Penalidade da norma: sequências, blocos 2×2, padrões parecidos com o localizador e o equilíbrio de escuros. */
function penalty(modules: readonly boolean[][]): number {
  const size = modules.length
  const at = (x: number, y: number): boolean => modules[y]?.[x] ?? false
  let score = 0
  const runs = (get: (i: number, j: number) => boolean): void => {
    for (let i = 0; i < size; i++) {
      let run = 1
      for (let j = 1; j <= size; j++) {
        if (j < size && get(i, j) === get(i, j - 1)) run++
        else {
          if (run >= 5) score += run - 2
          run = 1
        }
      }
      const line = Array.from({ length: size }, (_, j) => (get(i, j) ? '1' : '0')).join('')
      for (const pattern of ['10111010000', '00001011101']) {
        for (let from = line.indexOf(pattern); from !== -1; from = line.indexOf(pattern, from + 1)) score += 40
      }
    }
  }
  runs((y, x) => at(x, y))
  runs((x, y) => at(x, y))
  let dark = 0
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y)) dark++
      if (x < size - 1 && y < size - 1) {
        const color = at(x, y)
        if (color === at(x + 1, y) && color === at(x, y + 1) && color === at(x + 1, y + 1)) score += 3
      }
    }
  }
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return score + Math.max(0, k) * 10
}
