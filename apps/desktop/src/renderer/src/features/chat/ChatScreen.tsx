import { useEffect, useRef, useState } from 'react'
import { ChatConversation } from './ChatConversation'
import { listKey, useChat } from './chatStore'
import { CONTEXT_TARGETS, type ContextTarget } from './ContextPanel'
import { railScrollTarget } from './format'
import { useChatMeetings } from './useChatMeetings'

/** Id do trilho (o `aria-controls` do botão "Contexto" da conversa). */
const CHAT_RAIL_ID = 'chat-rail'

/** Um pedido para levar o trilho a uma seção; `focus` põe o foco no primeiro controle dela (conversa salva). */
interface Reveal {
  target: ContextTarget
  focus: boolean
}

/**
 * Tela "Assistente" (contratos 15, 16, 25 e 38; antes "Perguntar"): a conversa aberta e, à direita, o trilho do
 * "Contexto". Contrato 67: as conversas ficam no nível Assistente da barra lateral (`ChatHistory`) e a aberta continua no
 * store; o trilho é só o "Contexto", sempre aberto numa conversa salva (o cabeçalho da conversa leva o trilho à seção) e,
 * numa conversa nova, aberto pelo botão "Contexto" (sem ele, a conversa vai até a borda da janela). Conversa e trilho
 * cabem lado a lado mesmo em 1120 px. Contrato 78 (R4): sem o cabeçalho da tela; a linha da conversa (título, escopo,
 * modelo e "Contexto") é o topo, e o trilho começa na mesma altura.
 */
export function ChatScreen() {
  const key = listKey(null)
  const selected = useChat((state) => state.selected[key] ?? null)
  // Sem o `claude` a conversa é só o aviso: nada para o trilho mostrar.
  const claudeMissing = useChat((state) => state.claude === 'not-found')
  const meetings = useChatMeetings()
  // Só vale na conversa nova; voltar a ela ("Nova conversa") começa com o trilho fechado.
  const [contextOpen, setContextOpen] = useState(false)
  const [shownChat, setShownChat] = useState(selected)
  if (shownChat !== selected) {
    setShownChat(selected)
    if (selected === null) setContextOpen(false)
  }
  const railOpen = !claudeMissing && (selected !== null || contextOpen)
  // O "Contexto" é desenhado pela conversa (que tem o escopo e o modelo) dentro deste elemento do trilho.
  const [contextSlot, setContextSlot] = useState<HTMLDivElement | null>(null)
  const rail = useRef<HTMLElement | null>(null)
  /** Cada pedido (mesmo para a seção já à vista) rola o trilho até ela; um objeto novo por pedido. */
  const [reveal, setReveal] = useState<Reveal | null>(null)
  /** O último pedido atendido: o `contextSlot` que chega depois não repete a rolagem nem o foco. */
  const revealed = useRef<Reveal | null>(null)
  const openContext = (open: boolean): void => {
    setContextOpen(open)
    if (open) setReveal({ target: 'top', focus: false })
  }
  const revealContext = (target: ContextTarget): void => setReveal({ target, focus: true })

  useEffect(() => {
    void useChat.getState().loadList(null)
  }, [])

  // O trilho rola o mínimo para a seção aparecer inteira (ou o topo dela, se não cabe) e o foco vai para o primeiro
  // controle dela. Roda de novo quando o trilho acaba de montar o "Contexto" (o `contextSlot` chega depois).
  useEffect(() => {
    const node = rail.current
    if (!reveal || revealed.current === reveal || !node || !contextSlot) return
    const { section: sectionSelector, focus: focusSelector } = CONTEXT_TARGETS[reveal.target]
    const section = node.querySelector<HTMLElement>(sectionSelector)
    if (!section) return
    revealed.current = reveal
    const box = node.getBoundingClientRect()
    const place = section.getBoundingClientRect()
    const top = railScrollTarget({ top: box.top, height: box.height, scrollTop: node.scrollTop }, { top: place.top, height: place.height })
    if (top !== null) node.scrollTo({ top, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    if (reveal.focus) node.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true })
  }, [reveal, contextSlot])

  return (
    <div data-chat-screen className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        <section aria-label="Conversa" className="flex min-w-0 flex-1 flex-col">
          <ChatConversation
            key={selected ?? 'new'}
            chatId={selected}
            meetingId={null}
            meetings={meetings}
            contextOpen={contextOpen}
            onContextOpen={openContext}
            contextSlot={railOpen ? contextSlot : null}
            onContextReveal={revealContext}
            railId={CHAT_RAIL_ID}
          />
        </section>
        {/* Depois da conversa no DOM: a barra lateral do app continua sendo o primeiro `aside` da janela. */}
        {railOpen && (
          <aside ref={rail} id={CHAT_RAIL_ID} data-chat-rail aria-label="Contexto" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-line">
            <div ref={setContextSlot} data-chat-rail-context className="flex flex-col" />
          </aside>
        )}
      </div>
    </div>
  )
}
