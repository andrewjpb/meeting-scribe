// Pastas de reuniões (contrato 28, CA1 e CA7): no mesmo `meetings.json`, campo `folders` opcional; excluir a pasta
// tira as reuniões dela sem apagar nenhuma; mover para pasta que não existe recusa; nome cortado em 60.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileMeetingsStore, folderCreateSchema, meetingMoveSchema, MEETINGS_FILE, type MeetingsStore } from '../src/main/meetings/store'
import { FOLDER_NAME_MAX, type Meeting, type NewMeeting } from '../src/shared/meetings'

const input = (startedAt: string, title = ''): NewMeeting => ({ title, startedAt, durationMs: 60_000, sources: { mic: true, system: true } })

describe('pastas no store de reuniões', () => {
  let dir: string
  let store: MeetingsStore
  let ids: number
  const onDisk = (): { version: number; meetings: Meeting[]; folders?: { id: string; name: string }[] } => JSON.parse(readFileSync(join(dir, MEETINGS_FILE), 'utf8'))

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meetings-folders-'))
    ids = 0
    store = createFileMeetingsStore({ dir, newId: () => `id-${++ids}` })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('cria, renomeia e exclui pasta; nome com espaço nas pontas e acima de 60 é cortado; vazio não cria', async () => {
    const folder = await store.createFolder('  Cliente X  ')
    expect(folder).toEqual({ id: 'id-1', name: 'Cliente X' })
    expect(onDisk()).toMatchObject({ version: 1, folders: [{ id: 'id-1', name: 'Cliente X' }] })
    const long = await store.createFolder('a'.repeat(80))
    expect(long?.name).toHaveLength(FOLDER_NAME_MAX)
    expect(await store.createFolder('   ')).toBeNull()
    expect(await store.folders()).toHaveLength(2)

    expect(await store.renameFolder('id-1', ' Cliente Y ')).toEqual({ id: 'id-1', name: 'Cliente Y' })
    expect(await store.renameFolder('id-1', '  ')).toBeNull()
    expect(await store.renameFolder('nao-existe', 'Z')).toBeNull()
    expect((await store.folders()).map((item) => item.name)).toEqual(['Cliente Y', 'a'.repeat(FOLDER_NAME_MAX)])

    expect(await store.deleteFolder('id-1')).toBe(true)
    expect(await store.deleteFolder('id-1')).toBe(false)
    expect((await store.folders()).map((item) => item.id)).toEqual(['id-2'])
  })

  it('mover: para pasta, para fora; pasta inexistente recusa; excluir a pasta zera o folderId sem apagar reunião', async () => {
    const meeting = await store.create(input('2026-11-18T10:00:00.000Z', 'Kickoff'))
    const other = await store.create(input('2026-11-18T11:00:00.000Z', 'Revisão'))
    const folder = await store.createFolder('Cliente X')
    if (!folder) throw new Error('pasta não criada')
    expect(await store.move(meeting.id, 'nao-existe')).toBeNull()
    expect((await store.get(meeting.id))?.folderId).toBeUndefined()

    expect((await store.move(meeting.id, folder.id))?.folderId).toBe(folder.id)
    expect((await store.move(other.id, folder.id))?.folderId).toBe(folder.id)
    expect((await store.move(other.id, null))?.folderId).toBeNull()
    expect(await store.move('nao-existe', folder.id)).toBeNull()

    expect(await store.deleteFolder(folder.id)).toBe(true)
    const after = await store.list()
    expect(after.map((item) => item.id).sort()).toEqual([meeting.id, other.id].sort())
    expect(after.every((item) => item.folderId === null)).toBe(true)
  })

  it('renomear a reunião e gravar os arquivos não perdem a pasta; criar reunião não apaga as pastas', async () => {
    const folder = await store.createFolder('Cliente X')
    if (!folder) throw new Error('pasta não criada')
    const meeting = await store.create(input('2026-11-18T10:00:00.000Z'))
    await store.move(meeting.id, folder.id)
    expect((await store.rename(meeting.id, 'Novo título'))?.folderId).toBe(folder.id)
    expect((await store.setFiles(meeting.id, { audioPath: '/tmp/a.m4a', transcriptPath: '/tmp/a.md' }))?.folderId).toBe(folder.id)
    await store.create(input('2026-11-18T12:00:00.000Z'))
    await store.remove(meeting.id)
    expect(await store.folders()).toEqual([folder])
  })

  it('arquivo antigo, sem `folders` nem `folderId`, carrega; sem pasta nenhuma, o arquivo continua sem o campo', async () => {
    const old = { id: 'velha', title: 'Antiga', startedAt: '2026-10-01T10:00:00.000Z', durationMs: 1000, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null }
    writeFileSync(join(dir, MEETINGS_FILE), JSON.stringify({ version: 1, meetings: [old] }))
    expect(await store.list()).toEqual([old])
    expect(await store.folders()).toEqual([])
    await store.rename('velha', 'Antiga renomeada')
    expect('folders' in onDisk()).toBe(false)
  })

  it('pasta inválida no arquivo é descartada sem reprovar o arquivo: as reuniões continuam', async () => {
    const meeting = { id: 'm1', title: 'Kickoff', startedAt: '2026-11-18T10:00:00.000Z', durationMs: 1000, sources: { mic: true, system: true }, audioPath: null, transcriptPath: null, folderId: 'ok' }
    const folders = [{ id: 'vazia', name: '   ' }, { id: 'ok', name: ' Cliente X ' }, 'lixo', { name: 'sem id' }, { id: 'ok', name: 'Repetida' }]
    writeFileSync(join(dir, MEETINGS_FILE), JSON.stringify({ version: 1, meetings: [meeting], folders }))
    expect(await store.list()).toEqual([meeting])
    expect(await store.folders()).toEqual([{ id: 'ok', name: 'Cliente X' }])
    expect(readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(false)
    // `folders` que nem é lista também não derruba o arquivo.
    writeFileSync(join(dir, MEETINGS_FILE), JSON.stringify({ version: 1, meetings: [meeting], folders: 'x' }))
    expect(await store.list()).toEqual([meeting])
    expect(await store.folders()).toEqual([])
  })

  it('payloads dos canais: formato errado é recusado antes do store', () => {
    expect(folderCreateSchema.safeParse({ name: 42 }).success).toBe(false)
    expect(meetingMoveSchema.safeParse({ id: 'a', folderId: null }).success).toBe(true)
    expect(meetingMoveSchema.safeParse({ id: 'a', folderId: '' }).success).toBe(false)
    expect(meetingMoveSchema.safeParse({ id: 'a' }).success).toBe(false)
  })
})
