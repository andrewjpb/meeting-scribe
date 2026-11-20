import type { ReactNode } from 'react'

interface SectionProps {
  title: string
  /** Frase curta abaixo do título. */
  description?: string
  /** Âncora do bloco (`#atualizacoes` na URL rola até ele). */
  anchor?: string
  children: ReactNode
}

/**
 * Grupo de configurações (contrato 18, CA3; denso no contrato 80): rótulo 11 em caixa normal, descrição opcional e as linhas num
 * contêiner com fio de 1 px e raio de 6, sem sombra. Cada filho direto vira uma linha, separada da seguinte
 * por fio de 1 px e com o mesmo recuo lateral. `scroll-mt-8`: aberto pela âncora, o título fica com respiro abaixo do fio do topo fixo.
 */
export function Section({ title, description, anchor, children }: SectionProps) {
  return (
    <section aria-label={title} data-settings-anchor={anchor} className="flex scroll-mt-8 flex-col">
      <h2 className="label mb-1">{title}</h2>
      {description && <p className="mt-0.5 text-12 text-text-muted">{description}</p>}
      <div className="mt-2 flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised [&>*]:border-b [&>*]:border-line [&>*]:px-3 [&>*:last-child]:border-b-0">
        {children}
      </div>
    </section>
  )
}
