import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashPassword, SCRYPT_PARAMS, verifyPassword } from '../src/main/lock/password'
import { createLockService, type LockService, type TouchIdAccess } from '../src/main/lock/service'
import { createFileLockStore, LOCK_FILE } from '../src/main/lock/store'
import { isLockedError, isValidPassword, lockWaitMs, retryLabel, type LockStatus } from '../src/shared/lock'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings-defaults'

// Parâmetros baratos nos testes do serviço; os fortes têm um teste próprio.
const FAST = { N: 2 ** 10, r: 8, p: 1, keyLength: 32 }
const PASSWORD = 'segredo-da-reuniao'

describe('senha do app (contrato 22, CA1)', () => {
  it('parâmetros fortes do scrypt (OWASP: N = 2^16, r = 8, p = 2)', () => {
    expect(SCRYPT_PARAMS.N).toBeGreaterThanOrEqual(2 ** 16)
    expect(SCRYPT_PARAMS.r).toBeGreaterThanOrEqual(8)
    expect(SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * SCRYPT_PARAMS.p).toBeGreaterThanOrEqual(2 ** 16 * 8 * 2)
  })

  it('hash com os parâmetros fortes confere a senha certa e recusa a errada', async () => {
    const record = await hashPassword(PASSWORD)
    expect(record).toMatchObject({ algorithm: 'scrypt', N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p, keyLength: 32 })
    expect(JSON.stringify(record)).not.toContain(PASSWORD)
    expect(await verifyPassword(PASSWORD, record)).toBe(true)
    expect(await verifyPassword(`${PASSWORD}x`, record)).toBe(false)
  })

  it('sal aleatório: a mesma senha gera hashes diferentes', async () => {
    const a = await hashPassword(PASSWORD, FAST)
    const b = await hashPassword(PASSWORD, FAST)
    expect(a.salt).not.toBe(b.salt)
    expect(a.hash).not.toBe(b.hash)
    expect(Buffer.from(a.salt, 'base64')).toHaveLength(16)
  })

  it('de 4 a 64 caracteres, contados como a pessoa vê', () => {
    expect(isValidPassword('abc')).toBe(false)
    expect(isValidPassword('abcd')).toBe(true)
    expect(isValidPassword('a'.repeat(64))).toBe(true)
    expect(isValidPassword('a'.repeat(65))).toBe(false)
    expect(isValidPassword('🔒🔒🔒🔒')).toBe(true)
    expect(isValidPassword(1234)).toBe(false)
  })

  it('espera crescente depois do 5º erro seguido: 30 s, 1 min, 5 min… e para na última', () => {
    expect([1, 2, 3, 4].map(lockWaitMs)).toEqual([0, 0, 0, 0])
    expect(lockWaitMs(5)).toBe(30_000)
    expect(lockWaitMs(6)).toBe(60_000)
    expect(lockWaitMs(7)).toBe(5 * 60_000)
    expect(lockWaitMs(50)).toBe(60 * 60_000)
    expect(retryLabel(30_000)).toBe('0:30')
    expect(retryLabel(299_001)).toBe('5:00')
    expect(retryLabel(3_600_000)).toBe('1:00:00')
  })

  it('reconhece a recusa do main como vem do invoke', () => {
    expect(isLockedError(new Error("Error invoking remote method 'scribe:meetings-list': Error: locked"))).toBe(true)
    expect(isLockedError(new Error('locked'))).toBe(true)
    expect(isLockedError(new Error('outro erro'))).toBe(false)
  })
})

interface Harness {
  service: LockService
  statuses: LockStatus[]
  clock: { now: number }
  touch: { available: boolean; approves: boolean; prompts: number }
  settings: AppSettings
  restart: () => LockService
}

describe('bloqueio do app (contrato 22)', () => {
  let dir: string
  let harness: Harness

  const make = (dirPath: string, settings: AppSettings, clock: { now: number }, touch: Harness['touch'], statuses: LockStatus[]): LockService => {
    const touchId: TouchIdAccess = {
      available: () => touch.available,
      prompt: () => {
        touch.prompts++
        return touch.approves ? Promise.resolve() : Promise.reject(new Error('recusado'))
      },
    }
    return createLockService({
      store: createFileLockStore({ dir: dirPath }),
      settings: { get: () => Promise.resolve(settings) },
      touchId,
      onStatus: (status) => statuses.push(status),
      now: () => clock.now,
      scrypt: FAST,
    })
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'lock-test-'))
    const settings = { ...DEFAULT_SETTINGS }
    const clock = { now: 1_700_000_000_000 }
    const touch = { available: false, approves: true, prompts: 0 }
    const statuses: LockStatus[] = []
    const service = make(dir, settings, clock, touch, statuses)
    harness = { service, statuses, clock, touch, settings, restart: () => make(dir, settings, clock, touch, statuses) }
    await service.init()
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const file = (): Record<string, unknown> => JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as Record<string, unknown>

  it('sem senha e sem Touch ID não bloqueia (o botão fica desabilitado)', async () => {
    const status = await harness.service.lock('button')
    expect(status).toMatchObject({ locked: false, hasPassword: false, canLock: false })
    expect(harness.service.isLocked()).toBe(false)
  })

  it('criar a senha grava só o hash em lock.json com permissão 0600', async () => {
    const created = await harness.service.setPassword({ current: null, next: PASSWORD })
    expect(created.result).toBe('ok')
    expect(created.status).toMatchObject({ hasPassword: true, canLock: true })
    const raw = readFileSync(join(dir, LOCK_FILE), 'utf8')
    expect(raw).not.toContain(PASSWORD)
    expect(file()['password']).toMatchObject({ algorithm: 'scrypt' })
    expect(statSync(join(dir, LOCK_FILE)).mode & 0o777).toBe(0o600)
    // Nenhum estado avisado carrega a senha nem o hash.
    expect(JSON.stringify(harness.statuses)).not.toContain(PASSWORD)
    expect(JSON.stringify(harness.statuses)).not.toContain((file()['password'] as { hash: string }).hash)
  })

  it('senha fora de 4 a 64 caracteres é recusada', async () => {
    expect((await harness.service.setPassword({ current: null, next: 'abc' })).result).toBe('invalid')
    expect((await harness.service.setPassword({ current: null, next: 'a'.repeat(65) })).result).toBe('invalid')
    expect((await harness.service.setPassword({ current: null, next: 42 })).result).toBe('invalid')
    expect((await harness.service.status()).hasPassword).toBe(false)
  })

  it('trocar e remover a senha pedem a atual', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    expect((await harness.service.setPassword({ current: 'errada', next: 'nova-senha' })).result).toBe('wrong')
    expect((await harness.service.setPassword({ current: null, next: 'nova-senha' })).result).toBe('wrong')
    expect((await harness.service.setPassword({ current: PASSWORD, next: 'nova-senha' })).result).toBe('ok')
    expect((await harness.service.removePassword({ current: PASSWORD })).result).toBe('wrong')
    expect((await harness.service.removePassword({ current: 'nova-senha' })).result).toBe('ok')
    expect((await harness.service.status()).hasPassword).toBe(false)
    expect((await harness.service.removePassword({ current: 'nova-senha' })).result).toBe('unavailable')
  })

  it('bloquear, errar e desbloquear com a senha certa', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    const locked = await harness.service.lock('button')
    expect(locked.locked).toBe(true)
    expect(harness.service.isLocked()).toBe(true)
    expect(file()['locked']).toBe(true)
    // Bloqueado, a senha não muda por aqui.
    expect((await harness.service.setPassword({ current: PASSWORD, next: 'outra-senha' })).result).toBe('unavailable')
    expect((await harness.service.unlock('errada')).result).toBe('wrong')
    expect((await harness.service.unlock(undefined)).result).toBe('wrong')
    const ok = await harness.service.unlock(PASSWORD)
    expect(ok.result).toBe('ok')
    expect(ok.status.locked).toBe(false)
    expect(file()).toMatchObject({ locked: false, failures: 0, retryAt: null })
  })

  it('5 erros seguidos abrem a espera de 30 s, que reiniciar o app não zera; depois 1 min', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    await harness.service.lock('shortcut')
    for (let i = 0; i < 4; i++) expect((await harness.service.unlock(`errada-${i}`)).status.retryInMs).toBe(0)
    const fifth = await harness.service.unlock('errada-5')
    expect(fifth.result).toBe('wrong')
    expect(fifth.status.retryInMs).toBe(30_000)
    // Na espera, nem a senha certa entra (e não conta erro).
    expect((await harness.service.unlock(PASSWORD)).result).toBe('wait')

    const reopened = harness.restart()
    const status = await reopened.init()
    expect(status).toMatchObject({ locked: true, retryInMs: 30_000 })
    expect((await reopened.unlock(PASSWORD)).result).toBe('wait')

    harness.clock.now += 30_000
    const sixth = await reopened.unlock('errada-6')
    expect(sixth.status.retryInMs).toBe(60_000)
    harness.clock.now += 60_000
    expect((await reopened.unlock(PASSWORD)).result).toBe('ok')
    expect(file()).toMatchObject({ failures: 0, retryAt: null })
  })

  it('fechado bloqueado abre bloqueado; "Pedir senha ao abrir" também (CA6)', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    await harness.service.lock('button')
    expect((await harness.restart().init()).locked).toBe(true)

    await harness.service.unlock(PASSWORD)
    // O serviço reaberto releu o arquivo: desbloqueado e sem a opção, abre livre.
    expect((await harness.restart().init()).locked).toBe(false)
    harness.settings.lockOnLaunch = true
    expect((await harness.restart().init()).locked).toBe(true)
  })

  it('lock.json apagado com o app fechado remove a senha e abre livre (CA5)', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    await harness.service.lock('button')
    rmSync(join(dir, LOCK_FILE))
    expect(await harness.restart().init()).toMatchObject({ locked: false, hasPassword: false })
  })

  it('lock.json inválido vale como sem senha', async () => {
    writeFileSync(join(dir, LOCK_FILE), '{ quebrado')
    expect(await harness.restart().init()).toMatchObject({ locked: false, hasPassword: false })
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ version: 1, password: { algorithm: 'md5', hash: 'x' }, failures: 2, retryAt: null, locked: true }))
    expect(await harness.restart().init()).toMatchObject({ locked: false, hasPassword: false })
  })

  it('Touch ID é só atalho da senha: sem senha não liga nem bloqueia (migração do Touch ID sozinho)', async () => {
    harness.settings.lockUseTouchId = true
    harness.touch.available = true
    expect(await harness.service.status()).toMatchObject({ touchIdAvailable: true, touchIdEnabled: false, canLock: false })
    expect((await harness.service.lock('button')).locked).toBe(false)
    // Fechado bloqueado com Touch ID ligado e sem senha (versão anterior): abre livre até criar a senha.
    writeFileSync(join(dir, LOCK_FILE), JSON.stringify({ version: 1, password: null, failures: 0, retryAt: null, locked: true }))
    expect(await harness.restart().init()).toMatchObject({ locked: false, canLock: false, touchIdEnabled: false })
  })

  it('Touch ID com senha: aprovado desbloqueia, recusado ou indisponível não', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    harness.settings.lockUseTouchId = true
    // O botão aparece com o interruptor ligado, mesmo que o Mac não ofereça o Touch ID agora.
    expect(await harness.service.status()).toMatchObject({ touchIdAvailable: false, touchIdEnabled: true, canLock: true })
    await harness.service.lock('menu')
    harness.touch.approves = false
    expect((await harness.service.unlockWithTouchId()).result).toBe('touch-id-failed')
    expect(harness.service.isLocked()).toBe(true)
    harness.touch.approves = true
    expect((await harness.service.unlockWithTouchId()).result).toBe('ok')
    expect(harness.touch.prompts).toBe(2)
    harness.settings.lockUseTouchId = false
    await harness.service.lock('button')
    expect((await harness.service.unlockWithTouchId()).result).toBe('unavailable')
  })

  it('falha ao gravar lock.json: bloquear vale e avisa; o erro de senha conta; senha nova não fica pela metade', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    const failing = createLockService({
      store: { read: () => Promise.resolve(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as never), write: () => Promise.reject(new Error('disco cheio')) },
      settings: { get: () => Promise.resolve(harness.settings) },
      touchId: { available: () => false, prompt: () => Promise.reject(new Error('x')) },
      onStatus: () => undefined,
      now: () => harness.clock.now,
      scrypt: FAST,
    })
    await failing.init()
    const locked = await failing.lock('button')
    expect(locked).toMatchObject({ locked: true, storageError: true })
    expect(failing.isLocked()).toBe(true)
    for (let i = 0; i < 5; i++) await failing.unlock(`errada-${i}`)
    expect((await failing.status()).retryInMs).toBe(30_000)
    harness.clock.now += 30_000
    expect((await failing.unlock(PASSWORD)).result).toBe('ok')
    expect((await failing.setPassword({ current: PASSWORD, next: 'outra-senha' })).result).toBe('unavailable')
    expect((await failing.unlock(PASSWORD)).result).toBe('ok')
    await failing.lock('button')
    expect((await failing.unlock(PASSWORD)).result).toBe('ok')
  })

  it('init nunca derruba a abertura: com senha e configurações ilegíveis, abre bloqueado', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    let reads = 0
    const broken = createLockService({
      store: {
        read: async () => {
          reads++
          return JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')) as never
        },
        write: () => Promise.reject(new Error('somente leitura')),
      },
      settings: { get: () => Promise.reject(new Error('settings.json ilegível')) },
      touchId: { available: () => false, prompt: () => Promise.reject(new Error('x')) },
      onStatus: () => undefined,
      scrypt: FAST,
    })
    harness.settings.lockOnLaunch = true
    const status = await broken.init()
    expect(reads).toBe(1)
    expect(status).toMatchObject({ hasPassword: true })
    // Com as configurações ilegíveis valem os padrões ("Pedir senha ao abrir" desligado): não bloqueia à toa.
    expect(status.locked).toBe(false)
    const store = { read: () => Promise.reject(new Error('EIO')), write: () => Promise.resolve() }
    const crashing = createLockService({ store, settings: { get: () => Promise.resolve(harness.settings) }, touchId: { available: () => false, prompt: () => Promise.reject(new Error('x')) }, onStatus: () => undefined })
    await expect(crashing.init()).resolves.toMatchObject({ locked: false, storageError: true })
  })

  it('bloqueia sozinho depois dos minutos sem uso; uso adia', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    harness.settings.lockAfterMinutes = 5
    harness.clock.now += 4 * 60_000
    await harness.service.tick()
    expect(harness.service.isLocked()).toBe(false)
    harness.service.activity()
    harness.clock.now += 4 * 60_000
    await harness.service.tick()
    expect(harness.service.isLocked()).toBe(false)
    harness.clock.now += 60_000
    await harness.service.tick()
    expect(harness.service.isLocked()).toBe(true)
  })

  it('"nunca" não bloqueia sozinho', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    harness.clock.now += 24 * 60 * 60_000
    await harness.service.tick()
    expect(harness.service.isLocked()).toBe(false)
  })

  it('cada mudança é avisada (título, menu e janelas)', async () => {
    await harness.service.setPassword({ current: null, next: PASSWORD })
    await harness.service.lock('button')
    await harness.service.unlock(PASSWORD)
    expect(harness.statuses.map((status) => status.locked)).toEqual([false, true, false])
  })
})
