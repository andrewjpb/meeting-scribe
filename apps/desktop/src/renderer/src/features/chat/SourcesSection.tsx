import { useEffect } from 'react'
import { chatSourcesOf, chatWhatsAppModeOf, type ChatScope, type ChatSourceKind } from '@shared/chat'
import { WHATSAPP_RECENT_CHATS_MAX, WHATSAPP_RECENT_DAYS } from '@shared/whatsapp'
import { useSettings } from '../../app/settingsStore'
import { Switch } from '../../design/Switch'
import { useWhatsApp } from '../whatsapp/whatsappStore'
import { WhatsAppScopeSection } from './WhatsAppScopeSection'

const SOURCE_TEXT: Readonly<Record<ChatSourceKind, { name: string; description: string }>> = {
  whatsapp: { name: 'WhatsApp', description: `As conversas com mensagem nos últimos ${WHATSAPP_RECENT_DAYS} dias (até ${WHATSAPP_RECENT_CHATS_MAX}), com o que está pendente de resposta.` },
  automations: { name: 'Automações', description: 'Agentes, tarefas agendadas e as últimas 20 execuções.' },
  guide: { name: 'Guia do app', description: 'Cada tela, cada aba de Configurações, os atalhos e o que cada recurso faz.' },
  internet: { name: 'Internet', description: 'Busca na web quando a pergunta pedir. Os links aparecem na resposta.' },
}

function SourceRow({ kind, checked, onChange, unavailable }: { kind: ChatSourceKind; checked: boolean; onChange: (checked: boolean) => void; unavailable?: string | undefined }) {
  const id = `chat-source-${kind}`
  return (
    <div data-chat-source={kind} data-chat-source-unavailable={unavailable ? '' : undefined} className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={id} className="text-13 text-text">
          {SOURCE_TEXT[kind].name}
        </span>
        <span className="text-12 text-text-faint">{unavailable ?? SOURCE_TEXT[kind].description}</span>
      </div>
      <Switch checked={unavailable ? false : checked} onChange={onChange} labelledBy={id} disabled={unavailable !== undefined} />
    </div>
  )
}

/**
 * "Fontes" do painel "Contexto" do Assistente (contrato 25, CA2): além das reuniões, o WhatsApp (só com ele conectado
 * ou com conversas já escolhidas), as Automações, o Guia do app e (contrato 26) a Internet, cada um com interruptor,
 * todos ligados por padrão.
 * No WhatsApp, "Conversas recentes" (o padrão) ou "Só estas conversas" (a escolha manual do contrato 24). O estado
 * atual (data, hora, fuso e conexões) vai sempre. A troca vale a partir da próxima pergunta.
 */
export function SourcesSection({ scope, onScope }: { scope: ChatScope; onScope: (scope: ChatScope) => void }) {
  const connected = useWhatsApp((state) => state.status?.state === 'connected')
  // Contrato 26: pela linha de comando a internet não existe (o app não teria como conferir cada página).
  const cli = useSettings((state) => state.settings.claudeTransport) === 'cli'
  const sources = chatSourcesOf(scope)
  const mode = chatWhatsAppModeOf(scope)
  const showWhatsApp = connected || (scope.whatsappChats?.length ?? 0) > 0

  useEffect(() => {
    if (connected) void useWhatsApp.getState().loadChats()
  }, [connected])

  const toggle = (kind: ChatSourceKind, on: boolean): void => {
    // Só as desligadas ficam guardadas.
    const next = Object.fromEntries(Object.entries({ ...(scope.sources ?? {}), [kind]: on }).filter(([, value]) => value === false))
    const { sources: _sources, ...rest } = scope
    onScope(Object.keys(next).length ? { ...rest, sources: next } : rest)
  }
  const pickMode = (next: 'recent' | 'chosen'): void => {
    const { whatsappMode: _mode, whatsappChats: _chats, whatsappDays: _days, ...rest } = scope
    onScope(next === 'recent' ? rest : { ...rest, whatsappMode: 'chosen' })
  }

  return (
    <section aria-label="Fontes" data-chat-sources className="flex flex-col gap-3 border-b border-line px-4 py-4">
      <h3 className="text-12 font-bold text-text-muted">Fontes</h3>
      {showWhatsApp && (
        <>
          <SourceRow kind="whatsapp" checked={sources.whatsapp} onChange={(on) => toggle('whatsapp', on)} />
          {sources.whatsapp && (
            <div role="radiogroup" aria-label="Quais conversas do WhatsApp" className="flex flex-col gap-1 pl-1">
              {(
                [
                  ['recent', 'Conversas recentes'],
                  ['chosen', 'Só estas conversas'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode === value}
                  data-chat-whatsapp-mode={value}
                  onClick={() => pickMode(value)}
                  className={`no-drag flex h-7 items-center gap-2 rounded-[var(--radius-control)] px-1 text-left text-13 hover:bg-bg-sunken ${mode === value ? 'font-medium text-title' : 'text-text'}`}
                >
                  <span aria-hidden="true" className={`size-2 shrink-0 border ${mode === value ? 'border-accent bg-accent' : 'border-line-strong'}`} />
                  {label}
                </button>
              ))}
            </div>
          )}
          {sources.whatsapp && mode === 'chosen' && <WhatsAppScopeSection scope={scope} onScope={onScope} />}
        </>
      )}
      <SourceRow kind="automations" checked={sources.automations} onChange={(on) => toggle('automations', on)} />
      <SourceRow kind="guide" checked={sources.guide} onChange={(on) => toggle('guide', on)} />
      <SourceRow kind="internet" checked={sources.internet} onChange={(on) => toggle('internet', on)} unavailable={cli ? 'Só com o motor ACP (Configurações › Claude)' : undefined} />
      <p className="text-12 text-text-faint">O estado do app (data, hora, fuso e conexões) vai sempre. Vale a partir da próxima pergunta.</p>
    </section>
  )
}
