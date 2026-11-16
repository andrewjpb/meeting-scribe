import type { ReactNode } from 'react'

interface EmptyStateProps {
  illustration: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}

/** Estado vazio centralizado na área: ilustração, título 20/26 em negrito azul, uma frase e a ação. */
export function EmptyState({ illustration, title, children, action }: EmptyStateProps) {
  return (
    <section className="flex flex-col items-center text-center" aria-label={title}>
      <div className="mb-7">{illustration}</div>
      <h2 className="text-20 font-bold tracking-[-0.3px] text-title">{title}</h2>
      <p className="mt-3 max-w-[400px] text-13 text-pretty text-text-muted">{children}</p>
      {action && <div className="mt-6">{action}</div>}
    </section>
  )
}
