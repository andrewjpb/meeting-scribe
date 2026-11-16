import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DRIVE_ROOT_FOLDER_NAME, type DriveMeetingStatus } from '../src/shared/accounts'
import type { Meeting } from '../src/shared/meetings'
import { summaryMarkdown, type MeetingSummary } from '../src/shared/meeting-summary'
import { transcriptMarkdown } from '../src/shared/transcript-markdown'
import type { TranscriptDocument } from '../src/shared/transcription'
import { createGoogleAccount, type GoogleAccountService } from '../src/main/google/account'
import { CHUNK_BYTES, FOLDER_MIME } from '../src/main/google/drive'
import { createDriveSync, createEndOfRecordingHooks, DRIVE_QUEUE_FILE, RETRY_DELAYS_MS, type DriveSyncService } from '../src/main/google/drive-sync'
import { createFakeGoogle, type FakeDriveFile, type FakeGoogle } from '../src/main/google/fake-google'
import type { SafeStorageLike } from '../src/main/secrets'

const CLIENT_ID = '123456789012-abcdefghij.apps.googleusercontent.com'
const CLIENT_SECRET = 'GOCSPX-segredo-de-teste'
const BASE = '2026-11-16 10h00 - Planejamento'

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

const DOCUMENT: TranscriptDocument = {
  version: 1,
  meetingId: 'm1',
  sourceLanguage: 'pt',
  targetLanguage: null,
  translationModel: null,
  segments: [{ id: 's1', source: 'mic', speaker: null, startMs: 0, endMs: 1000, text: 'Vamos migrar o banco na sexta.', translation: null, translationModel: null }],
}

const summaryWith = (overview: string): MeetingSummary => ({ version: 1, meetingId: 'm1', createdAt: '2026-11-16T13:30:00.000Z', model: 'claude-cli:haiku', overview, decisions: [], tasks: [] })

describe('envio ao Google Drive (CA4, CA5)', () => {
  let dir: string
  let folder: string
  let fake: FakeGoogle
  let clock: number
  let google: GoogleAccountService
  let meetings: Map<string, Meeting>
  let summaries: Map<string, MeetingSummary>
  let enabled: boolean
  let events: { meetingId: string; status: DriveMeetingStatus }[]
  let services: DriveSyncService[]

  const makeSync = (): DriveSyncService => {
    const sync = createDriveSync({
      dir,
      account: google,
      enabled: () => Promise.resolve(enabled),
      files: {
        meetings: { get: (id) => Promise.resolve(meetings.get(id) ?? null) },
        transcripts: { get: (id) => Promise.resolve(id === 'm1' || id === 'm2' ? { ...DOCUMENT, meetingId: id } : null) },
        summaries: { get: (id) => Promise.resolve(summaries.get(id) ?? null) },
      },
      fetch: fake.fetch,
      onStatus: (meetingId, status) => events.push({ meetingId, status }),
      now: () => clock,
      // A fila não dispara sozinha no teste: `flush` roda o que estiver vencido.
      timers: { setTimeout: () => 0, clearTimeout: () => undefined },
      enqueueDelayMs: 0,
    })
    services.push(sync)
    return sync
  }

  const root = (): FakeDriveFile | undefined => [...fake.files.values()].find((file) => file.name === DRIVE_ROOT_FOLDER_NAME && !file.trashed)
  const meetingFolder = (): FakeDriveFile | undefined => {
    const parent = root()
    return parent ? fake.childrenOf(parent.id).find((file) => file.mimeType === FOLDER_MIME && !file.trashed) : undefined
  }
  const filesIn = (parent: FakeDriveFile | undefined): FakeDriveFile[] => (parent ? fake.childrenOf(parent.id).filter((file) => !file.trashed) : [])

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'drive-'))
    folder = join(dir, 'pasta')
    mkdirSync(folder)
    fake = createFakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    clock = Date.now()
    enabled = true
    events = []
    services = []
    writeFileSync(join(folder, `${BASE}.m4a`), Buffer.alloc(300_000, 7))
    writeFileSync(join(folder, `${BASE}.md`), '# Planejamento\n\ntranscrição da pasta\n')
    writeFileSync(join(folder, `${BASE} - resumo.md`), '# Planejamento\n\nresumo da pasta\n')
    meetings = new Map([
      ['m1', { id: 'm1', title: 'Planejamento', startedAt: '2026-11-16T13:00:00.000Z', durationMs: 60_000, sources: { mic: true, system: true }, audioPath: join(folder, `${BASE}.m4a`), transcriptPath: join(folder, `${BASE}.md`) }],
    ])
    summaries = new Map([['m1', summaryWith('Resumo.')]])
    google = createGoogleAccount({
      dir,
      safeStorage,
      fetch: fake.fetch,
      openExternal: async (url) => browserGet(fake.approve(url)),
      photoToDataUrl: () => null,
      onStatus: () => undefined,
      now: () => clock,
    })
    google.saveClient({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET })
    await google.signIn()
  })
  afterEach(() => {
    for (const sync of services) sync.dispose()
    rmSync(dir, { recursive: true, force: true })
  })

  it('cria "LAP Reuniões", a subpasta com o nome base e envia os três arquivos da pasta', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['audio', 'transcript'])
    await sync.enqueue('m1', ['summary'])
    expect(sync.status('m1')).toEqual({ state: 'uploading', percent: 0 })
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    expect(sync.inDrive('m1')).toBe(true)
    expect(root()?.parents).toEqual(['root'])
    expect(meetingFolder()?.name).toBe(BASE)
    const files = filesIn(meetingFolder())
    expect(files.map((file) => file.name).sort()).toEqual([`${BASE} - resumo.md`, `${BASE}.m4a`, `${BASE}.md`])
    expect(files.find((file) => file.name.endsWith('.m4a'))?.content.equals(readFileSync(join(folder, `${BASE}.m4a`)))).toBe(true)
    expect(files.find((file) => file.name.endsWith('.m4a'))?.mimeType).toBe('audio/mp4')
    expect(files.find((file) => file.name === `${BASE}.md`)?.content.toString()).toBe('# Planejamento\n\ntranscrição da pasta\n')
    expect(files.find((file) => file.name.endsWith('resumo.md'))?.content.toString()).toBe('# Planejamento\n\nresumo da pasta\n')
    expect(sync.folderUrl('m1')).toBe(`https://drive.google.com/drive/folders/${meetingFolder()?.id}`)
    // Um envio só (as duas entradas se juntaram) e o andamento chegou à tela.
    expect(fake.calls.filter((call) => call.method === 'POST' && call.path === '/upload/drive/v3/files')).toHaveLength(3)
    expect(events.some((event) => event.status.state === 'uploading')).toBe(true)
    expect(events.at(-1)).toEqual({ meetingId: 'm1', status: { state: 'done' } })
    // Nenhum token no arquivo da fila.
    const queue = readFileSync(join(dir, DRIVE_QUEUE_FILE), 'utf8')
    for (const token of [...fake.accessTokens(), ...fake.refreshTokens()]) expect(queue).not.toContain(token)
    expect(queue).not.toContain('upload_id')
  })

  it('o resumo gerado de novo substitui o arquivo no Drive (mesmo id)', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['audio', 'transcript', 'summary'])
    await sync.flush()
    const before = filesIn(meetingFolder()).find((file) => file.name.endsWith('resumo.md'))
    writeFileSync(join(folder, `${BASE} - resumo.md`), '# Planejamento\n\nresumo novo\n')
    await sync.enqueue('m1', ['summary'])
    await sync.flush()
    const after = filesIn(meetingFolder()).filter((file) => file.name.endsWith('resumo.md'))
    expect(after).toHaveLength(1)
    expect(after[0]?.id).toBe(before?.id)
    expect(after[0]?.uploads).toBe(2)
    expect(after[0]?.content.toString()).toBe('# Planejamento\n\nresumo novo\n')
    expect(fake.calls.filter((call) => call.method === 'PATCH')).toHaveLength(1)
  })

  it('queda no meio do envio em partes: espera 30 s e retoma de onde parou', async () => {
    const sync = makeSync()
    fake.dropNextChunk = true
    await sync.enqueue('m1', ['audio'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'offline' })
    const saved = JSON.parse(readFileSync(join(dir, DRIVE_QUEUE_FILE), 'utf8')) as { queue: { nextAt: number; attempts: number }[] }
    expect(saved.queue[0]).toMatchObject({ attempts: 1, nextAt: clock + RETRY_DELAYS_MS[0] })
    // Antes da hora, nada.
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'offline' })
    clock += RETRY_DELAYS_MS[0]
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    const audio = filesIn(meetingFolder()).find((file) => file.name.endsWith('.m4a'))
    expect(audio?.content.equals(readFileSync(join(folder, `${BASE}.m4a`)))).toBe(true)
    // A mesma sessão de upload: perguntou onde parou e não abriu outra.
    expect(fake.calls.filter((call) => call.method === 'POST' && call.path === '/upload/drive/v3/files')).toHaveLength(1)
  })

  it('espera crescente: 30 s, 2 min, 10 min, 30 min, depois de hora em hora; 503 mostra o erro', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['transcript'])
    const waits: number[] = []
    for (let attempt = 0; attempt < 6; attempt++) {
      fake.unavailable = 1
      const start = clock
      await sync.flush()
      const saved = JSON.parse(readFileSync(join(dir, DRIVE_QUEUE_FILE), 'utf8')) as { queue: { nextAt: number }[] }
      waits.push((saved.queue[0]?.nextAt ?? 0) - start)
      clock = saved.queue[0]?.nextAt ?? clock
    }
    expect(waits).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000, 3_600_000])
    expect(sync.status('m1')).toEqual({ state: 'error', reason: 'server' })
    // "Tentar de novo": agora.
    expect(sync.retry('m1')).toEqual({ state: 'uploading', percent: 0 })
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
  })

  it('401: renova o token uma vez e segue', async () => {
    const sync = makeSync()
    fake.unauthorized = 1
    await sync.enqueue('m1', ['transcript'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    expect(fake.calls.filter((call) => call.path === '/token')).toHaveLength(2)
  })

  it('pasta apagada no Drive: recria a pasta e manda de novo', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['audio', 'transcript', 'summary'])
    await sync.flush()
    const first = meetingFolder()
    fake.trash(first?.id ?? '')
    await sync.enqueue('m1', ['summary'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    const second = meetingFolder()
    expect(second?.id).not.toBe(first?.id)
    expect(filesIn(second).map((file) => file.name)).toEqual([`${BASE} - resumo.md`])
    // "LAP Reuniões" apagada inteira: cria de novo.
    fake.trash(root()?.id ?? '')
    await sync.enqueue('m1', ['transcript'])
    await sync.flush()
    expect(root()).toBeDefined()
    expect(filesIn(meetingFolder()).map((file) => file.name)).toEqual([`${BASE}.md`])
  })

  it('a fila continua depois de reabrir o app', async () => {
    const first = makeSync()
    fake.offline = 1
    await first.enqueue('m1', ['audio', 'transcript', 'summary'])
    await first.flush()
    expect(first.status('m1')).toEqual({ state: 'offline' })
    first.dispose()
    const reopened = makeSync()
    expect(reopened.status('m1')).toEqual({ state: 'offline' })
    clock += RETRY_DELAYS_MS[0]
    reopened.start()
    await reopened.flush()
    expect(reopened.status('m1')).toEqual({ state: 'done' })
    expect(filesIn(meetingFolder())).toHaveLength(3)
  })

  it('sem arquivos na pasta: manda a transcrição e o resumo montados na hora', async () => {
    meetings.set('m2', { id: 'm2', title: 'Sem pasta', startedAt: '2026-11-16T15:30:00.000Z', durationMs: 1000, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null })
    summaries.set('m2', summaryWith('Resumo gerado.'))
    const sync = makeSync()
    await sync.enqueue('m2', ['audio', 'transcript', 'summary'])
    await sync.flush()
    const meeting = meetings.get('m2') as Meeting
    const files = filesIn(meetingFolder())
    const base = meetingFolder()?.name ?? ''
    expect(base).toMatch(/^2026-11-16 \d{2}h30 - Sem pasta$/)
    expect(files.map((file) => file.name).sort()).toEqual([`${base} - resumo.md`, `${base}.md`])
    expect(files.find((file) => file.name === `${base}.md`)?.content.toString()).toBe(transcriptMarkdown(meeting, { ...DOCUMENT, meetingId: 'm2' }))
    expect(files.find((file) => file.name.endsWith('resumo.md'))?.content.toString()).toBe(summaryMarkdown(meeting, summaryWith('Resumo gerado.')))
  })

  it('áudio que sumiu da pasta: "arquivo não encontrado", sem tentar sozinho', async () => {
    rmSync(join(folder, `${BASE}.m4a`))
    const sync = makeSync()
    await sync.enqueue('m1', ['audio'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'error', reason: 'missing' })
    clock += 10 * 60 * 60_000
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'error', reason: 'missing' })
  })

  it('reunião excluída no app sai da fila e nada é apagado no Drive', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['transcript'])
    await sync.flush()
    meetings.delete('m1')
    await sync.enqueue('m1', ['summary'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'hidden' })
    expect(filesIn(meetingFolder())).toHaveLength(1)
    expect(fake.calls.some((call) => call.method === 'DELETE')).toBe(false)
  })

  it('arquivo maior que 8 MB vai em pedaços de 8 MB', async () => {
    writeFileSync(join(folder, `${BASE}.m4a`), Buffer.alloc(CHUNK_BYTES + 1000, 3))
    const sync = makeSync()
    await sync.enqueue('m1', ['audio'])
    await sync.flush()
    expect(filesIn(meetingFolder())[0]?.content.byteLength).toBe(CHUNK_BYTES + 1000)
    expect(fake.calls.filter((call) => call.method === 'PUT')).toHaveLength(2)
    expect(events.some((event) => event.status.state === 'uploading' && event.status.percent > 0 && event.status.percent < 100)).toBe(true)
  })

  it('sem login ou com o interruptor desligado: nenhum pedido ao Google', async () => {
    await google.signOut()
    const calls = fake.calls.length
    const sync = makeSync()
    await sync.enqueue('m1', ['audio', 'transcript', 'summary'])
    sync.start()
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'hidden' })
    expect(fake.calls.length).toBe(calls)
    expect(existsSync(join(dir, DRIVE_QUEUE_FILE))).toBe(false)
  })

  it('interruptor desligado esvazia a fila; sessão expirada espera o próximo login', async () => {
    const sync = makeSync()
    enabled = false
    await sync.enqueue('m1', ['transcript'])
    expect(sync.status('m1')).toEqual({ state: 'hidden' })
    enabled = true
    fake.refreshRevoked = true
    await google.accessToken(true).catch(() => undefined)
    await sync.enqueue('m1', ['transcript'])
    expect(sync.status('m1')).toEqual({ state: 'error', reason: 'session' })
    fake.refreshRevoked = false
    await google.signIn()
    sync.signedIn(google.email() ?? '')
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    await sync.enqueue('m1', ['summary'])
    sync.clear()
    expect(sync.status('m1')).toEqual({ state: 'done' })
  })

  it('sem acesso à subpasta guardada (403): cria outra e manda de novo', async () => {
    const sync = makeSync()
    await sync.enqueue('m1', ['transcript'])
    await sync.flush()
    const first = meetingFolder()
    fake.forbidden.add(first?.id ?? '')
    await sync.enqueue('m1', ['summary'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    const folders = fake.childrenOf(root()?.id ?? '').filter((file) => file.mimeType === FOLDER_MIME && !fake.forbidden.has(file.id))
    expect(folders).toHaveLength(1)
    expect(folders[0]?.id).not.toBe(first?.id)
    expect(filesIn(folders[0]).map((file) => file.name)).toEqual([`${BASE} - resumo.md`])
    expect(sync.folderUrl('m1')).toBe(`https://drive.google.com/drive/folders/${folders[0]?.id}`)
  })

  it('outra conta: o que estava no Drive da anterior volta para a fila e vai para esta', async () => {
    const sync = makeSync()
    sync.signedIn('andrea@example.com')
    await sync.enqueue('m1', ['audio', 'transcript', 'summary'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    const uploads = fake.calls.filter((call) => call.method === 'PUT').length
    sync.signedIn('outra.pessoa@example.com')
    expect(sync.status('m1')).toEqual({ state: 'uploading', percent: 0 })
    expect(sync.inDrive('m1')).toBe(false)
    expect(sync.folderUrl('m1')).toBeNull()
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'done' })
    expect(fake.calls.filter((call) => call.method === 'PUT').length).toBe(uploads + 3)
  })

  it('401 mesmo depois de renovar: a conta passa a "Entre de novo", como a reunião', async () => {
    const sync = makeSync()
    fake.unauthorized = 2
    await sync.enqueue('m1', ['transcript'])
    await sync.flush()
    expect(sync.status('m1')).toEqual({ state: 'error', reason: 'session' })
    expect(google.status().state).toBe('expired')
  })
})

describe('entrada na fila ao encerrar (CA5)', () => {
  const setup = (pending: boolean) => {
    const calls: { meetingId: string; kinds: readonly string[] }[] = []
    const timers: (() => void)[] = []
    const hooks = createEndOfRecordingHooks({
      enqueue: (meetingId, kinds) => {
        calls.push({ meetingId, kinds })
        return Promise.resolve()
      },
      filesPending: () => pending,
      timers: { setTimeout: (callback) => timers.push(callback), clearTimeout: () => timers.splice(0) },
    })
    return { calls, timers, hooks }
  }

  it('com pasta: espera o audio-finish, mesmo atrasado, e entra uma vez só', () => {
    const { calls, timers, hooks } = setup(true)
    hooks.transcriptSaved('m1')
    expect(calls).toEqual([])
    hooks.filesFinished('m1')
    expect(calls).toEqual([{ meetingId: 'm1', kinds: ['audio', 'transcript'] }])
    expect(timers).toEqual([])
  })

  it('sem pasta: a transcrição entra logo, montada na hora', () => {
    const { calls, hooks } = setup(false)
    hooks.transcriptSaved('m1')
    expect(calls).toEqual([{ meetingId: 'm1', kinds: ['transcript'] }])
  })

  it('o audio-finish nunca chegou: a transcrição vai depois do prazo', () => {
    const { calls, timers, hooks } = setup(true)
    hooks.transcriptSaved('m1')
    hooks.transcriptSaved('m1')
    expect(timers).toHaveLength(1)
    timers[0]?.()
    expect(calls).toEqual([{ meetingId: 'm1', kinds: ['audio', 'transcript'] }])
  })

})
