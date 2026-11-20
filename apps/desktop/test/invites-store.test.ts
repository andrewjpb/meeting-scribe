// Contrato 62 (convites-agenda, CA21): o registro do app, `userData/email/invites.json`. Permissões, fila, leitura
// leniente, chaves, `removeUid`, `forgetAccount`, o teto e o log sem dado de evento.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createInviteStore, emptyRecord, INVITES_MAX, type InviteEventRef, type InviteKey, type InviteRecord } from '../src/main/invites/store'

const ACCOUNT = '0b6f2c1e-3a4d-4c5b-8e9f-0a1b2c3d4e5f'
const OTHER = '1c7a3d2f-4b5e-4d6c-9f0a-1b2c3d4e5f60'
const NOW = Date.parse('2026-11-19T18:30:00.000Z')
const UID = 'reuniao-secreta-0001@example.com'
const TITLE = 'Reunião confidencial do conselho'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(now = () => NOW) {
  const root = mkdtempSync(join(tmpdir(), 'convites-registro-'))
  dirs.push(root)
  const logs: string[] = []
  const store = createInviteStore(root, now, (message) => void logs.push(message))
  return { root, file: join(root, 'email', 'invites.json'), store, logs }
}

const key = (uid: string, recurrenceId: string | null = null, accountId = ACCOUNT): InviteKey => ({ accountId, uid, recurrenceId })
const row = (k: InviteKey, patch: Partial<InviteRecord> = {}): InviteRecord => ({ ...emptyRecord(k, { sequence: 1, dtstamp: '2026-11-19T10:00:00.000Z' }, NOW), ...patch })
const ref = (start: string): InviteEventRef => ({
  eventIdentifier: 'ev-1',
  calendarItemIdentifier: 'item-1',
  externalIdentifier: 'ext-1',
  calendarId: 'cal-trabalho',
  title: TITLE,
  start,
  end: start,
  allDay: false,
  timeZone: 'America/New_York',
  location: 'Sala secreta',
  url: 'https://meet.google.com/fic-tici-aaa',
  availability: 'busy',
  occurrence: null,
  sequence: 1,
  dtstamp: null,
})

describe('registro de convites', () => {
  it('CA2: arquivo e temporário 0600, pasta email/, formato com version 1', async () => {
    const { file, store, root } = setup()
    await store.update(key(UID), () => row(key(UID)))
    expect(statSync(file).mode & 0o777).toBe(0o600)
    const disk = JSON.parse(readFileSync(file, 'utf8')) as { version: number; invites: InviteRecord[] }
    expect(disk.version).toBe(1)
    expect(disk.invites).toHaveLength(1)
    // O temporário nasce 0600: um `update` preso no meio deixa ver o arquivo antes do `rename`.
    const seen: number[] = []
    const dir = join(root, 'email')
    const watcher = setInterval(() => {
      for (const name of readdirSync(dir)) {
        if (!name.startsWith('invites.json.tmp-')) continue
        try {
          seen.push(statSync(join(dir, name)).mode & 0o777)
        } catch {
          // já foi renomeado
        }
      }
    }, 0)
    for (let index = 0; index < 30; index++) await store.update(key(`${UID}-${index}`), () => row(key(`${UID}-${index}`)))
    clearInterval(watcher)
    expect(seen.every((mode) => mode === 0o600)).toBe(true)
    // O intervalo pode não pegar o temporário vivo: o código o cria 0600 (e o `chmod` confirma) antes do `rename`.
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'main', 'invites', 'store.ts'), 'utf8')
    expect(source).toMatch(/writeFile\(temp, [^\n]*\{ mode: 0o600 \}\)/)
    expect(source).toContain('await chmod(temp, 0o600)')
    expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  it('CA3: 50 update ao mesmo tempo em chaves diferentes ficam todos; update lê o que o anterior gravou', async () => {
    const { file, store } = setup()
    await Promise.all(Array.from({ length: 50 }, (_, index) => store.update(key(`uid-${index}`), () => row(key(`uid-${index}`)))))
    expect((JSON.parse(readFileSync(file, 'utf8')) as { invites: unknown[] }).invites).toHaveLength(50)
    await Promise.all(Array.from({ length: 10 }, () => store.update(key('contador'), (current) => row(key('contador'), { sequence: (current?.sequence ?? 0) + 1 }))))
    expect((await store.get(key('contador')))?.sequence).toBe(10)
    expect(await store.update(key('nada'), () => null)).toBeNull()
    await store.update(key('contador'), () => null)
    expect(await store.get(key('contador'))).toBeNull()
  })

  it('CA2: linha fora do esquema sai sozinha; JSON quebrado vira invites.json.invalid e vale vazio', async () => {
    const { root, file, store } = setup()
    mkdirSync(join(root, 'email'), { recursive: true })
    const good = row(key('boa'))
    writeFileSync(file, JSON.stringify({ version: 1, invites: [good, { ...row(key('extra')), extra: true }, { ...row(key('sem-uid')), uid: '' }] }))
    expect((await store.list()).map((item) => item.uid)).toEqual(['boa'])
    writeFileSync(file, '{ quebrado')
    expect(await store.list()).toEqual([])
    expect(existsSync(`${file}.invalid`)).toBe(true)
    expect(statSync(`${file}.invalid`).mode & 0o777).toBe(0o600)
    expect(existsSync(file)).toBe(false)
    writeFileSync(file, JSON.stringify({ version: 2, invites: [good] }))
    expect(await store.list()).toEqual([])
    expect(readFileSync(`${file}.invalid`, 'utf8')).toContain('"version":2')
  })

  it('CA2: recurrenceId null e preenchido são chaves diferentes; removeUid tira série e ocorrências', async () => {
    const { store } = setup()
    await store.update(key(UID), () => row(key(UID)))
    await store.update(key(UID, '2026-12-17T13:00:00Z'), () => row(key(UID, '2026-12-17T13:00:00Z')))
    await store.update(key('outro'), () => row(key('outro')))
    expect(await store.list(ACCOUNT)).toHaveLength(3)
    expect((await store.get(key(UID)))?.recurrenceId).toBeNull()
    expect((await store.get(key(UID, '2026-12-17T13:00:00Z')))?.recurrenceId).toBe('2026-12-17T13:00:00Z')
    expect(await store.removeUid(ACCOUNT, UID)).toBe(2)
    expect((await store.list()).map((item) => item.uid)).toEqual(['outro'])
  })

  it('CA3: forgetAccount tira só a conta pedida', async () => {
    const { store } = setup()
    await store.update(key(UID), () => row(key(UID)))
    await store.update(key(UID, null, OTHER), () => row(key(UID, null, OTHER)))
    await store.forgetAccount(ACCOUNT)
    expect((await store.list()).map((item) => item.accountId)).toEqual([OTHER])
  })

  it('CA3: o teto tira a linha sem evento vista há mais tempo e nunca a de evento futuro', async () => {
    const { root, file, store, logs } = setup()
    mkdirSync(join(root, 'email'), { recursive: true })
    const rows: InviteRecord[] = Array.from({ length: INVITES_MAX }, (_, index) => row(key(`uid-${index}`), { seenAt: NOW - 1000 + index }))
    rows[0] = row(key('futuro'), { seenAt: 0, event: ref('2027-01-10T18:00:00Z') })
    writeFileSync(file, JSON.stringify({ version: 1, invites: rows }))
    await store.update(key('nova'), () => row(key('nova')))
    const after = await store.list()
    expect(after).toHaveLength(INVITES_MAX)
    expect(after.some((item) => item.uid === 'futuro')).toBe(true)
    expect(after.some((item) => item.uid === 'uid-1')).toBe(false)
    expect(after.some((item) => item.uid === 'nova')).toBe(true)
    // Só com eventos futuros, o arquivo passa do teto.
    writeFileSync(file, JSON.stringify({ version: 1, invites: Array.from({ length: INVITES_MAX }, (_, index) => row(key(`ev-${index}`), { event: ref('2027-01-10T18:00:00Z') })) }))
    await store.update(key('mais-uma'), () => row(key('mais-uma'), { event: ref('2027-01-11T18:00:00Z') }))
    expect(await store.list()).toHaveLength(INVITES_MAX + 1)
    // Com evento passado há mais de 30 dias, ele sai antes.
    writeFileSync(file, JSON.stringify({ version: 1, invites: [row(key('passado'), { event: ref('2026-09-01T18:00:00Z') }), ...Array.from({ length: INVITES_MAX - 1 }, (_, index) => row(key(`ev-${index}`), { event: ref('2027-01-10T18:00:00Z') }))] }))
    await store.update(key('mais-uma'), () => row(key('mais-uma'), { event: ref('2027-01-11T18:00:00Z') }))
    const pruned = await store.list()
    expect(pruned).toHaveLength(INVITES_MAX)
    expect(pruned.some((item) => item.uid === 'passado')).toBe(false)
    expect(logs.some((line) => line.includes('teto'))).toBe(true)
  })

  it('CA3: nenhum título, UID ou endereço nos logs', async () => {
    const { root, file, store, logs } = setup()
    mkdirSync(join(root, 'email'), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 1, invites: [row(key(UID), { event: ref('2027-01-10T18:00:00Z') }), { ...row(key('x')), extra: TITLE }] }))
    await store.list()
    await store.update(key(UID), (current) => current)
    await store.removeUid(ACCOUNT, UID)
    await store.forgetAccount(ACCOUNT)
    writeFileSync(file, 'quebrado')
    await store.list()
    expect(logs.length).toBeGreaterThan(0)
    for (const line of logs) {
      expect(line).not.toContain(UID)
      expect(line).not.toContain(TITLE)
      expect(line).not.toContain('Sala secreta')
      expect(line).not.toContain(ACCOUNT)
      expect(line).not.toContain('@')
    }
  })
})
