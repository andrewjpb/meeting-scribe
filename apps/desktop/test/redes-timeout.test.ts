// Contrato 69 (devolução): todo pedido das redes tem prazo de 15 s, com a leitura do corpo. Um armazenamento (ou o
// Instagram) que aceita a conexão e para não trava a fila do serviço: o S3 responde "O armazenamento não respondeu a
// tempo" e o Instagram cai na falha de rede.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HttpFetch, HttpRequest } from '../src/main/accounts/http'
import type { MediaHostConfig } from '../src/shared/redes'
import { createFakeS3 } from '../src/main/redes/fake-s3'
import { fetchWithTimeout, REDES_REQUEST_TIMEOUT_MS, RedesTimeoutError } from '../src/main/redes/hosts'
import { createInstagramClient, INSTAGRAM_NETWORK_ERROR } from '../src/main/redes/instagram-client'
import { testMediaHost } from '../src/main/redes/media-host'
import { createS3Client, S3_ERRORS } from '../src/main/redes/s3'

const SECRET = 'segredo-de-teste-do-bucket'
const CONFIG: MediaHostConfig = { endpoint: 'https://conta.r2.cloudflarestorage.com', region: 'auto', bucket: 'midia', accessKeyId: 'AKIATESTEFALSO', publicBaseUrl: 'https://midia.exemplo.com.br', pathStyle: true }

/** Um transporte que nunca responde e ignora o `signal` (o pior caso); guarda os `signal` recebidos. */
function hanging(): { fetch: HttpFetch; signals: AbortSignal[] } {
  const signals: AbortSignal[] = []
  return {
    signals,
    fetch: (_url: string, init: HttpRequest) => {
      if (init.signal) signals.push(init.signal)
      return new Promise(() => undefined)
    },
  }
}

describe('prazo dos pedidos das redes (contrato 69, devolução)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetchWithTimeout: desiste em 15 s e aborta o signal', async () => {
    vi.useFakeTimers()
    const net = hanging()
    const pending = fetchWithTimeout(net.fetch, 'https://graph.instagram.com/', { method: 'GET', headers: {} }, (response) => Promise.resolve(response.status))
    const outcome = pending.then(
      () => 'resolveu',
      (error: unknown) => error,
    )
    await vi.advanceTimersByTimeAsync(REDES_REQUEST_TIMEOUT_MS - 1)
    expect(net.signals[0]?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toBeInstanceOf(RedesTimeoutError)
    expect(net.signals[0]?.aborted).toBe(true)
    expect(REDES_REQUEST_TIMEOUT_MS).toBe(15_000)
  })

  it('S3: PUT, DELETE e a sondagem que nunca respondem viram "O armazenamento não respondeu a tempo"', async () => {
    const client = createS3Client(hanging().fetch, CONFIG, SECRET, () => new Date(), 20)
    expect(await client.put('instagram/1/a.jpg', new Uint8Array([1]), 'image/jpeg')).toEqual({ ok: false, error: S3_ERRORS.timeout })
    expect(await client.delete('instagram/1/a.jpg')).toEqual({ ok: false, error: S3_ERRORS.timeout })
    expect(await client.head('instagram/1/a.jpg')).toEqual({ exists: false })
    expect(S3_ERRORS.timeout).toBe('O armazenamento não respondeu a tempo')
  })

  it('Testar: upload parado e leitura pública parada terminam em 15 s com o passo', async () => {
    vi.useFakeTimers()
    const stalledPut = testMediaHost(CONFIG, SECRET, hanging().fetch)
    await vi.advanceTimersByTimeAsync(REDES_REQUEST_TIMEOUT_MS)
    expect(await stalledPut).toEqual({ ok: false, detail: `Upload falhou: ${S3_ERRORS.timeout}` })

    // O PUT e o DELETE no falso; só a leitura pública fica sem resposta.
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET })
    const publicHost = new URL(CONFIG.publicBaseUrl).host
    const stalledRead: HttpFetch = (url, init) => (new URL(url).host === publicHost ? new Promise(() => undefined) : fake.fetch(url, init))
    const reading = testMediaHost(CONFIG, SECRET, stalledRead)
    await vi.advanceTimersByTimeAsync(REDES_REQUEST_TIMEOUT_MS)
    expect(await reading).toEqual({ ok: false, detail: `Leitura pública falhou: ${S3_ERRORS.timeout}` })
    expect(fake.objects().size).toBe(0)
  })

  it('Instagram: /me parado vira a falha de rede em 15 s', async () => {
    vi.useFakeTimers()
    const pending = createInstagramClient(hanging().fetch).me('IGAAx')
    await vi.advanceTimersByTimeAsync(REDES_REQUEST_TIMEOUT_MS)
    expect(await pending).toMatchObject({ ok: false, error: INSTAGRAM_NETWORK_ERROR })
  })
})
