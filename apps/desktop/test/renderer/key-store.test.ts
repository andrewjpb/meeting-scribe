import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useApiKey } from '../../src/renderer/src/features/settings/keyStore'

describe('keyStore.save', () => {
  const invoke = vi.fn()
  const status = { configured: true, last4: '4f2a', source: 'saved' as const }

  beforeEach(() => {
    invoke.mockReset()
    vi.stubGlobal('window', { __scribeApi: { invoke } })
    useApiKey.setState({ status, check: 'valid', busy: null, loadFailed: false, saveFailed: false })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('o main falhou ao guardar: não diz que guardou e oferece tentar de novo', async () => {
    invoke.mockRejectedValueOnce(new Error('EACCES'))
    expect(await useApiKey.getState().save('chave-nova-1234')).toBeNull()
    expect(useApiKey.getState()).toMatchObject({ saveFailed: true, busy: null, check: 'valid', status })

    invoke.mockResolvedValueOnce({ check: 'valid', status: { configured: true, last4: '1234', source: 'saved' } })
    expect(await useApiKey.getState().save('chave-nova-1234')).toBe('valid')
    expect(useApiKey.getState()).toMatchObject({ saveFailed: false, check: 'valid', status: { last4: '1234' } })
  })
})
