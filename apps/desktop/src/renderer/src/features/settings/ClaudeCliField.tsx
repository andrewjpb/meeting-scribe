import { useEffect, useState } from 'react'
import { useSettings } from '../../app/settingsStore'
import { Button } from '../../design/Button'
import { TextField } from '../../design/Field'
import { useClaudeCli, type ClaudeCheck } from './claudeStore'

export const CLAUDE_PATH_INPUT_ID = 'claude-path'

type Tone = 'accent' | 'muted' | 'rec'

const TONE_TEXT: Record<Tone, string> = { accent: 'text-accent', muted: 'text-text-muted', rec: 'text-rec' }
const TONE_SQUARE: Record<Tone, string> = { accent: 'bg-accent', muted: 'bg-line-strong', rec: 'bg-rec' }

/** Linha de estado à direita do nome. */
export function claudeStatusLine(check: ClaudeCheck): { tone: Tone; text: string } {
  if (check.phase === 'checking') return { tone: 'muted', text: 'Procurando o Claude CLI…' }
  if (check.phase === 'found') return { tone: 'accent', text: `Claude Code ${check.version} encontrado` }
  return { tone: 'rec', text: 'Claude CLI não encontrado nesta máquina' }
}

/**
 * Estado do Claude CLI: versão encontrada e onde, ou "não encontrado" com o campo do caminho. O app não
 * faz login no Claude: quem usa entra pelo `claude` no Terminal uma vez.
 */
export function ClaudeCliField() {
  const check = useClaudeCli((state) => state.check)
  const busy = useClaudeCli((state) => state.busy)
  const pathRejected = useClaudeCli((state) => state.pathRejected)
  const configuredPath = useSettings((state) => state.settings.claudePath)
  const engine = useSettings((state) => state.settings.translationEngine)
  const [draft, setDraft] = useState('')

  // O campo fica sempre na tela (o chat usa o `claude`); trocar o motor da tradução procura de novo.
  useEffect(() => {
    void useClaudeCli.getState().load()
  }, [engine])

  const choose = (): void => {
    const path = draft.trim()
    if (busy) return
    if (!path) {
      document.getElementById(CLAUDE_PATH_INPUT_ID)?.focus()
      return
    }
    void useClaudeCli
      .getState()
      .choose(path)
      .then(() => {
        if (!useClaudeCli.getState().pathRejected) setDraft('')
      })
  }

  const line = claudeStatusLine(check)

  return (
    <div
      className="flex flex-col gap-3 py-4"
      data-claude-state={check.phase}
      data-setting-row
      data-setting-name="Claude CLI"
      data-setting-description="Caminho do claude instalado neste Mac, usado na tradução, no resumo e no Assistente."
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-13 font-medium text-text">Claude CLI</p>
        <p data-claude-status className={`flex items-center gap-1.5 text-12 font-medium ${TONE_TEXT[line.tone]}`} aria-live="polite">
          <span aria-hidden="true" className={`size-1.5 shrink-0 ${TONE_SQUARE[line.tone]}`} />
          {line.text}
        </p>
      </div>

      {check.phase === 'found' && (
        <p className="text-12 text-text-muted">
          Traduz, resume e responde no Assistente com a sua conta do Claude, neste Mac. <span className="font-mono text-11 text-text-faint select-text">{check.path}</span>
          {configuredPath && (
            <>
              {' '}
              <button
                type="button"
                data-action="reset-claude-path"
                disabled={busy}
                onClick={() => void useClaudeCli.getState().choose(null)}
                className="no-drag rounded-[var(--radius-control)] text-accent underline decoration-1 underline-offset-2 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title"
              >
                Procurar sozinho
              </button>
            </>
          )}
        </p>
      )}

      {check.phase === 'not-found' && (
        <>
          <div className="flex flex-wrap gap-2">
            <TextField
              id={CLAUDE_PATH_INPUT_ID}
              value={draft}
              onChange={setDraft}
              onEnter={choose}
              placeholder="/Users/você/.local/bin/claude"
              ariaLabel="Caminho do Claude CLI"
              describedBy="claude-path-help"
            />
            <Button action="use-claude-path" onClick={choose} disabled={busy}>
              Usar caminho
            </Button>
          </div>
          <p id="claude-path-help" className="text-12 text-text-muted">
            No Terminal, <span className="font-mono text-11 text-text">command -v claude</span> mostra o caminho. Instale e entre na sua conta pelo Terminal antes.
          </p>
          {pathRejected && (
            <p data-claude-path-rejected className="text-12 font-medium text-rec" role="alert">
              Nenhum Claude CLI respondeu nesse caminho.
            </p>
          )}
        </>
      )}
    </div>
  )
}
