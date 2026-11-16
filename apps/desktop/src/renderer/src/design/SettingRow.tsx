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

/**
 * Linha de configuração: nome 13/500 e descrição 12 à esquerda; à direita, o controle numa coluna de largura
 * fixa, alinhado à esquerda dela, para todos começarem no mesmo `x` (contrato 18, CA3). O nome e a descrição
 * também vão em atributos, que a busca das Configurações lê.
 */
export function SettingRow({ name, description, htmlFor, nameId, children }: SettingRowProps) {
  const nameClass = 'text-13 font-medium text-text'
  return (
    <div
      data-setting-row
      data-setting-name={name}
      data-setting-description={description}
      className="grid min-h-16 grid-cols-[minmax(0,1fr)_var(--settings-control-width)] items-center gap-x-6 py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
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
      <div data-setting-control className="flex min-w-0 flex-wrap items-center gap-2">
        {children}
      </div>
    </div>
  )
}
