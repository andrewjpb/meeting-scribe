import { useEffect, useState } from 'react'
import type { ChatScope } from '@shared/chat'
import type { McpChatServer } from '@shared/mcp'
import { rereadWhenUnlocked } from '../../app/lockStore'
import { useSettings } from '../../app/settingsStore'
import { Switch } from '../../design/Switch'

/**
 * Contrato 21 (CA6): a linha "Conexões" do painel Contexto. Os servidores MCP ligados para o chat nas Configurações, com
 * um interruptor só para esta conversa (o padrão: todos ligados). A troca fecha a sessão e vale a partir da próxima
 * pergunta, como a troca de modelo. Sem nenhum servidor ligado, a seção não aparece.
 */
export function ConnectionsContext({ scope, onScope }: { scope: ChatScope; onScope: (scope: ChatScope) => void }) {
  const [servers, setServers] = useState<McpChatServer[] | null>(null)
  // Pela linha de comando não há MCP (o app não teria como conferir cada ferramenta).
  const cli = useSettings((state) => state.settings.claudeTransport) === 'cli'

  useEffect(() => {
    let alive = true
    let cancelReread: (() => void) | null = null
    const load = (): void => {
      void window.__scribeApi.invoke('scribe:mcp-chat-servers').then(
        (list) => {
          if (alive) setServers(list)
        },
        (error: unknown) => {
          if (!alive) return
          setServers([])
          // Montou com o app bloqueado (contrato 22): lê de novo no desbloqueio.
          cancelReread = rereadWhenUnlocked(error, load)
        },
      )
    }
    load()
    return () => {
      alive = false
      cancelReread?.()
    }
  }, [])

  if (!servers?.length) return null
  const off = new Set(scope.mcpOff ?? [])
  const toggle = (key: string, on: boolean): void => {
    const next = new Set(off)
    if (on) next.delete(key)
    else next.add(key)
    const { mcpOff: _previous, ...rest } = scope
    onScope(next.size ? { ...rest, mcpOff: [...next] } : rest)
  }
  return (
    <section aria-label="Conexões" data-chat-connections className="flex flex-col gap-2 border-b border-line px-3 py-3">
      <h3 className="label">Conexões</h3>
      {servers.map((server, index) => {
        const id = `chat-connection-${index}`
        const unavailable = cli ? 'Só com o motor ACP (Configurações › Claude)' : server.unavailable
        return (
          <div key={server.key} data-chat-connection={server.key} className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span id={id} className="truncate text-13 text-text">
                {server.name}
              </span>
              <span className="text-12 text-text-faint">{unavailable ?? 'Servidor MCP ligado em Configurações › Conexões.'}</span>
            </div>
            <Switch checked={!unavailable && !off.has(server.key)} onChange={(on) => toggle(server.key, on)} labelledBy={id} disabled={unavailable !== null} />
          </div>
        )
      })}
      <p className="text-12 text-text-faint">Vale a partir da próxima pergunta.</p>
    </section>
  )
}
