import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  /** Linha de apoio abaixo do título. */
  description?: ReactNode
  actions?: ReactNode
  /** `page` (padrão): título de tela, 26/32. `section`: título de uma parte da tela, 20/26 (a aba de Configurações). */
  size?: 'page' | 'section'
  /** Ganchos `data-*` no título (`data-settings-title`). */
  titleAttrs?: Record<`data-${string}`, string>
}

const TITLE_CLASSES: Record<NonNullable<PageHeaderProps['size']>, string> = {
  page: 'text-26 tracking-[-0.3px]',
  section: 'text-20',
}

/** Cabeçalho de tela: título em negrito azul à esquerda (26/32, ou 20/26 com `size="section"`), ações à direita. */
export function PageHeader({ title, description, actions, size = 'page', titleAttrs }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap justify-between gap-4 ${description ? 'items-end' : 'items-center'}`}>
      <div className="min-w-0">
        <h1 {...titleAttrs} className={`${TITLE_CLASSES[size]} font-bold text-title`}>
          {title}
        </h1>
        {description && <p className="mt-1 text-13 text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
