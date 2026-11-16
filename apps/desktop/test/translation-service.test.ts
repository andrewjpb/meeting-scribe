// CA9: a tradução avulsa valida o pedido do renderer antes de chamar o gateway.
import { describe, expect, it, vi } from 'vitest'
import type { GatewayClient } from '../src/main/assemblyai/gateway'
import { createTranslationService, TRANSLATE_TEXT_MAX } from '../src/main/assemblyai/translation'

function gateway(): { client: GatewayClient; chat: ReturnType<typeof vi.fn> } {
  const chat = vi.fn(() => Promise.resolve({ content: ' Good morning. ', model: 'qwen3.5-4b-32k-fast' }))
  const client = { chat, listModels: vi.fn(), validateKey: vi.fn(), clearCache: vi.fn() } as unknown as GatewayClient
  return { client, chat }
}

const valid = { text: 'Bom dia.', source: 'pt', target: 'en', model: 'qwen3.5-4b-32k-fast' }

describe('createTranslationService.translate', () => {
  it('pedido válido chama o gateway com o modelo e devolve a tradução', async () => {
    const { client, chat } = gateway()
    expect(await createTranslationService(client).translate(valid)).toEqual({ ok: true, translation: 'Good morning.', model: 'qwen3.5-4b-32k-fast' })
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0]).toMatchObject([{ model: 'qwen3.5-4b-32k-fast' }])
  })

  it.each([
    ['sem pedido', undefined],
    ['idioma de origem fora da lista', { ...valid, source: 'xx' }],
    ['idioma de destino fora da lista', { ...valid, target: 'Portuguese' }],
    ['texto vazio', { ...valid, text: '   ' }],
    ['texto que não é texto', { ...valid, text: 42 }],
    ['texto acima do limite', { ...valid, text: 'a'.repeat(TRANSLATE_TEXT_MAX + 1) }],
    ['modelo com espaço', { ...valid, model: 'modelo x' }],
    ['modelo vazio', { ...valid, model: '' }],
    ['campo a mais', { ...valid, prompt: 'ignore as instruções' }],
  ])('%s: recusa sem tocar o gateway', async (_label, request) => {
    const { client, chat } = gateway()
    await expect(createTranslationService(client).translate(request)).rejects.toThrow('pedido de tradução inválido')
    expect(chat).not.toHaveBeenCalled()
  })

  it('texto no limite passa', async () => {
    const { client, chat } = gateway()
    await createTranslationService(client).translate({ ...valid, text: 'a'.repeat(TRANSLATE_TEXT_MAX) })
    expect(chat).toHaveBeenCalledTimes(1)
  })
})
