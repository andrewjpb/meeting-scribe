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
 * Grupo de configurações (contrato 18, CA3): título pequeno em caixa-alta, descrição opcional e as linhas num
 * contêiner com fio de 1 px e raio de 6, sem sombra. Cada filho direto vira uma linha, separada da seguinte
 * por fio de 1 px e com o mesmo recuo lateral. `scroll-mt-6`: aberto pela âncora, o título não fica colado no topo fixo.
 */
export function Section({ title, description, anchor, children }: SectionProps) {
  return (
    <section aria-label={title} data-settings-anchor={anchor} className="flex scroll-mt-6 flex-col">
      <h2 className="caps text-text-muted">{title}</h2>
      {description && <p className="mt-1 text-12 text-text-muted">{description}</p>}
      <div className="mt-3 flex flex-col overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised [&>*]:border-b [&>*]:border-line [&>*]:px-4 [&>*:last-child]:border-b-0">
        {children}
      </div>
    </section>
  )
}
