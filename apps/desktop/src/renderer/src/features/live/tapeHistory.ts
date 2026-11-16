// Colunas da fita de níveis: uma a cada 50 ms de gravação, o nível de cada fonte de 0 a 1 (ou `null`
// com a fonte ausente). Fica fora do componente para a fita não se perder ao trocar de tela.
import type { AudioSource } from '../../audio/frames'

export const COLUMN_MS = 50
const MAX_COLUMNS = 800

export type TapeColumn = Readonly<Record<AudioSource, number | null>>

export class TapeHistory {
  private readonly columns: TapeColumn[] = []
  /** Índice absoluto da coluna mais nova (o tracejado de fonte ausente se ancora nele). */
  private newest = -1

  push(column: TapeColumn): void {
    this.columns.push(column)
    this.newest++
    if (this.columns.length > MAX_COLUMNS) this.columns.shift()
  }

  get length(): number {
    return this.columns.length
  }

  /** `age` 0 é a coluna mais nova. */
  at(age: number): { column: TapeColumn; index: number } | null {
    const column = this.columns[this.columns.length - 1 - age]
    return column ? { column, index: this.newest - age } : null
  }
}
