// Contrato 48 (aviso-reuniao): o aviso no topo da tela ao entrar numa reunião do Meet ou do Teams. "Começar a
// transcrever" grava; a seta abre "Não perguntar nesta reunião" e "Nunca perguntar"; o "x" fecha só desta vez. A
// janela não recebe foco (a reunião continua com ele): tudo é clique. O título da reunião é dado da página e vai
// só como texto.
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MEETING_PROMPT_WHERE, type MeetingPromptAction, type MeetingPromptState } from '@shared/meeting-prompt'
import { Icon } from '../../design/Icon'
import { LapSymbol } from '../../design/LapSymbol'

const SPLIT_CLASS = 'no-drag inline-flex h-7 shrink-0 items-center bg-accent text-13 font-medium whitespace-nowrap text-on-accent hover:opacity-90 active:opacity-80 disabled:pointer-events-none disabled:opacity-50'
const MENU_ITEM_CLASS =
  'no-drag flex h-6 w-full items-center rounded-[var(--radius-control)] px-2 text-left text-12 font-medium whitespace-nowrap text-title hover:bg-bg-sunken active:bg-line disabled:pointer-events-none disabled:opacity-50'
const ICON_BUTTON_CLASS = 'no-drag flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title'

export function MeetingPrompt() {
  const [state, setState] = useState<MeetingPromptState | null>(null)
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    Promise.resolve(window.__scribeApi.invoke('scribe:meeting-prompt-state')).then(
      (next) => {
        if (alive) setState(next)
      },
      () => undefined,
    )
    // O título da mesma reunião pode chegar depois de a janela abrir: o main manda o novo só para ela.
    const off = window.__scribeApi.on('scribe:meeting-prompt-changed', (next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  // O main fecha a janela em seguida; o clique só não vale duas vezes.
  const act = (acao: MeetingPromptAction): void => {
    if (busy) return
    setBusy(true)
    void Promise.resolve(window.__scribeApi.invoke('scribe:meeting-prompt-act', { acao })).catch(() => setBusy(false))
  }

  if (!state) return null
  return (
    <section
      data-meeting-prompt={state.plataforma ?? 'navegador'}
      aria-label="Aviso de reunião"
      className="flex h-full w-full items-center gap-3 overflow-hidden rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised px-3 text-text"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-panel)] bg-side-bg">
        <LapSymbol size={24} />
      </span>
      {menu ? (
        <div role="menu" aria-label="Mais opções do aviso" className="flex min-w-0 flex-1 flex-col">
          <button type="button" role="menuitem" data-action="meeting-prompt-skip" disabled={busy} onClick={() => act('nesta')} className={MENU_ITEM_CLASS}>
            Não perguntar nesta reunião
          </button>
          <button type="button" role="menuitem" data-action="meeting-prompt-never" disabled={busy} onClick={() => act('nunca')} className={MENU_ITEM_CLASS}>
            Nunca perguntar
          </button>
          {/* Onde religar, logo abaixo de "Nunca perguntar". */}
          <p data-meeting-prompt-where className="truncate px-2 text-11 text-text-muted">
            {MEETING_PROMPT_WHERE}
          </p>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <p className="truncate text-13 font-medium text-title">Começar a transcrever</p>
          <p data-meeting-prompt-title title={state.titulo} className="truncate text-12 text-text-muted">
            {state.titulo}
          </p>
        </div>
      )}
      <span className="flex shrink-0 items-center">
        {!menu && (
          <button type="button" data-action="meeting-prompt-record" disabled={busy} onClick={() => act('gravar')} className={`${SPLIT_CLASS} rounded-l-[var(--radius-control)] px-3`}>
            Começar a transcrever
          </button>
        )}
        <button
          type="button"
          data-action="meeting-prompt-more"
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={menu ? 'Voltar ao aviso' : 'Mais opções'}
          disabled={busy}
          onClick={() => setMenu(!menu)}
          className={menu ? ICON_BUTTON_CLASS : `${SPLIT_CLASS} w-7 justify-center rounded-r-[var(--radius-control)] border-l border-on-accent`}
        >
          <Icon icon={menu ? ChevronUp : ChevronDown} size={14} />
        </button>
      </span>
      <button type="button" data-action="meeting-prompt-close" aria-label="Fechar o aviso" disabled={busy} onClick={() => act('fechar')} className={ICON_BUTTON_CLASS}>
        <Icon icon={X} size={14} />
      </button>
    </section>
  )
}
