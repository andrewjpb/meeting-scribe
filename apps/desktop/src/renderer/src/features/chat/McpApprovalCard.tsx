import { Plug } from 'lucide-react'
import { useState } from 'react'
import type { McpApproval, McpApprovalDecision } from '@shared/mcp'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { useChat } from './chatStore'

/**
 * Contrato 21 (CA5): o pedido de uma ferramenta MCP com a política "Perguntar", na própria conversa. Os argumentos vêm
 * do main já em JSON formatado e com os segredos do cadastro mascarados; aqui são só texto. Sem resposta em 2 min, o
 * main nega e o cartão sai.
 */
export function McpApprovalCard({ chatId, approval }: { chatId: string; approval: McpApproval }) {
  const [sending, setSending] = useState(false)
  const answer = (decision: McpApprovalDecision): void => {
    setSending(true)
    void useChat
      .getState()
      .answerApproval(chatId, approval.id, decision)
      .then((ok) => {
        if (!ok) setSending(false)
      })
  }
  return (
    <div data-mcp-approval={approval.id} role="group" aria-label={`Pedido de ferramenta: ${approval.tool}`} className="flex max-w-[72ch] flex-col gap-3 rounded-[var(--radius-panel)] border border-line-strong bg-bg-sunken px-4 py-3">
      <p className="flex items-center gap-2 text-13 text-text">
        <Icon icon={Plug} size={14} className="shrink-0 text-text-muted" />
        <span>
          O Claude quer usar <span className="font-medium text-title">{approval.tool}</span> de <span className="font-medium text-title">{approval.server}</span>
        </span>
      </p>
      <pre data-mcp-approval-args className="max-h-48 overflow-auto rounded-[var(--radius-control)] border border-line bg-bg-raised px-3 py-2 font-mono text-12 whitespace-pre-wrap text-text select-text">
        {approval.args}
      </pre>
      <p className="text-12 text-text-muted">Confira o pedido: texto de reunião pode tentar pedir ações.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button action="mcp-allow-once" variant="secondary" disabled={sending} onClick={() => answer('once')}>
          Permitir uma vez
        </Button>
        <Button action="mcp-allow-always" variant="secondary" disabled={sending} onClick={() => answer('always')}>
          Sempre permitir esta ferramenta
        </Button>
        <Button action="mcp-deny" variant="danger" disabled={sending} onClick={() => answer('deny')}>
          Negar
        </Button>
      </div>
    </div>
  )
}
