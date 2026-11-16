import type { ReactNode } from 'react'

interface SettingRowProps {
  name: string
  description?: string
  /** Id do controle, quando ele é um campo: o nome vira o `<label>` dele. */
  htmlFor?: string
  /** Id do nome, para um alternador apontar `aria-labelledby` para ele. */
  nameId?: string
  /** Controle (ou estado) à direita. */
  children: ReactNode
}

/** Linha de configuração: nome 13/500 e descrição 12 à esquerda, controle à direita, fio embaixo. */
export function SettingRow({ name, description, htmlFor, nameId, children }: SettingRowProps) {
  const nameClass = 'text-13 font-medium text-text'
  return (
    <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-line py-2">
      <div className="flex max-w-[440px] min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label id={nameId} htmlFor={htmlFor} className={nameClass}>
            {name}
          </label>
        ) : (
          <p id={nameId} className={nameClass}>
            {name}
          </p>
        )}
        {description && <p className="text-12 text-text-muted">{description}</p>}
      </div>
      {children}
    </div>
  )
}
