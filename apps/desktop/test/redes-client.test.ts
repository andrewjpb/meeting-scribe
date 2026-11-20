// Contrato 69: o cliente da Instagram API (perfil, renovação, erros em pt-BR e a lista de destinos), com o Instagram
// falso em memória. Nada sai da máquina.
import { describe, expect, it } from 'vitest'
import type { HttpFetch } from '../src/main/accounts/http'
import { createFakeInstagram, FAKE_IG_REFRESH_EXPIRES_IN, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID } from '../src/main/redes/fake-instagram'
import { createInstagramClient, INSTAGRAM_API_VERSION, INSTAGRAM_NETWORK_ERROR, instagramErrorMessage } from '../src/main/redes/instagram-client'
import { redesAllowedUrl } from '../src/main/redes/hosts'

describe('cliente do Instagram (contrato 69)', () => {
  it('me: o perfil tipado, com o token só no cabeçalho Bearer', async () => {
    const fake = createFakeInstagram()
    const result = await createInstagramClient(fake.fetch).me(SMOKE_IG_TOKEN)
    expect(result).toEqual({
      ok: true,
      profile: { userId: SMOKE_IG_USER_ID, username: 'lap.teste', name: 'LAP Teste', accountType: 'business', pictureUrl: null, followers: 1284, follows: 210, mediaCount: 37 },
    })
    expect(fake.calls).toEqual([{ method: 'GET', host: 'graph.instagram.com', path: `/${INSTAGRAM_API_VERSION}/me`, bearer: true, tokenInQuery: false }])
  })

  it('me: o tipo Creator e os números ausentes', async () => {
    const fake = createFakeInstagram({ profile: { user_id: '42', username: 'criadora', name: null, account_type: 'MEDIA_CREATOR', followers_count: -1, follows_count: 0, media_count: 3 } })
    const result = await createInstagramClient(fake.fetch).me(SMOKE_IG_TOKEN)
    expect(result.ok && result.profile).toMatchObject({ userId: '42', accountType: 'creator', name: null, followers: null, mediaCount: 3 })
  })

  it('me: token recusado vira "Token recusado pelo Instagram"', async () => {
    const result = await createInstagramClient(createFakeInstagram().fetch).me('IGAAoutro')
    expect(result).toEqual({ ok: false, error: 'Token recusado pelo Instagram', code: 190, subcode: null })
  })

  it('refreshToken: o novo token e o expires_in, sem token na URL', async () => {
    const fake = createFakeInstagram()
    const result = await createInstagramClient(fake.fetch).refreshToken(SMOKE_IG_TOKEN)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.expiresInSeconds).toBe(FAKE_IG_REFRESH_EXPIRES_IN)
    expect(result.accessToken).not.toBe(SMOKE_IG_TOKEN)
    expect(fake.tokens()).toContain(result.accessToken)
    expect(fake.calls[0]).toMatchObject({ path: '/refresh_access_token', bearer: true, tokenInQuery: false })
  })

  it('refreshToken: token revogado vira 190', async () => {
    const fake = createFakeInstagram()
    fake.revoke(SMOKE_IG_TOKEN)
    expect(await createInstagramClient(fake.fetch).refreshToken(SMOKE_IG_TOKEN)).toMatchObject({ ok: false, code: 190, error: 'Token recusado pelo Instagram' })
  })

  it('falha de rede e resposta fora do formato', async () => {
    const offline: HttpFetch = () => Promise.reject(new TypeError('fetch failed'))
    expect(await createInstagramClient(offline).me(SMOKE_IG_TOKEN)).toMatchObject({ ok: false, error: INSTAGRAM_NETWORK_ERROR, code: null })
    const odd: HttpFetch = () => Promise.resolve({ status: 200, header: () => null, text: () => Promise.resolve('{"username":"x"}'), bytes: () => Promise.resolve(new Uint8Array()) })
    expect(await createInstagramClient(odd).me(SMOKE_IG_TOKEN)).toMatchObject({ ok: false, code: null })
    const html: HttpFetch = () => Promise.resolve({ status: 502, header: () => null, text: () => Promise.resolve('<html>'), bytes: () => Promise.resolve(new Uint8Array()) })
    expect(await createInstagramClient(html).refreshToken(SMOKE_IG_TOKEN)).toMatchObject({ ok: false, error: 'Instagram respondeu 502' })
  })

  it('host fora da lista é recusado antes de chamar o fetch', async () => {
    let called = 0
    const fetch: HttpFetch = () => {
      called++
      return Promise.reject(new Error('não devia chamar'))
    }
    expect(await createInstagramClient(fetch, { base: 'https://graph.instagram.com.example' }).me(SMOKE_IG_TOKEN)).toMatchObject({ ok: false, error: 'Destino fora da lista do Instagram' })
    expect(await createInstagramClient(fetch, { base: 'http://graph.instagram.com' }).me(SMOKE_IG_TOKEN)).toMatchObject({ ok: false })
    expect(called).toBe(0)
  })

  it('redesAllowedUrl: https na lista, http só no próprio Mac, sem usuário', () => {
    expect(redesAllowedUrl('https://graph.instagram.com/v27.0/me', ['graph.instagram.com'])).toBe(true)
    expect(redesAllowedUrl('https://graph.instagram.com:444/v27.0/me', ['graph.instagram.com'])).toBe(false)
    expect(redesAllowedUrl('https://user:x@graph.instagram.com/', ['graph.instagram.com'])).toBe(false)
    expect(redesAllowedUrl('http://graph.instagram.com/', ['graph.instagram.com'])).toBe(false)
    expect(redesAllowedUrl('http://127.0.0.1:9000/bucket', ['127.0.0.1:9000'])).toBe(true)
    expect(redesAllowedUrl('http://localhost:9000/bucket', ['localhost:9000'])).toBe(true)
    expect(redesAllowedUrl('não é url', ['graph.instagram.com'])).toBe(false)
  })

  it('a tabela de erros da Meta em pt-BR', () => {
    const cases: [Parameters<typeof instagramErrorMessage>[0], string][] = [
      [{ code: 190 }, 'Token recusado pelo Instagram'],
      [{ code: 4 }, 'Limite de chamadas do Instagram; tente mais tarde'],
      [{ code: 17 }, 'Limite de chamadas do Instagram; tente mais tarde'],
      [{ code: 80002 }, 'Limite de chamadas do Instagram; tente mais tarde'],
      [{ code: 10 }, 'Permissão não concedida ao app'],
      [{ code: 200 }, 'Permissão não concedida ao app'],
      [{ code: 9004, error_subcode: 2207052 }, 'O Instagram não conseguiu baixar a mídia'],
      [{ code: 9007, error_subcode: 2207027 }, 'Mídia ainda não está pronta'],
      [{ code: 36003, error_subcode: 2207009 }, 'Proporção fora de 4:5 a 1,91:1'],
      [{ code: 36000, error_subcode: 2207004 }, 'Imagem acima de 8 MB'],
      [{ code: 352, error_subcode: 2207026 }, 'Formato de vídeo não aceito'],
      [{ code: 24, error_subcode: 2207008 }, 'Publicação expirou antes de concluir'],
      [{ code: 25, error_subcode: 2207050 }, 'Conta restrita pelo Instagram'],
      [{ code: 4, error_subcode: 2207051 }, 'Bloqueado pelo Instagram como spam'],
      [{ code: 9, error_subcode: 2207042 }, 'Cota de publicações das últimas 24 h esgotada'],
      [{ code: 9004 }, 'O Instagram não conseguiu baixar a mídia'],
      [{ code: 1234, message: 'texto da Meta' }, 'Instagram respondeu com erro 1234'],
    ]
    for (const [error, text] of cases) expect(instagramErrorMessage(error), JSON.stringify(error)).toBe(text)
  })
})
