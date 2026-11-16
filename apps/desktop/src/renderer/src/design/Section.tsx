import type { ReactNode } from 'react'

/** Seção de página: título 17/24 em negrito azul com o fio de 2 × 24 px em --title logo abaixo. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col">
      <h2 className="text-17 font-bold text-title">{title}</h2>
      <span aria-hidden="true" className="my-2 h-0.5 w-6 bg-title" />
      {children}
    </section>
  )
}
