// Contrato 12 (CA1): a conta Microsoft com a Microsoft falsa em memória. O "navegador" é um GET no endereço de volta
// (`http://localhost:<porta>`), feito em 127.0.0.1, onde o servidor do app escuta. Nada sai da máquina.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { MicrosoftAccountStatus } from '../src/shared/accounts'
import { ACCOUNTS_DIR } from '../src/main/accounts/vault'
import { AccountError } from '../src/main/accounts/account'
import { startLoopback, MICROSOFT_LOOPBACK } from '../src/main/accounts/oauth'
import { createMicrosoftAccount, MICROSOFT_CLIENT_FILE, MICROSOFT_SCOPES, MICROSOFT_SESSION_FILE } from '../src/main/microsoft/account'
import { createFakeMicrosoft, type FakeMicrosoft } from '../src/main/microsoft/fake-microsoft'
import type { SafeStorageLike } from '../src/main/secrets'

const CLIENT_ID = '11111111-2222-4333-8444-555555555555'

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

/** O navegador volta a `http://localhost:<porta>` (ou `http://[::1]:<porta>`), sem trocar por 127.0.0.1. */
function browserGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode ?? 0))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('conta Microsoft (contrato 12, CA1)', () => {
  let dir: string
  let fake: FakeMicrosoft
  let clock: number
  let statuses: MicrosoftAccountStatus[]
  let opened: string[]

  const account = (approve = true) =>
    createMicrosoftAccount({
      dir,
      safeStorage,
      fetch: fake.fetch,
      openExternal: async (url) => {
        opened.push(url)
        if (approve) await browserGet(fake.approve(url))
      },
      photoToDataUrl: (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      onStatus: (status) => statuses.push(status),
      now: () => clock,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'microsoft-'))
    fake = createFakeMicrosoft({ clientId: CLIENT_ID, profile: { name: 'Bruno Teste', email: 'bruno@example.com' } })
    clock = Date.now()
    statuses = []
    opened = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('cadastro: só o ID do aplicativo (GUID), cifrado em 0600, mascarado no estado', () => {
    const microsoft = account()
    expect(microsoft.status()).toEqual({ client: { configured: false, clientId: null }, state: 'signed-out', profile: null, error: null, calendar: false })
    expect(microsoft.saveClient({ clientId: 'meu-app' })).toMatchObject({ ok: false, error: 'invalid-id' })
    const saved = microsoft.saveClient({ clientId: `  ${CLIENT_ID.toUpperCase()}\n` })
    expect(saved).toEqual({ ok: true, status: { client: { configured: true, clientId: '111111•••555555555555' }, state: 'signed-out', profile: null, error: null, calendar: false } })
    const file = join(dir, ACCOUNTS_DIR, MICROSOFT_CLIENT_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readFileSync(file, 'utf8')).not.toContain(CLIENT_ID)
    expect(fake.calls).toEqual([])
  })

  it('"Entrar com Microsoft": endpoint comum, PKCE, volta em localhost, escopos da agenda, sem chave secreta', async () => {
    const microsoft = account()
    microsoft.saveClient({ clientId: CLIENT_ID })
    const status = await microsoft.signIn()
    const url = new URL(opened[0] ?? '')
    expect(`${url.origin}${url.pathname}`).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize')
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access User.Read Calendars.Read')
    expect(url.searchParams.get('scope')).toBe(MICROSOFT_SCOPES.join(' '))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toHaveLength(43)
    expect(url.searchParams.get('redirect_uri')).toMatch(/^http:\/\/localhost:\d+$/)
    expect(url.searchParams.get('client_secret')).toBeNull()
    expect(status).toMatchObject({ state: 'signed-in', error: null, calendar: true, profile: { name: 'Bruno Teste', email: 'bruno@example.com' } })
    expect(status.profile?.photo).toMatch(/^data:image\/png;base64,/)
    expect(microsoft.hasCalendar()).toBe(true)
    // Cliente público: nenhum pedido de token leva chave secreta.
    expect(fake.tokenFields.every((fields) => !fields.includes('client_secret'))).toBe(true)
    const file = join(dir, ACCOUNTS_DIR, MICROSOFT_SESSION_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const disk = readFileSync(file, 'utf8')
    for (const token of [...fake.accessTokens(), ...fake.refreshTokens()]) {
      expect(disk).not.toContain(token)
      expect(JSON.stringify(statuses)).not.toContain(token)
    }
    expect(fake.calls.map((call) => `${call.host}${call.path}`)).toEqual([
      'login.microsoftonline.com/common/oauth2/v2.0/token',
      'graph.microsoft.com/v1.0/me',
      'graph.microsoft.com/v1.0/me/photo/$value',
    ])
  })

  it('volta em localhost: escuta 127.0.0.1 e ::1 na mesma porta; favicon e `/` solto dão 404 sem encerrar o login', async () => {
    const loop = await startLoopback({ state: 'estado', address: MICROSOFT_LOOPBACK })
    const port = /:(\d+)$/.exec(loop.redirectUri)?.[1] ?? ''
    expect(loop.redirectUri).toBe(`http://localhost:${port}`)
    expect(await browserGet(`http://[::1]:${port}/favicon.ico`)).toBe(404)
    expect(await browserGet(`http://localhost:${port}/`)).toBe(404)
    expect(await browserGet(`http://127.0.0.1:${port}/?outro=1`)).toBe(404)
    expect(await browserGet(`http://[::1]:${port}/?code=abc&state=estado`)).toBe(200)
    expect(await loop.code).toBe('abc')
    const second = await startLoopback({ state: 'e2', address: MICROSOFT_LOOPBACK })
    expect(await browserGet(`${second.redirectUri}?code=xyz&state=e2`)).toBe(200)
    expect(await second.code).toBe('xyz')
  })

  it('resposta de token sem `scope`: vale o que foi pedido (a agenda aparece liberada)', async () => {
    const withoutScope: typeof fake.fetch = async (url, init) => {
      const reply = await fake.fetch(url, init)
      if (new URL(url).pathname !== '/common/oauth2/v2.0/token') return reply
      const body = JSON.parse(await reply.text()) as Record<string, unknown>
      const bytes = Buffer.from(JSON.stringify({ ...body, scope: undefined }))
      return { ...reply, text: () => Promise.resolve(bytes.toString()), bytes: () => Promise.resolve(bytes) }
    }
    const microsoft = createMicrosoftAccount({
      dir,
      safeStorage,
      fetch: withoutScope,
      openExternal: async (url) => void (await browserGet(fake.approve(url))),
      photoToDataUrl: () => null,
      onStatus: () => undefined,
    })
    microsoft.saveClient({ clientId: CLIENT_ID })
    expect((await microsoft.signIn()).calendar).toBe(true)
  })

  it('conta sem foto: entra sem foto', async () => {
    fake.photo = null
    const microsoft = account()
    microsoft.saveClient({ clientId: CLIENT_ID })
    expect((await microsoft.signIn()).profile).toEqual({ name: 'Bruno Teste', email: 'bruno@example.com', photo: null })
  })

  it('renovação automática (o refresh token troca) e `invalid_grant` → "Entre de novo" sem apagar nada', async () => {
    const microsoft = account()
    microsoft.saveClient({ clientId: CLIENT_ID })
    await microsoft.signIn()
    const first = await microsoft.accessToken()
    clock += 3_600_000
    const renewed = await microsoft.accessToken()
    expect(renewed).not.toBe(first)
    // A renovação manda os escopos e nenhuma chave secreta.
    expect(fake.tokenFields.at(-1)).toEqual(['client_id', 'grant_type', 'refresh_token', 'scope'])
    expect(await microsoft.accessToken(true)).not.toBe(renewed)
    fake.refreshRevoked = true
    await expect(microsoft.accessToken(true)).rejects.toBeInstanceOf(AccountError)
    expect(microsoft.status()).toMatchObject({ state: 'expired', calendar: true, profile: { email: 'bruno@example.com' } })
    expect(microsoft.hasCalendar()).toBe(false)
    expect(existsSync(join(dir, ACCOUNTS_DIR, MICROSOFT_SESSION_FILE))).toBe(true)
    expect(account().status().state).toBe('expired')
  })

  it('"Sair" apaga a sessão e mantém o cadastro; recusa no navegador volta deslogado', async () => {
    const microsoft = account()
    microsoft.saveClient({ clientId: CLIENT_ID })
    await microsoft.signIn()
    expect(await microsoft.signOut()).toMatchObject({ state: 'signed-out', profile: null, calendar: false, client: { configured: true } })
    expect(existsSync(join(dir, ACCOUNTS_DIR, MICROSOFT_SESSION_FILE))).toBe(false)
    expect(existsSync(join(dir, ACCOUNTS_DIR, MICROSOFT_CLIENT_FILE))).toBe(true)
    const denied = createMicrosoftAccount({
      dir,
      safeStorage,
      fetch: fake.fetch,
      openExternal: async (url) => void (await browserGet(fake.approve(url, { deny: true }))),
      photoToDataUrl: () => null,
      onStatus: () => undefined,
    })
    expect(await denied.signIn()).toMatchObject({ state: 'signed-out', error: 'denied' })
  })
})
