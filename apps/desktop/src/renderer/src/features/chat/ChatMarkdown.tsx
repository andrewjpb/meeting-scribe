import { ExternalLink } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { meetingIdOfLink } from '@shared/chat'
import { meetingPath } from '@shared/routes'
import { Button } from '../../design/Button'
import { Note } from '../../design/Note'
import { isExternalLink, parseMarkdown, type Block, type Inline } from './markdown'

const LINK_CLASS =
  'no-drag inline rounded-[var(--radius-control)] text-left font-medium text-accent underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

/**
 * Resposta do Claude em Markdown simples (contrato 15, CA4), desenhada com elementos do React a partir da
 * árvore de `markdown.ts`: nenhum HTML do texto chega ao DOM. Link `meeting:<id>` vira botão que abre o
 * detalhe da reunião; link `https://` vira botão que pede confirmação antes de abrir no navegador; qualquer
 * outro link fica só o texto.
 */
export function ChatMarkdown({ text }: { text: string }) {
  const navigate = useNavigate()
  const [external, setExternal] = useState<string | null>(null)

  const inline = (nodes: readonly Inline[], key = ''): ReactNode[] =>
    nodes.map((node, index) => {
      const id = `${key}${index}`
      if (node.type === 'text') return node.text
      if (node.type === 'strong') return <strong key={id} className="font-bold">{inline(node.children, `${id}-`)}</strong>
      if (node.type === 'em') return <em key={id}>{inline(node.children, `${id}-`)}</em>
      if (node.type === 'code') return <code key={id} className="rounded-[var(--radius-control)] bg-bg-sunken px-1 font-mono text-12">{node.text}</code>
      const meetingId = meetingIdOfLink(node.href)
      if (meetingId) {
        return (
          <button key={id} type="button" data-meeting-link={meetingId} className={LINK_CLASS} onClick={() => void navigate(meetingPath(meetingId))}>
            {inline(node.children, `${id}-`)}
          </button>
        )
      }
      if (isExternalLink(node.href)) {
        return (
          <button key={id} type="button" data-external-link={node.href} className={LINK_CLASS} onClick={() => setExternal(node.href)}>
            {inline(node.children, `${id}-`)}
          </button>
        )
      }
      return <span key={id}>{inline(node.children, `${id}-`)}</span>
    })

  const block = (node: Block, index: number): ReactNode => {
    if (node.type === 'paragraph') return <p key={index} className="whitespace-pre-line">{inline(node.children)}</p>
    if (node.type === 'heading') return <p key={index} className="font-bold whitespace-pre-line text-title">{inline(node.children)}</p>
    if (node.type === 'code') {
      return (
        <pre key={index} className="overflow-x-auto rounded-[var(--radius-control)] bg-bg-sunken px-3 py-2 font-mono text-12 whitespace-pre">
          <code>{node.text}</code>
        </pre>
      )
    }
    const List = node.ordered ? 'ol' : 'ul'
    return (
      <List key={index} className={`flex flex-col gap-1 pl-5 ${node.ordered ? 'list-decimal' : 'list-disc'}`}>
        {node.items.map((item, itemIndex) => (
          <li key={itemIndex} className="whitespace-pre-line">
            {inline(item)}
          </li>
        ))}
      </List>
    )
  }

  return (
    <div data-chat-markdown className="flex flex-col gap-3">
      {parseMarkdown(text).map(block)}
      {external && (
        <Note
          id="chat-external-link"
          icon={ExternalLink}
          action={
            <div className="flex gap-2">
              <Button
                action="open-external-link"
                variant="secondary"
                onClick={() => {
                  window.__scribeApi.send('scribe:open-link', external)
                  setExternal(null)
                }}
              >
                Abrir
              </Button>
              <Button action="cancel-external-link" variant="secondary" onClick={() => setExternal(null)}>
                Cancelar
              </Button>
            </div>
          }
        >
          Abrir {external} no navegador?
        </Note>
      )}
    </div>
  )
}
