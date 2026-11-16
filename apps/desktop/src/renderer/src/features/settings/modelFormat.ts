// Formatos e busca do seletor de modelo (funções puras, testadas em test/renderer/settings-format.test.ts).
import type { CatalogModel } from '@shared/assemblyai'

const money = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 })

/** `US$ 0,10 / 0,50 por 1M` (entrada / saída por 1 milhão de tokens); sem preço fixo, "Preço variável". */
export function formatPrice(model: Pick<CatalogModel, 'promptPerM' | 'completionPerM'>): string {
  if (model.promptPerM === null || model.completionPerM === null) return 'Preço variável'
  return `US$ ${money.format(model.promptPerM)} / ${money.format(model.completionPerM)} por 1M`
}

/** Contexto em tokens: `32k`, `400k`, `1M`, `1,5M`. Arredonda para baixo, como o catálogo anuncia. */
export function formatContext(tokens: number | null): string {
  if (tokens === null) return ''
  if (tokens >= 1_000_000) {
    const millions = Math.floor(tokens / 100_000) / 10
    return `${millions.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`
  }
  return `${Math.max(1, Math.floor(tokens / 1000))}k`
}

/** Minúsculas e sem acento, para a busca. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

export function filterModels(models: readonly CatalogModel[], query: string): CatalogModel[] {
  const needle = normalizeSearch(query)
  if (!needle) return [...models]
  return models.filter((model) => normalizeSearch(model.name).includes(needle) || normalizeSearch(model.id).includes(needle))
}

const cost = (model: CatalogModel): number =>
  model.promptPerM === null || model.completionPerM === null ? Number.POSITIVE_INFINITY : model.promptPerM + model.completionPerM

/**
 * Ordem da lista: o modelo atual primeiro, depois do mais barato para o mais caro (tradução ao vivo
 * pede modelo pequeno), empate pelo nome. Calculada uma vez por carga, para a lista não pular a cada escolha.
 */
export function orderModels(models: readonly CatalogModel[], currentId: string): CatalogModel[] {
  return [...models].sort((a, b) => {
    if (a.id === currentId) return -1
    if (b.id === currentId) return 1
    return cost(a) - cost(b) || a.name.localeCompare(b.name, 'pt-BR')
  })
}

export function countLabel(shown: number, total: number): string {
  if (shown === total) return total === 1 ? '1 modelo' : `${total} modelos`
  return `${shown} de ${total}`
}
