// Contrato 172: a fonte trocada no "Contexto" vale já na pergunta seguinte. A troca que ainda espera os 300 ms é gravada
// (e aguardada) antes do envio; sem troca esperando, nada é gravado a mais; e o timer continua juntando os cliques.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPendingScope, SCOPE_DELAY_MS, scheduleScope } from '../../src/renderer/src/features/chat/ChatConversation'
import type { ChatScope } from '../../src/shared/chat'

const PASTAS_ON: ChatScope = { kind: 'all', sources: { pastas: true } }
const PASTAS_OFF: ChatScope = { kind: 'all' }

/** O que a conversa faz: o registro das chamadas prova a ordem entre gravar o escopo e enviar a pergunta. */
function conversation(saveResult = true) {
  const calls: string[] = []
  const timer: { current: ReturnType<typeof setTimeout> | null } = { current: null }
  const saving = { current: false }
  let pending: ChatScope | null = null
  const update = vi.fn(async (scope: ChatScope): Promise<boolean> => {
    calls.push(`update:${scope.sources?.pastas ? 'pastas' : 'sem-pastas'}`)
    await Promise.resolve()
    if (saveResult) pending = null
    return saveResult
  })
  const sendToMain = vi.fn(() => calls.push('send'))
  return {
    calls,
    timer,
    update,
    sendToMain,
    changeScope: (next: ChatScope): void => {
      pending = next
      scheduleScope(timer, next, (scope) => void update(scope))
    },
    send: async (): Promise<void> => {
      if (await flushPendingScope(timer, pending, update, saving)) sendToMain()
    },
  }
}

describe('Escopo gravado antes de perguntar (contrato 172)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('troca de fonte e pergunta já: grava o escopo novo antes de enviar, e o timer não grava de novo', async () => {
    const chat = conversation()
    chat.changeScope(PASTAS_ON)
    chat.changeScope(PASTAS_OFF)
    await chat.send()
    expect(chat.calls).toEqual(['update:sem-pastas', 'send'])
    expect(chat.update).toHaveBeenCalledWith(PASTAS_OFF)
    await vi.advanceTimersByTimeAsync(SCOPE_DELAY_MS * 2)
    expect(chat.update).toHaveBeenCalledTimes(1)
  })

  it('sem troca esperando, nenhum update extra', async () => {
    const chat = conversation()
    await chat.send()
    expect(chat.update).not.toHaveBeenCalled()
    expect(chat.calls).toEqual(['send'])
  })

  it('troca, espera mais de 300 ms e pergunta: um update só, o do timer', async () => {
    const chat = conversation()
    chat.changeScope(PASTAS_ON)
    await vi.advanceTimersByTimeAsync(SCOPE_DELAY_MS + 50)
    expect(chat.update).toHaveBeenCalledTimes(1)
    await chat.send()
    expect(chat.update).toHaveBeenCalledTimes(1)
    expect(chat.calls).toEqual(['update:pastas', 'send'])
  })

  it('sem pergunta, cliques seguidos continuam virando uma gravação só, 300 ms depois do último', async () => {
    const chat = conversation()
    chat.changeScope(PASTAS_ON)
    await vi.advanceTimersByTimeAsync(SCOPE_DELAY_MS - 50)
    chat.changeScope(PASTAS_OFF)
    await vi.advanceTimersByTimeAsync(SCOPE_DELAY_MS - 50)
    expect(chat.update).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    expect(chat.update).toHaveBeenCalledTimes(1)
    expect(chat.update).toHaveBeenCalledWith(PASTAS_OFF)
  })

  it('outra pergunta enquanto o escopo é gravado não sai (iria com o escopo antigo)', async () => {
    const chat = conversation()
    chat.changeScope(PASTAS_OFF)
    const first = chat.send()
    await chat.send()
    expect(chat.sendToMain).not.toHaveBeenCalled()
    await first
    expect(chat.calls).toEqual(['update:sem-pastas', 'send'])
    await chat.send()
    expect(chat.sendToMain).toHaveBeenCalledTimes(2)
    expect(chat.update).toHaveBeenCalledTimes(1)
  })

  it('a gravação falhou: a pergunta não vai', async () => {
    const chat = conversation(false)
    chat.changeScope(PASTAS_OFF)
    await chat.send()
    expect(chat.calls).toEqual(['update:sem-pastas'])
    expect(chat.sendToMain).not.toHaveBeenCalled()
  })
})
