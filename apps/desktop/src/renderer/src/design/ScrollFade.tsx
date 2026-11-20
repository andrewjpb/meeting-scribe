import { useEffect, useState, type RefObject } from 'react'

/** Altura do esmaecimento (`.scroll-fade`, 24 px). */
const FADE_PX = 24
/** Folga para "chegou ao fim" (o `scrollTop` fracionário do zoom). */
const END_SLACK = 1
/** O contorno de foco passa 4 px da linha (2 px de largura + 2 de recuo, base.css). */
const RING_PX = 4

/**
 * Contrato 68 (C): o esmaecimento no pé de uma lista rolável da barra lateral, só enquanto há mais abaixo. Fica irmão
 * da lista, num pai `relative`, e não ocupa lugar nem recebe clique. A linha focada por teclado que cairia debaixo dele
 * rola o que falta para o contorno de foco aparecer inteiro.
 */
export function ScrollFade({ target }: { target: RefObject<HTMLElement | null> }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const list = target.current
    if (!list) return undefined
    const more = (): boolean => list.scrollHeight > list.clientHeight && list.scrollHeight - list.scrollTop - list.clientHeight > END_SLACK
    const update = (): void => setVisible(more())
    // O tamanho da lista e o de cada filho (conta que abre as pastas, dia novo de conversas); filho novo entra na conta.
    const resize = new ResizeObserver(update)
    const observe = (): void => {
      resize.disconnect()
      resize.observe(list)
      for (const child of list.children) resize.observe(child)
    }
    const mutation = new MutationObserver(() => {
      observe()
      update()
    })
    let frame = 0
    const onFocus = (event: FocusEvent): void => {
      const item = event.target as HTMLElement
      if (!item.matches(':focus-visible')) return
      // Depois da rolagem que o próprio foco faz.
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!more()) return
        const overlap = item.getBoundingClientRect().bottom + RING_PX - (list.getBoundingClientRect().bottom - FADE_PX)
        if (overlap > 0) list.scrollTop += overlap
      })
    }
    observe()
    mutation.observe(list, { childList: true, subtree: true })
    list.addEventListener('scroll', update, { passive: true })
    list.addEventListener('focusin', onFocus)
    update()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
      list.removeEventListener('scroll', update)
      list.removeEventListener('focusin', onFocus)
    }
  }, [target])

  return visible ? <div aria-hidden="true" data-scroll-fade className="scroll-fade" /> : null
}
