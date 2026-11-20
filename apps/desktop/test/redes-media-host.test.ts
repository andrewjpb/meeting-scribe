import { describe, expect, it } from 'vitest'
import type { HttpFetch } from '../src/main/accounts/http'
import type { MediaHostConfig } from '../src/shared/redes'
import { createFakeS3 } from '../src/main/redes/fake-s3'
import { removeMedia, testMediaHost, uploadMedia } from '../src/main/redes/media-host'
import { createS3Client } from '../src/main/redes/s3'

const SECRET = 'segredo-de-teste-do-bucket'
const CONFIG: MediaHostConfig = {
  endpoint: 'https://conta.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'midia',
  accessKeyId: 'AKIATESTEFALSO',
  publicBaseUrl: 'https://midia.exemplo.com.br',
  pathStyle: true,
}

function noFetch(): { fetch: HttpFetch; calls: number } {
  const spy = {
    calls: 0,
    fetch: (() => {
      spy.calls++
      return Promise.reject(new Error('não devia chamar'))
    }) as HttpFetch,
  }
  return spy
}

describe('Testar o armazenamento de mídia', () => {
  it('sobe 1 byte, lê pela URL pública e apaga', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, strictSignature: true })
    expect(await testMediaHost(CONFIG, SECRET, fake.fetch)).toEqual({ ok: true, detail: 'Upload e leitura pública ok' })
    expect(fake.calls.map((call) => `${call.method} ${call.host}`)).toEqual(['PUT conta.r2.cloudflarestorage.com', 'GET midia.exemplo.com.br', 'DELETE conta.r2.cloudflarestorage.com'])
    expect(fake.calls[0]?.path).toMatch(/^\/midia\/instagram\/_teste\/[0-9a-f-]{36}\.txt$/)
    expect(fake.calls[1]?.path).toBe(fake.calls[0]?.path.replace(/^\/midia/, ''))
    expect(fake.objects().size).toBe(0)
  })

  it('funciona com http no próprio Mac (o smoke)', async () => {
    const config = { ...CONFIG, endpoint: 'http://127.0.0.1:9000', publicBaseUrl: 'http://localhost:9001/publico' }
    const fake = createFakeS3({ ...config, secretAccessKey: SECRET, strictSignature: true })
    expect((await testMediaHost(config, SECRET, fake.fetch)).ok).toBe(true)
  })

  it('o endereço público sem o objeto: diz o passo e apaga o arquivo de teste', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET })
    fake.publicAccess = false
    const result = await testMediaHost(CONFIG, SECRET, fake.fetch)
    expect(result).toEqual({ ok: false, detail: 'O endereço público não devolveu o arquivo (status 403): confira a URL pública base e o acesso público do bucket' })
    expect(fake.calls.at(-1)?.method).toBe('DELETE')
    expect(fake.objects().size).toBe(0)
  })

  it('URL pública apontando para outro lugar: 404 no passo da leitura', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, publicBaseUrl: 'https://midia.exemplo.com.br/outra-pasta' })
    const result = await testMediaHost(CONFIG, SECRET, fake.fetch)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/^O endereço público não devolveu o arquivo \(status 404\)/)
    expect(fake.objects().size).toBe(0)
  })

  it('upload recusado: diz o passo, sem a chave', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, strictSignature: true })
    const result = await testMediaHost(CONFIG, 'chave-errada', fake.fetch)
    expect(result).toEqual({ ok: false, detail: 'Upload falhou: Chaves ou permissões recusadas pelo armazenamento' })
    expect(result.detail).not.toContain('chave-errada')
  })

  it('não consegue apagar: diz o passo', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET })
    const fetch: HttpFetch = (url, init) => (init.method === 'DELETE' ? Promise.resolve({ status: 403, header: () => null, text: () => Promise.resolve(''), bytes: () => Promise.resolve(new Uint8Array(0)) }) : fake.fetch(url, init))
    expect(await testMediaHost(CONFIG, SECRET, fetch)).toEqual({ ok: false, detail: 'Não consegui apagar o arquivo de teste: Chaves ou permissões recusadas pelo armazenamento' })
  })

  it.each([
    [{ endpoint: 'http://s3.exemplo.com' }, 'Configuração inválida: O endpoint precisa começar com https://'],
    [{ publicBaseUrl: 'http://midia.exemplo.com.br' }, 'Configuração inválida: A URL pública base precisa começar com https://'],
    [{ endpoint: 'não é url' }, 'Configuração inválida: O endpoint não é um endereço válido'],
    [{ bucket: '  ' }, 'Configuração inválida: Falta o bucket'],
    [{ region: '' }, 'Configuração inválida: Falta a região'],
    [{ accessKeyId: '' }, 'Configuração inválida: Faltam as chaves de acesso'],
  ])('config inválida %o é recusada sem chamar o fetch', async (change, detail) => {
    const spy = noFetch()
    expect(await testMediaHost({ ...CONFIG, ...change }, SECRET, spy.fetch)).toEqual({ ok: false, detail })
    expect(spy.calls).toBe(0)
  })

  it('uploadMedia e removeMedia usam o cliente', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, strictSignature: true })
    const client = createS3Client(fake.fetch, CONFIG, SECRET)
    expect(await uploadMedia(client, 'instagram/conta/1.jpg', new Uint8Array([1, 2, 3]), 'image/jpeg')).toEqual({ ok: true, url: 'https://midia.exemplo.com.br/instagram/conta/1.jpg' })
    expect([...fake.objects().keys()]).toEqual(['instagram/conta/1.jpg'])
    expect(await removeMedia(client, 'instagram/conta/1.jpg')).toEqual({ ok: true })
    expect(fake.objects().size).toBe(0)
  })
})
