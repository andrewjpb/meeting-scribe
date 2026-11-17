import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileMeetingsStore, MEETINGS_FILE, type MeetingsStore } from '../src/main/meetings/store'
import { defaultMeetingTitle, type NewMeeting } from '../src/shared/meetings'

const input = (startedAt: string, title = ''): NewMeeting => ({ title, startedAt, durationMs: 90_000, sources: { mic: true, system: false } })

describe('store de reuniões', () => {
  let dir: string
  let store: MeetingsStore
  let ids: number

  const onDisk = (): { version: number; meetings: { id: string; title: string }[] } => JSON.parse(readFileSync(join(dir, MEETINGS_FILE), 'utf8'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meetings-store-'))
    ids = 0
    store = createFileMeetingsStore({ dir, now: () => Date.parse('2026-11-14T18:00:00.000Z'), newId: () => `id-${++ids}` })
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('sem arquivo, a lista é vazia e nada é criado', async () => {
    expect(await store.list()).toEqual([])
    expect(readdirSync(dir)).toEqual([])
  })

  it('cria, renomeia, lista e exclui, e o arquivo reflete cada passo', async () => {
    const a = await store.create(input('2026-11-12T09:00:00.000Z', 'Planejamento'))
    expect(a).toEqual({ id: 'id-1', title: 'Planejamento', startedAt: '2026-11-12T09:00:00.000Z', durationMs: 90_000, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null })
    expect(onDisk()).toEqual({ version: 1, meetings: [a] })

    const b = await store.create(input('2026-11-14T15:30:00.000Z'))
    expect(b.title).toBe(defaultMeetingTitle(new Date('2026-11-14T15:30:00.000Z')))
    const c = await store.create(input('2026-11-13T11:00:00.000Z', 'Revisão'))
    expect(onDisk().meetings.map((m) => m.id)).toEqual([a.id, b.id, c.id])

    expect((await store.list()).map((m) => m.id)).toEqual([b.id, c.id, a.id])

    const renamed = await store.rename(c.id, '  Revisão do contrato  ')
    expect(renamed?.title).toBe('Revisão do contrato')
    expect(onDisk().meetings.find((m) => m.id === c.id)?.title).toBe('Revisão do contrato')
    expect(await store.rename('nao-existe', 'x')).toBeNull()

    expect(await store.remove(a.id)).toBe(true)
    expect(onDisk().meetings.map((m) => m.id)).toEqual([b.id, c.id])
    expect(await store.remove(a.id)).toBe(false)
    expect(await store.get(b.id)).toEqual(b)
    expect(await store.get(a.id)).toBeNull()
  })

  it('evento da agenda (contrato 10/12): renomear não apaga; registro antigo vem sem o campo; acima do limite é inválido', async () => {
    const base = { startedAt: '2026-11-12T09:00:00.000Z', durationMs: 60_000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null }
    const calendar = { attendees: [{ name: 'Ana Lima', email: 'ana@exemplo.com' }, { name: '', email: 'bruno@exemplo.com' }] }
    writeFileSync(
      join(dir, MEETINGS_FILE),
      JSON.stringify({ version: 1, meetings: [{ id: 'com', title: 'Com agenda', ...base, calendar }, { id: 'sem', title: 'Antiga', ...base }, { id: 'nula', title: 'Nula', ...base, calendar: null }] }),
    )
    expect((await store.rename('com', 'Com agenda, renomeada'))?.calendar).toEqual(calendar)
    const disk = JSON.parse(readFileSync(join(dir, MEETINGS_FILE), 'utf8')) as { meetings: Record<string, unknown>[] }
    expect(disk.meetings[0]?.['calendar']).toEqual(calendar)
    expect('calendar' in (disk.meetings[1] ?? {})).toBe(false)
    expect(disk.meetings[2]?.['calendar']).toBeNull()

    const many = { attendees: Array.from({ length: 51 }, (_, i) => ({ name: `P${i}`, email: `p${i}@exemplo.com` })) }
    writeFileSync(join(dir, MEETINGS_FILE), JSON.stringify({ version: 1, meetings: [{ id: 'x', title: 'Muitos', ...base, calendar: many }] }))
    expect(await store.list()).toEqual([])
    writeFileSync(join(dir, MEETINGS_FILE), JSON.stringify({ version: 1, meetings: [{ id: 'x', title: 'Longo', ...base, calendar: { attendees: [{ name: 'n'.repeat(201), email: '' }] } }] }))
    expect(await store.list()).toEqual([])
  })

  it('contrato 12 (CA9): a reunião criada na gravação guarda o evento inteiro; sem evento, sem o campo', async () => {
    const calendar = {
      provider: 'google' as const,
      eventId: 'g1',
      title: 'Revisão do contrato',
      start: '2026-11-12T09:00:00.000Z',
      end: '2026-11-12T09:30:00.000Z',
      attendees: [{ name: 'Ana Lima', email: 'ana@exemplo.com' }],
      joinUrl: 'https://meet.google.com/abc-defg-hij',
    }
    const meeting = await store.create(input('2026-11-12T09:01:00.000Z', 'Revisão do contrato'), { calendar })
    expect(meeting.calendar).toEqual(calendar)
    expect(await store.get(meeting.id)).toEqual(meeting)
    expect((await store.rename(meeting.id, 'Outro nome'))?.calendar).toEqual(calendar)
    const plain = await store.create(input('2026-11-12T10:00:00.000Z'), { calendar: null })
    expect('calendar' in plain).toBe(false)
    await expect(store.create(input('2026-11-12T11:00:00.000Z'), { calendar: { ...calendar, start: 'ontem' } })).rejects.toThrow()
  })

  it('escreve de forma atômica: nenhum temporário fica para trás', async () => {
    await Promise.all([store.create(input('2026-11-14T10:00:00.000Z')), store.create(input('2026-11-14T11:00:00.000Z'))])
    expect(readdirSync(dir)).toEqual([MEETINGS_FILE])
    expect(onDisk().meetings).toHaveLength(2)
  })

  it('recusa título vazio ao renomear e entrada inválida ao criar', async () => {
    const a = await store.create(input('2026-11-14T10:00:00.000Z'))
    await expect(store.rename(a.id, '   ')).rejects.toThrow()
    await expect(store.create({ ...input('2026-11-14T10:00:00.000Z'), durationMs: -1 })).rejects.toThrow()
    await expect(store.create({ ...input('ontem') })).rejects.toThrow()
    expect(onDisk().meetings).toHaveLength(1)
  })

  it.each([
    ['JSON quebrado', '{"version":1,"meetings":['],
    ['formato errado', '{"version":2,"meetings":[]}'],
    ['registro inválido', '{"version":1,"meetings":[{"id":"x","title":"","startedAt":"2026","durationMs":1,"sources":{}}]}'],
  ])('arquivo corrompido (%s) vira lista vazia e o original é preservado', async (_label, content) => {
    writeFileSync(join(dir, MEETINGS_FILE), content)
    expect(await store.list()).toEqual([])
    const files = readdirSync(dir)
    expect(files).toEqual(['meetings.json.corrupt-2026-11-14T18-00-00-000Z'])
    expect(readFileSync(join(dir, files[0] as string), 'utf8')).toBe(content)

    const a = await store.create(input('2026-11-14T10:00:00.000Z'))
    expect(onDisk().meetings).toEqual([a])
  })
})
