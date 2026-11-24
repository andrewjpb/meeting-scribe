// Contrato 162: as abas de triagem da lista de conversas, em duas linhas (Todas · Não lidas · Urgentes / Pessoal ·
// Profissional). As contagens são sobre todas as conversas, não sobre a busca.
import type { TriagemAba } from '@shared/triagem'

interface TriagemTabsProps {
  value: TriagemAba
  naoLidas: number
  urgentes: number
  onChange: (aba: TriagemAba) => void
}

const comContagem = (label: string, count: number): string => (count > 0 ? `${label} (${count})` : label)

export function TriagemTabs({ value, naoLidas, urgentes, onChange }: TriagemTabsProps) {
  const linhas: readonly (readonly { value: TriagemAba; label: string }[])[] = [
    [
      { value: 'todas', label: 'Todas' },
      { value: 'nao-lidas', label: comContagem('Não lidas', naoLidas) },
      { value: 'urgentes', label: comContagem('Urgentes', urgentes) },
    ],
    [
      { value: 'pessoal', label: 'Pessoal' },
      { value: 'profissional', label: 'Profissional' },
    ],
  ]
  return (
    <div role="group" aria-label="Triagem das conversas" data-triagem-aba={value} className="flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line-strong">
      {linhas.map((linha, row) => (
        <div key={row} className={`grid ${linha.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} ${row > 0 ? 'border-t border-line-strong' : ''}`}>
          {linha.map((option, index) => {
            const active = value === option.value
            return (
              <button
                key={option.value}
                type="button"
                data-triagem-aba-opcao={option.value}
                aria-pressed={active}
                onClick={() => onChange(option.value)}
                className={`no-drag h-7 min-w-0 truncate px-2 text-12 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] focus-visible:outline-offset-[-2px] ${
                  index > 0 ? 'border-l border-line-strong' : ''
                } ${active ? 'bg-title font-medium text-bg' : 'bg-bg-raised text-text hover:bg-bg-sunken'}`}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
