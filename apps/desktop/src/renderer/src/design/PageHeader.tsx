import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  /** Linha de apoio abaixo do título. */
  description?: ReactNode
  actions?: ReactNode
}

/** Cabeçalho de tela: título 26/32 em negrito azul à esquerda, ações à direita. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className={`flex flex-wrap justify-between gap-4 ${description ? 'items-end' : 'items-center'}`}>
      <div className="min-w-0">
        <h1 className="text-26 font-bold tracking-[-0.3px] text-title">{title}</h1>
        {description && <p className="mt-1 text-13 text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
