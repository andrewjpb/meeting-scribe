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
