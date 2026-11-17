import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { GoogleAccountStatus } from '../src/shared/accounts'
import { ACCOUNTS_DIR } from '../src/main/accounts/vault'
import { AccountError, createGoogleAccount, GOOGLE_CLIENT_FILE, GOOGLE_SCOPES, GOOGLE_SESSION_FILE, REFRESH_MARGIN_MS } from '../src/main/google/account'
import { createFakeGoogle, type FakeGoogle } from '../src/main/google/fake-google'
import type { SafeStorageLike } from '../src/main/secrets'

const CLIENT_ID = '123456789012-abcdefghij.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-segredo-de-teste'

/** `safeStorage` falso: inverte o texto e marca (nada legível no disco). */
const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

function browserGet(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = request(url, (res) => {
      res.resume()
      res.on('end', () => resolve())
    })
    req.on('error', reject)
    req.end()
  })
}

describe('conta Google (CA2, CA3)', () => {
  let dir: string
  let fake: FakeGoogle
  let clock: number
  let statuses: GoogleAccountStatus[]
  let opened: string[]
  let signedIn: string[]
  let signedOut: number

  const account = (approve = true) =>
    createGoogleAccount({
      dir,
      safeStorage,
      fetch: fake.fetch,
      openExternal: async (url) => {
        opened.push(url)
        if (approve) await browserGet(fake.approve(url))
      },
      photoToDataUrl: (bytes) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`,
      onStatus: (status) => statuses.push(status),
      onSignedIn: (email) => signedIn.push(email),
      onSignedOut: () => signedOut++,
      now: () => clock,
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'google-'))
    fake = createFakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, profile: { name: 'Andrea Teste', email: 'andrea@example.com' } })
    clock = Date.now()
    statuses = []
    opened = []
    signedIn = []
    signedOut = 0
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('cadastro: confere o formato, guarda cifrado em 0600 e só devolve o ID mascarado', () => {
    const google = account()
    expect(google.status()).toEqual({ client: { configured: false, clientId: null }, state: 'signed-out', profile: null, error: null, calendar: false })
    expect(google.saveClient({ clientId: 'qualquer-coisa', clientSecret: CLIENT_SECRET })).toMatchObject({ ok: false, error: 'invalid-id' })
    expect(google.saveClient({ clientId: CLIENT_ID, clientSecret: 'curta' })).toMatchObject({ ok: false, error: 'invalid-secret' })
    expect(google.saveClient({ clientId: CLIENT_ID, clientSecret: 'com espaço no meio' })).toMatchObject({ ok: false, error: 'invalid-secret' })
    const saved = google.saveClient({ clientId: `  ${CLIENT_ID}\n`, clientSecret: CLIENT_SECRET })
    expect(saved).toEqual({ ok: true, status: { client: { configured: true, clientId: '123456•••rcontent.com' }, state: 'signed-out', profile: null, error: null, calendar: false } })
    const file = join(dir, ACCOUNTS_DIR, GOOGLE_CLIENT_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, ACCOUNTS_DIR)).mode & 0o777).toBe(0o700)
    const disk = readFileSync(file, 'utf8')
    expect(disk).not.toContain(CLIENT_SECRET)
    expect(disk).not.toContain(CLIENT_ID)
    expect(JSON.stringify(saved)).not.toContain(CLIENT_SECRET)
    // Reaberto: lê do disco.
    expect(account().status().client.configured).toBe(true)
  })

  it('sem cifragem: nada é escrito', () => {
    const google = createGoogleAccount({
      dir,
      safeStorage: { ...safeStorage, isEncryptionAvailable: () => false },
      fetch: fake.fetch,
      openExternal: () => undefined,
      photoToDataUrl: () => null,
      onStatus: () => undefined,
    })
    expect(google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })).toMatchObject({ ok: false, error: 'unavailable' })
    expect(existsSync(join(dir, ACCOUNTS_DIR, GOOGLE_CLIENT_FILE))).toBe(false)
  })

  it('login: escopos, offline + consent, perfil com foto, tokens cifrados e nunca no estado', async () => {
    const google = account()
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    const status = await google.signIn()
    const url = new URL(opened[0] ?? '')
    expect(url.searchParams.get('scope')).toBe(GOOGLE_SCOPES.join(' '))
    // Contrato 12 (CA2): o login pede também a agenda, só leitura, somando ao que já foi liberado.
    expect(url.searchParams.get('scope')).toBe('openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.readonly')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(status.calendar).toBe(true)
    expect(google.hasCalendar()).toBe(true)
    expect(status).toMatchObject({ state: 'signed-in', error: null, profile: { name: 'Andrea Teste', email: 'andrea@example.com' } })
    expect(status.profile?.photo).toMatch(/^data:image\/png;base64,/)
    expect(statuses.map((item) => item.state)).toEqual(['signed-out', 'signing-in', 'signed-in'])
    expect(signedIn).toEqual(['andrea@example.com'])
    const file = join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const disk = readFileSync(file, 'utf8')
    for (const token of [...fake.accessTokens(), ...fake.refreshTokens()]) {
      expect(disk).not.toContain(token)
      expect(JSON.stringify(statuses)).not.toContain(token)
    }
    // A foto foi pedida em 256 px, no único servidor de fotos permitido.
    expect(fake.calls.some((call) => call.host === 'lh3.googleusercontent.com')).toBe(true)
    expect(account().status().state).toBe('signed-in')
  })

  it('contrato 12 (CA2): quem entrou sem a agenda vê "Permitir acesso à agenda", que pede só o escopo que falta', async () => {
    const google = account()
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    // Sessão do contrato 11: o Google concedeu só perfil e Drive.
    fake.granted.add('openid')
    fake.granted.add('https://www.googleapis.com/auth/drive.file')
    const fetchWithout: typeof fake.fetch = async (url, init) => {
      const reply = await fake.fetch(url, init)
      if (new URL(url).pathname !== '/token' || !String(init.body).includes('authorization_code') || opened.length > 1) return reply
      const body = JSON.parse(await reply.text()) as Record<string, unknown>
      const bytes = Buffer.from(JSON.stringify({ ...body, scope: 'openid https://www.googleapis.com/auth/drive.file' }))
      return { ...reply, text: () => Promise.resolve(bytes.toString()), bytes: () => Promise.resolve(bytes) }
    }
    const old = createGoogleAccount({
      dir,
      safeStorage,
      fetch: fetchWithout,
      openExternal: async (url) => {
        opened.push(url)
        await browserGet(fake.approve(url))
      },
      photoToDataUrl: () => null,
      onStatus: (status) => statuses.push(status),
      now: () => clock,
    })
    expect((await old.signIn()).calendar).toBe(false)
    expect(old.hasCalendar()).toBe(false)
    const status = await old.grantCalendar()
    const url = new URL(opened[1] ?? '')
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar.readonly')
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(url.searchParams.get('login_hint')).toBe('andrea@example.com')
    expect(status).toMatchObject({ state: 'signed-in', calendar: true, profile: { email: 'andrea@example.com' } })
    // O token novo vale para o Drive e para a agenda (escopos somados).
    expect(fake.granted.has('https://www.googleapis.com/auth/drive.file')).toBe(true)
    expect(old.hasCalendar()).toBe(true)
  })

  it('contrato 12: "Permitir acesso à agenda" com outra conta no navegador não troca a conta; resposta sem `scope` soma o pedido', async () => {
    account().saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    const stripScope: typeof fake.fetch = async (url, init) => {
      const reply = await fake.fetch(url, init)
      if (new URL(url).pathname !== '/token' || !String(init.body).includes('authorization_code')) return reply
      const body = JSON.parse(await reply.text()) as Record<string, unknown>
      const bytes = Buffer.from(JSON.stringify({ ...body, scope: opened.length === 1 ? 'openid https://www.googleapis.com/auth/drive.file' : undefined }))
      return { ...reply, text: () => Promise.resolve(bytes.toString()), bytes: () => Promise.resolve(bytes) }
    }
    let other = false
    const make = () =>
      createGoogleAccount({
        dir,
        safeStorage,
        fetch: async (url, init) => {
          const reply = await stripScope(url, init)
          if (!other || new URL(url).pathname !== '/v1/userinfo') return reply
          const bytes = Buffer.from(JSON.stringify({ name: 'Outra Pessoa', email: 'outra@example.com' }))
          return { ...reply, text: () => Promise.resolve(bytes.toString()), bytes: () => Promise.resolve(bytes) }
        },
        openExternal: async (url) => {
          opened.push(url)
          await browserGet(fake.approve(url))
        },
        photoToDataUrl: () => null,
        onStatus: () => undefined,
        now: () => clock,
      })
    const first = make()
    expect((await first.signIn()).calendar).toBe(false)
    const disk = readFileSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE))
    other = true
    const refused = await first.grantCalendar()
    expect(refused).toMatchObject({ state: 'signed-in', error: 'other-account', calendar: false, profile: { email: 'andrea@example.com' } })
    // Os tokens novos foram descartados: a sessão no disco é a mesma.
    expect(readFileSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE)).equals(disk)).toBe(true)
    other = false
    // Mesma conta, resposta sem `scope`: os escopos da sessão somados ao pedido.
    expect(await first.grantCalendar()).toMatchObject({ state: 'signed-in', error: null, calendar: true })
  })

  it('renova sozinho 60 s antes de vencer e uma vez por vez', async () => {
    const google = account()
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    await google.signIn()
    const first = await google.accessToken()
    expect(await google.accessToken()).toBe(first)
    clock += 3599_000 - REFRESH_MARGIN_MS + 1
    const [a, b] = await Promise.all([google.accessToken(), google.accessToken()])
    expect(a).not.toBe(first)
    expect(b).toBe(a)
    expect(fake.calls.filter((call) => call.path === '/token')).toHaveLength(2)
    expect(await google.accessToken(true)).not.toBe(a)
  })

  it('`invalid_grant`: "Entre de novo", sem apagar nada local', async () => {
    const google = account()
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    await google.signIn()
    fake.refreshRevoked = true
    await expect(google.accessToken(true)).rejects.toBeInstanceOf(AccountError)
    expect(google.status()).toMatchObject({ state: 'expired', profile: { email: 'andrea@example.com' } })
    expect(google.signedIn()).toBe(false)
    expect(existsSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE))).toBe(true)
    expect(account().status().state).toBe('expired')
    await expect(google.accessToken()).rejects.toMatchObject({ code: 'session' })
  })

  it('"Sair" revoga no Google e apaga a sessão do disco', async () => {
    const google = account()
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    await google.signIn()
    const status = await google.signOut()
    expect(fake.revoked).toBe(1)
    expect(fake.refreshTokens()).toEqual([])
    expect(status).toMatchObject({ state: 'signed-out', profile: null, client: { configured: true } })
    expect(existsSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE))).toBe(false)
    expect(signedOut).toBe(1)
  })

  it('cancelar no meio: volta deslogado com `cancelled`', async () => {
    const google = account(false)
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    const pending = google.signIn()
    for (let i = 0; i < 50 && !opened.length; i++) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(google.status().state).toBe('signing-in')
    expect(google.cancelSignIn()).toBe(true)
    expect(await pending).toMatchObject({ state: 'signed-out', error: 'cancelled' })
  })

  /** O Google falso com um pedido segurado até `release()`: para "Sair" ou "Cancelar" bem no meio. */
  const holding = (path: string) => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let held = false
    let reached: () => void = () => undefined
    const arrived = new Promise<void>((resolve) => {
      reached = resolve
    })
    const fetch: typeof fake.fetch = async (url, init) => {
      if (!held && new URL(url).pathname === path && (path !== '/token' || String(init.body).includes('refresh_token'))) {
        held = true
        reached()
        await gate
      }
      return fake.fetch(url, init)
    }
    return { fetch, release: () => release(), arrived }
  }

  const accountWith = (fetch: typeof fake.fetch) =>
    createGoogleAccount({
      dir,
      safeStorage,
      fetch,
      openExternal: async (url) => {
        opened.push(url)
        await browserGet(fake.approve(url))
      },
      photoToDataUrl: () => null,
      onStatus: (status) => statuses.push(status),
      now: () => clock,
    })

  it('"Sair" durante a renovação: o resultado é descartado e google.bin não volta', async () => {
    const hold = holding('/token')
    const google = accountWith(hold.fetch)
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    await google.signIn()
    const renewing = google.accessToken(true)
    await hold.arrived
    await google.signOut()
    hold.release()
    await expect(renewing).rejects.toMatchObject({ code: 'session' })
    expect(existsSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE))).toBe(false)
    expect(google.status().state).toBe('signed-out')
  })

  it.each(['cancelar', 'sair'])('%s no último instante do login (perfil chegando) não deixa ninguém logado', async (action) => {
    const hold = holding('/v1/userinfo')
    const google = accountWith(hold.fetch)
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    const pending = google.signIn()
    await hold.arrived
    if (action === 'cancelar') google.cancelSignIn()
    else await google.signOut()
    hold.release()
    expect(await pending).toMatchObject({ state: 'signed-out', profile: null })
    expect(existsSync(join(dir, ACCOUNTS_DIR, GOOGLE_SESSION_FILE))).toBe(false)
  })
})
