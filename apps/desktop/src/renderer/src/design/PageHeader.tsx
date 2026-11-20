import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  /** Linha de apoio abaixo do título. */
  description?: ReactNode
  actions?: ReactNode
  /** `page` (padrão): título de tela, 20/26. `section`: título de uma parte da tela, 15/20 (a aba de Configurações). */
  size?: 'page' | 'section'
  /** Ganchos `data-*` no título (`data-settings-title`). */
  titleAttrs?: Record<`data-${string}`, string>
}

const TITLE_CLASSES: Record<NonNullable<PageHeaderProps['size']>, string> = {
  page: 'text-20 tracking-[-0.3px]',
  section: 'text-15',
}

/** Cabeçalho de tela: título em negrito azul à esquerda (20/26, ou 15/20 com `size="section"`), ações à direita. */
export function PageHeader({ title, description, actions, size = 'page', titleAttrs }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap justify-between gap-3 ${description ? 'items-end' : 'items-center'}`}>
      <div className="min-w-0">
        <h1 {...titleAttrs} className={`${TITLE_CLASSES[size]} font-bold text-title`}>
          {title}
        </h1>
        {description && <p className="mt-0.5 text-12 text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
