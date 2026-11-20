import type { ReactNode } from 'react'

interface EmptyStateProps {
  illustration: ReactNode
  title: string
  children: ReactNode
  action?: ReactNode
}

/** Estado vazio centralizado na área: ilustração, título 17/24 em azul (peso 600), uma frase e a ação. */
export function EmptyState({ illustration, title, children, action }: EmptyStateProps) {
  return (
    <section className="flex flex-col items-center text-center" aria-label={title}>
      <div className="mb-5">{illustration}</div>
      <h2 className="text-17 font-semibold text-title">{title}</h2>
      <p className="mt-2 max-w-[400px] text-13 text-pretty text-text-muted">{children}</p>
      {action && <div className="mt-4">{action}</div>}
    </section>
  )
}
