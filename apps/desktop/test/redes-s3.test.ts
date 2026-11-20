import { describe, expect, it } from 'vitest'
import type { HttpFetch, HttpResponse } from '../src/main/accounts/http'
import type { MediaHostConfig } from '../src/shared/redes'
import { createFakeS3 } from '../src/main/redes/fake-s3'
import { assertHost, canonicalRequest, createS3Client, EMPTY_PAYLOAD_HASH, mediaHostHosts, S3_ERRORS, s3ErrorText, safeKey, sha256Hex, signS3Request } from '../src/main/redes/s3'

const SECRET = 'segredo-de-teste-do-bucket'
const CONFIG: MediaHostConfig = {
  endpoint: 'https://conta.r2.cloudflarestorage.com',
  region: 'auto',
  bucket: 'midia',
  accessKeyId: 'AKIATESTEFALSO',
  publicBaseUrl: 'https://midia.exemplo.com.br',
  pathStyle: true,
}

const status = (code: number): HttpResponse => ({ status: code, header: () => null, text: () => Promise.resolve(''), bytes: () => Promise.resolve(new Uint8Array(0)) })

/** `fetch` que responde sempre o mesmo status e conta as chamadas. */
function fixed(code: number): { fetch: HttpFetch; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: (url) => {
      calls.push(url)
      return Promise.resolve(status(code))
    },
  }
}

describe('assinatura AWS SigV4', () => {
  it('confere com o vetor oficial get-vanilla', () => {
    const headers = signS3Request({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      payloadHash: EMPTY_PAYLOAD_HASH,
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      service: 'service',
      now: new Date('2015-08-30T12:36:00Z'),
    })
    expect(headers['x-amz-date']).toBe('20150830T123600Z')
    expect(headers['host']).toBe('example.amazonaws.com')
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    )
  })

  it('confere com o exemplo GET Object da documentação do S3 (com range e x-amz-content-sha256)', () => {
    const headers = signS3Request({
      method: 'GET',
      url: 'https://examplebucket.s3.amazonaws.com/test.txt',
      headers: { Range: 'bytes=0-9' },
      payloadHash: EMPTY_PAYLOAD_HASH,
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      now: new Date('2013-05-24T00:00:00Z'),
    })
    expect(headers['x-amz-content-sha256']).toBe(EMPTY_PAYLOAD_HASH)
    expect(headers['authorization']).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('ordena a consulta e codifica o caminho por segmento', () => {
    const { canonical } = canonicalRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/a%20b/c?z=1&a=2&a=1',
      payloadHash: EMPTY_PAYLOAD_HASH,
      accessKeyId: 'AKID',
      secretAccessKey: 'x',
      region: 'us-east-1',
      now: new Date('2026-11-20T10:00:00Z'),
    })
    const lines = canonical.split('\n')
    expect(lines[1]).toBe('/a%20b/c')
    expect(lines[2]).toBe('a=1&a=2&z=1')
  })

  it('PUT com corpo: o canonical request leva o sha256 do corpo e o falso em strictSignature aceita', async () => {
    const bytes = new TextEncoder().encode('conteúdo da imagem')
    const input = { method: 'PUT', url: `${CONFIG.endpoint}/midia/instagram/a.jpg`, headers: { 'content-type': 'image/jpeg' }, payloadHash: sha256Hex(bytes), accessKeyId: CONFIG.accessKeyId, secretAccessKey: SECRET, region: CONFIG.region, now: new Date('2026-11-20T10:00:00Z') }
    const { canonical, signedHeaders } = canonicalRequest(input)
    expect(canonical.endsWith(`\n${sha256Hex(bytes)}`)).toBe(true)
    expect(canonical).toContain(`x-amz-content-sha256:${sha256Hex(bytes)}\n`)
    expect(signedHeaders).toBe('content-type;host;x-amz-content-sha256;x-amz-date')

    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, strictSignature: true })
    const client = createS3Client(fake.fetch, CONFIG, SECRET)
    expect(await client.put('instagram/a.jpg', bytes, 'image/jpeg')).toEqual({ ok: true, url: 'https://midia.exemplo.com.br/instagram/a.jpg' })
    expect(fake.objects().get('instagram/a.jpg')?.contentType).toBe('image/jpeg')
    expect(Buffer.from(fake.objects().get('instagram/a.jpg')?.body ?? []).toString('utf8')).toBe('conteúdo da imagem')
    expect(await client.head('instagram/a.jpg')).toEqual({ exists: true })
    expect(await client.head('instagram/b.jpg')).toEqual({ exists: false })
    expect(await client.delete('instagram/a.jpg')).toEqual({ ok: true })
    expect(fake.objects().size).toBe(0)
    expect(JSON.stringify(fake.calls)).not.toContain(SECRET)
  })

  it('o falso em strictSignature recusa a chave secreta errada', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET, strictSignature: true })
    const client = createS3Client(fake.fetch, CONFIG, 'outra-chave')
    expect(await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')).toEqual({ ok: false, error: S3_ERRORS.forbidden })
    expect(fake.objects().size).toBe(0)
  })

  it('o falso recusa a chave de acesso de outra conta', async () => {
    const fake = createFakeS3({ ...CONFIG, secretAccessKey: SECRET })
    const client = createS3Client(fake.fetch, { ...CONFIG, accessKeyId: 'AKIAOUTRA' }, SECRET)
    expect(await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')).toEqual({ ok: false, error: S3_ERRORS.forbidden })
  })
})

describe('chaves e endereços dos objetos', () => {
  it('normaliza espaço, acento e maiúsculas', () => {
    expect(safeKey(['Instagram', 'Conta Ação', 'Foto  de Verão (1).JPG'])).toBe('instagram/conta-acao/foto-de-verao-1-.jpg')
    expect(safeKey(['instagram/../_teste', '', 'çã ü.txt'])).toBe('instagram/_teste/ca-u.txt')
    expect(safeKey(['instagram', '_teste', 'abc.txt'])).toMatch(/^[a-z0-9/_.-]+$/)
  })

  it('objectUrl e publicUrl no modo de caminho e no host virtual', () => {
    const path = createS3Client(fixed(200).fetch, CONFIG, SECRET)
    expect(path.objectUrl('instagram/a.jpg')).toBe('https://conta.r2.cloudflarestorage.com/midia/instagram/a.jpg')
    expect(path.publicUrl('instagram/a.jpg')).toBe('https://midia.exemplo.com.br/instagram/a.jpg')

    const virtual = createS3Client(fixed(200).fetch, { ...CONFIG, endpoint: 'https://s3.sa-east-1.amazonaws.com/', pathStyle: false, publicBaseUrl: 'https://cdn.exemplo.com.br/base/' }, SECRET)
    expect(virtual.objectUrl('instagram/a.jpg')).toBe('https://midia.s3.sa-east-1.amazonaws.com/instagram/a.jpg')
    expect(virtual.publicUrl('instagram/a.jpg')).toBe('https://cdn.exemplo.com.br/base/instagram/a.jpg')
  })

  it('o host virtual funciona de ponta a ponta com o falso', async () => {
    const config = { ...CONFIG, endpoint: 'https://s3.sa-east-1.amazonaws.com', region: 'sa-east-1', pathStyle: false }
    const fake = createFakeS3({ ...config, secretAccessKey: SECRET, strictSignature: true })
    const client = createS3Client(fake.fetch, config, SECRET)
    expect((await client.put('instagram/v.jpg', new Uint8Array([7]), 'image/jpeg')).ok).toBe(true)
    expect(fake.calls[0]).toEqual({ method: 'PUT', host: 'midia.s3.sa-east-1.amazonaws.com', path: '/instagram/v.jpg' })
  })

  it('recusa chave fora do padrão sem chamar o fetch', async () => {
    const http = fixed(200)
    const client = createS3Client(http.fetch, CONFIG, SECRET)
    expect(await client.put('Instagram/Foto Nova.jpg', new Uint8Array([1]), 'image/jpeg')).toEqual({ ok: false, error: S3_ERRORS.key })
    expect(http.calls).toEqual([])
  })
})

describe('hosts permitidos', () => {
  it('só o endpoint, o host virtual e a URL pública da configuração', () => {
    expect(mediaHostHosts(CONFIG)).toEqual(['conta.r2.cloudflarestorage.com', 'midia.exemplo.com.br'])
    expect(mediaHostHosts({ ...CONFIG, pathStyle: false })).toContain('midia.conta.r2.cloudflarestorage.com')
    expect(() => assertHost('https://outro.exemplo.com/x', mediaHostHosts(CONFIG))).toThrow(S3_ERRORS.host)
    expect(() => assertHost('https://conta.r2.cloudflarestorage.com/midia/x', mediaHostHosts(CONFIG))).not.toThrow()
  })

  it('host fora da lista é recusado antes de chamar o fetch', async () => {
    const http = fixed(200)
    const client = createS3Client(http.fetch, { ...CONFIG, endpoint: 'http://s3.exemplo.com' }, SECRET)
    expect(await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')).toEqual({ ok: false, error: S3_ERRORS.host })
    expect(await client.delete('instagram/a.jpg')).toEqual({ ok: false, error: S3_ERRORS.host })
    expect(await client.head('instagram/a.jpg')).toEqual({ exists: false })
    expect(http.calls).toEqual([])
  })

  it('http só no próprio Mac', async () => {
    const http = fixed(200)
    const client = createS3Client(http.fetch, { ...CONFIG, endpoint: 'http://127.0.0.1:9000', publicBaseUrl: 'http://127.0.0.1:9000/midia' }, SECRET)
    expect((await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')).ok).toBe(true)
    expect(http.calls).toEqual(['http://127.0.0.1:9000/midia/instagram/a.jpg'])
  })
})

describe('erros do armazenamento', () => {
  it.each([
    [403, 'Chaves ou permissões recusadas pelo armazenamento'],
    [404, 'Bucket não encontrado'],
    [301, 'Região ou endpoint errado'],
    [307, 'Região ou endpoint errado'],
    [500, 'Armazenamento respondeu 500'],
  ])('status %i no upload vira texto', async (code, text) => {
    const client = createS3Client(fixed(code).fetch, CONFIG, SECRET)
    const result = await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')
    expect(result).toEqual({ ok: false, error: text })
    expect(s3ErrorText(code)).toBe(text)
    expect(JSON.stringify(result)).not.toContain(SECRET)
    expect(JSON.stringify(result)).not.toContain(CONFIG.accessKeyId)
  })

  it('falha de rede vira texto, sem chave nem assinatura', async () => {
    const client = createS3Client(() => Promise.reject(new TypeError(`fetch failed ${SECRET}`)), CONFIG, SECRET)
    const result = await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')
    expect(result).toEqual({ ok: false, error: 'Não foi possível falar com o armazenamento' })
  })

  it('delete: 204, 200 e 404 contam como ok; 403 não', async () => {
    for (const code of [200, 204, 404]) expect(await createS3Client(fixed(code).fetch, CONFIG, SECRET).delete('instagram/a.jpg')).toEqual({ ok: true })
    expect(await createS3Client(fixed(403).fetch, CONFIG, SECRET).delete('instagram/a.jpg')).toEqual({ ok: false, error: S3_ERRORS.forbidden })
  })

  it('o host não vai no cabeçalho do fetch (quem manda é o transporte)', async () => {
    const seen: Record<string, string>[] = []
    const client = createS3Client((_url, init) => {
      seen.push(init.headers)
      return Promise.resolve(status(200))
    }, CONFIG, SECRET)
    await client.put('instagram/a.jpg', new Uint8Array([1]), 'image/jpeg')
    expect(seen[0]?.['host']).toBeUndefined()
    expect(seen[0]?.['authorization']).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATESTEFALSO\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/)
  })
})
