// Arquivos da reunião numa pasta (contrato 07): nome (CA5), escrita em pedaços dentro da pasta (CA4),
// encerrar (CA6), transcrição em Markdown (CA6b), recuperação do `.part` (CA7) e o que o detalhe pede
// (CA8). Tudo em pasta temporária; diálogo e `shell` substitutos.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanFileTitle, FILE_TITLE_MAX, incompleteName, insideFolder, meetingFileBase, uniqueBase } from '../src/main/audio-files/names'
import { createMeetingFilesService, DEFAULT_FOLDER_NAME, type MeetingFilesService } from '../src/main/audio-files/service'
import { createFileMeetingsStore, MEETINGS_FILE, type MeetingsStore } from '../src/main/meetings/store'
import { createFileTranscriptStore, type TranscriptStore } from '../src/main/meetings/transcripts'
import { createFileSettingsStore, type SettingsStore } from '../src/main/settings/store'
import { AUDIO_CHUNK_MAX_BYTES } from '../src/shared/meeting-files'
import { transcriptMarkdown } from '../src/shared/transcript-markdown'
import { TRANSCRIPT_VERSION, type TranscriptDocument } from '../src/shared/transcription'

/** 15/11/2026 14:05 na hora local: o nome do arquivo usa a hora de quem gravou. */
const STARTED = new Date(2026, 10, 15, 14, 5).toISOString()
const BASE = '2026-11-15 14h05'

describe('nome do arquivo (CA5)', () => {
  it('AAAA-MM-DD HHhMM - título, na hora local', () => {
    expect(meetingFileBase(new Date(2026, 0, 3, 9, 7), 'Planejamento')).toBe('2026-01-03 09h07 - Planejamento')
    expect(meetingFileBase(new Date(STARTED), 'Reunião de 15/11 14:05')).toBe(`${BASE} - Reunião de 15-11 14-05`)
  })

  it('limpa o que o macOS não aceita, ponto inicial, controles e espaços; até 80 caracteres', () => {
    expect(cleanFileTitle('Cliente: revisão / contrato')).toBe('Cliente- revisão - contrato')
    expect(cleanFileTitle('..oculto')).toBe('oculto')
    expect(cleanFileTitle('linha\nquebrada\tcom\u0007controle')).toBe('linha quebrada com controle')
    expect(cleanFileTitle('   muitos     espaços   ')).toBe('muitos espaços')
    expect(cleanFileTitle('/')).toBe('-')
    expect(cleanFileTitle('   ')).toBe('Reunião')
    expect(cleanFileTitle('...')).toBe('Reunião')
    const long = cleanFileTitle('á'.repeat(200))
    expect([...long]).toHaveLength(FILE_TITLE_MAX)
    // O corte não deixa espaço ou ponto no fim.
    expect(cleanFileTitle(`${'a'.repeat(79)} b`)).toBe('a'.repeat(79))
  })

  it('já existe: (2), (3)…', () => {
    const taken = new Set(['x', 'x (2)'])
    expect(uniqueBase('x', (name) => taken.has(name))).toBe('x (3)')
    expect(uniqueBase('y', (name) => taken.has(name))).toBe('y')
  })

  it('nunca sai da pasta: nome sem barra nem ..', () => {
    expect(insideFolder('/tmp/pasta', 'a.m4a')).toBe('/tmp/pasta/a.m4a')
    for (const name of ['../fora.m4a', '..', '.', 'sub/a.m4a', '', 'a\0b']) expect(() => insideFolder('/tmp/pasta', name)).toThrow()
  })

  it('.part do app vira "(incompleto)"; .part de outro programa é ignorado', () => {
    expect(incompleteName(`${BASE} - Planejamento.m4a.part`)).toEqual({ base: `${BASE} - Planejamento (incompleto)`, extension: 'm4a' })
    expect(incompleteName(`${BASE} - Planejamento.md.part`)).toEqual({ base: `${BASE} - Planejamento (incompleto)`, extension: 'md' })
    expect(incompleteName('filme.mkv.part')).toBeNull()
    expect(incompleteName(`${BASE} - Planejamento.m4a`)).toBeNull()
  })
})

describe('arquivos da reunião na pasta (CA4, CA6, CA6b, CA7, CA8)', () => {
  let root: string
  let userData: string
  let home: string
  let folder: string
  let settings: SettingsStore
  let meetings: MeetingsStore
  let transcripts: TranscriptStore
  let files: MeetingFilesService
  let chosen: string | null
  let opened: { action: string; path: string }[]
  let ids: number

  const document = (meetingId: string, segments: TranscriptDocument['segments']): TranscriptDocument => ({
    version: TRANSCRIPT_VERSION,
    meetingId,
    sourceLanguage: 'pt',
    targetLanguage: 'en',
    translationModel: 'qwen3.5-4b-32k-fast',
    segments,
  })
  const FIRST: TranscriptDocument['segments'][number] = {
    id: 's1',
    source: 'mic',
    speaker: null,
    startMs: 0,
    endMs: 2000,
    text: 'Bom dia a todos.',
    translation: 'Good morning, everyone.',
    translationModel: 'qwen3.5-4b-32k-fast',
  }
  const SEGMENTS: TranscriptDocument['segments'] = [
    FIRST,
    { id: 's2', source: 'system', speaker: 'A', startMs: 3000, endMs: 6000, text: 'Podemos começar.', translation: null, translationModel: null },
  ]
  const bytes = (text: string): Uint8Array => new TextEncoder().encode(text)
  const create = (title = 'Planejamento') => meetings.create({ title, startedAt: STARTED, durationMs: 60_000, sources: { mic: true, system: true } })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'meeting-files-'))
    userData = join(root, 'userData')
    home = join(root, 'home')
    mkdirSync(userData)
    mkdirSync(home)
    folder = join(home, 'Documents', DEFAULT_FOLDER_NAME)
    settings = createFileSettingsStore({ dir: userData })
    ids = 0
    meetings = createFileMeetingsStore({ dir: userData, newId: () => `m${++ids}` })
    transcripts = createFileTranscriptStore({ dir: userData })
    chosen = null
    opened = []
    files = createMeetingFilesService({
      settings,
      meetings,
      transcripts,
      home,
      documents: join(home, 'Documents'),
      dialog: { chooseFolder: () => Promise.resolve(chosen) },
      opener: {
        openPath: (path) => {
          opened.push({ action: 'open', path })
          return Promise.resolve('')
        },
        showItemInFolder: (path) => void opened.push({ action: 'reveal', path }),
      },
      newId: () => `sessao-${++ids}`,
    })
  })
  afterEach(() => {
    chmodSync(root, 0o755)
    rmSync(root, { recursive: true, force: true })
  })

  it('pasta padrão ~/Documents/Meeting Scribe; "Escolher pasta…" grava pelo diálogo e cancelar não muda', async () => {
    expect(await files.folder()).toEqual({ path: folder, display: '~/Documents/Meeting Scribe' })
    expect(await files.chooseFolder()).toMatchObject({ chosen: false, folder: { display: '~/Documents/Meeting Scribe' } })
    chosen = join(home, 'Drive', 'Reuniões')
    const result = await files.chooseFolder()
    expect(result).toMatchObject({ chosen: true, folder: { path: chosen, display: '~/Drive/Reuniões' }, settings: { audioFolder: chosen } })
    expect((await settings.get()).audioFolder).toBe(chosen)
    chosen = 'relativa'
    expect((await files.chooseFolder()).chosen).toBe(false)
    expect((await settings.get()).audioFolder).toBe(join(home, 'Drive', 'Reuniões'))
  })

  it('grava em pedaços no .part (criando a pasta), renomeia no fim e escreve o .md com o texto do "Exportar"', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Reunião de 15/11 14:05', extension: 'm4a' })
    expect(begin).toEqual({ ok: true, id: 'sessao-1' })
    const part = join(folder, `${BASE} - Reunião de 15-11 14-05.m4a.part`)
    expect(readdirSync(folder)).toEqual([`${BASE} - Reunião de 15-11 14-05.m4a.part`])
    expect(readFileSync(part)).toHaveLength(0)

    // Pedaços em ordem, mesmo pedidos de uma vez.
    const appended = await Promise.all(['um,', 'dois,', 'tres'].map((text) => files.append({ id: 'sessao-1', data: bytes(text) })))
    expect(appended).toEqual([true, true, true])
    expect(readFileSync(part, 'utf8')).toBe('um,dois,tres')

    // Renomeada durante a gravação: o nome final usa o título salvo.
    const meeting = await create('Revisão: contrato')
    await transcripts.save(document(meeting.id, SEGMENTS))
    const result = await files.finish({ id: 'sessao-1', meetingId: meeting.id })
    const audioPath = join(folder, `${BASE} - Revisão- contrato.m4a`)
    const transcriptPath = join(folder, `${BASE} - Revisão- contrato.md`)
    expect(result).toEqual({ ok: true, audioPath, transcriptPath })
    expect(readdirSync(folder).sort()).toEqual([`${BASE} - Revisão- contrato.m4a`, `${BASE} - Revisão- contrato.md`])
    expect(readFileSync(audioPath, 'utf8')).toBe('um,dois,tres')
    const saved = await meetings.get(meeting.id)
    expect(saved).toMatchObject({ audioPath, transcriptPath })
    if (!saved) throw new Error('reunião não encontrada')
    expect(readFileSync(transcriptPath, 'utf8')).toBe(transcriptMarkdown(saved, document(meeting.id, SEGMENTS)))
    expect(readFileSync(transcriptPath, 'utf8')).toContain('**Participante A** · 00:03')

    // Sessão encerrada não aceita mais pedaço nem um segundo "encerrar".
    expect(await files.append({ id: 'sessao-1', data: bytes('x') })).toBe(false)
    expect(await files.finish({ id: 'sessao-1', meetingId: meeting.id })).toEqual({ ok: false, audioPath: null, transcriptPath: null })
  })

  it('mudanças depois de encerrar não reescrevem o .md (CA6b)', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'webm' })
    const meeting = await create()
    await transcripts.save(document(meeting.id, SEGMENTS))
    const transcriptPath = (await files.finish({ id: begin.ok ? begin.id : '', meetingId: meeting.id })).transcriptPath ?? ''
    const before = readFileSync(transcriptPath, 'utf8')
    await meetings.rename(meeting.id, 'Outro título')
    await transcripts.save(document(meeting.id, [{ ...FIRST, text: 'Texto editado.' }]))
    expect(readFileSync(transcriptPath, 'utf8')).toBe(before)
    expect(readdirSync(folder).sort()).toEqual([`${BASE} - Planejamento.md`, `${BASE} - Planejamento.webm`])
  })

  it('reunião sem trecho não cria o .md; o áudio é salvo igual (CA6b)', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    await files.append({ id: 'sessao-1', data: bytes('a') })
    const meeting = await create()
    await transcripts.save(document(meeting.id, [{ ...FIRST, text: '   ' }]))
    const result = await files.finish({ id: begin.ok ? begin.id : '', meetingId: meeting.id })
    expect(result).toEqual({ ok: true, audioPath: join(folder, `${BASE} - Planejamento.m4a`), transcriptPath: null })
    expect(readdirSync(folder)).toEqual([`${BASE} - Planejamento.m4a`])
    expect(await meetings.get(meeting.id)).toMatchObject({ transcriptPath: null })
  })

  it('nome que já existe ganha (2), (3)… no começo e no fim (CA5)', async () => {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${BASE} - Planejamento.m4a`), 'antiga')
    const first = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    const second = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    expect(readdirSync(folder).sort()).toEqual([
      `${BASE} - Planejamento (2).m4a.part`,
      `${BASE} - Planejamento (3).m4a.part`,
      `${BASE} - Planejamento.m4a`,
    ])
    const a = await create()
    const b = await create()
    expect((await files.finish({ id: first.ok ? first.id : '', meetingId: a.id })).audioPath).toBe(join(folder, `${BASE} - Planejamento (2).m4a`))
    expect((await files.finish({ id: second.ok ? second.id : '', meetingId: b.id })).audioPath).toBe(join(folder, `${BASE} - Planejamento (3).m4a`))
    expect(readFileSync(join(folder, `${BASE} - Planejamento.m4a`), 'utf8')).toBe('antiga')
  })

  it('opção desligada: nada é criado nem escrito (invariante)', async () => {
    await settings.update({ saveToFolder: false })
    expect(await files.begin({ startedAt: STARTED, title: 'x', extension: 'm4a' })).toEqual({ ok: false, error: 'disabled' })
    expect(existsSync(join(home, 'Documents'))).toBe(false)
    expect(await files.append({ id: 'qualquer', data: bytes('x') })).toBe(false)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, `${BASE} - Planejamento.m4a.part`), 'x')
    expect(await files.recover()).toEqual([])
    expect(readdirSync(folder)).toEqual([`${BASE} - Planejamento.m4a.part`])
  })

  it('pasta que não dá para escrever: falha tipada, nada sai da pasta (CA4)', async () => {
    const locked = join(root, 'trancada')
    mkdirSync(locked)
    chmodSync(locked, 0o500)
    chosen = locked
    await files.chooseFolder()
    expect(await files.begin({ startedAt: STARTED, title: 'x', extension: 'm4a' })).toEqual({ ok: false, error: 'unwritable' })
    expect(await files.begin({ startedAt: STARTED, title: 'x', extension: null })).toEqual({ ok: false, error: 'unwritable' })
    expect(readdirSync(locked)).toEqual([])
    chmodSync(locked, 0o755)
  })

  it('falha no meio: o pedaço não grava, o .part fica para a recuperação e o .md ainda é tentado (CA4, CA6b)', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    expect(await files.append({ id: 'sessao-1', data: bytes('a') })).toBe(true)
    // O .part some (disco removido, pasta apagada): o próximo pedaço falha e a sessão para de escrever.
    rmSync(join(folder, `${BASE} - Planejamento.m4a.part`))
    rmSync(folder, { recursive: true })
    writeFileSync(folder, 'agora é arquivo')
    expect(await files.append({ id: 'sessao-1', data: bytes('b') })).toBe(false)
    expect(await files.append({ id: 'sessao-1', data: bytes('c') })).toBe(false)
    const meeting = await create()
    await transcripts.save(document(meeting.id, SEGMENTS))
    const result = await files.finish({ id: begin.ok ? begin.id : '', meetingId: meeting.id })
    expect(result).toEqual({ ok: false, audioPath: null, transcriptPath: null })
    // A transcrição interna continua lá.
    expect((await transcripts.get(meeting.id))?.segments).toHaveLength(2)
    expect(await meetings.get(meeting.id)).toMatchObject({ audioPath: null, transcriptPath: null })
  })

  it('.md que não dá para escrever: aviso, sem perder a transcrição interna (CA6b)', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: null })
    expect(begin).toEqual({ ok: true, id: 'sessao-1' })
    // A pasta perde a permissão de escrita antes de encerrar.
    chmodSync(folder, 0o500)
    const meeting = await create()
    await transcripts.save(document(meeting.id, SEGMENTS))
    const result = await files.finish({ id: begin.ok ? begin.id : '', meetingId: meeting.id })
    chmodSync(folder, 0o755)
    expect(result).toEqual({ ok: false, audioPath: null, transcriptPath: null })
    expect(readdirSync(folder)).toEqual([])
    expect((await transcripts.get(meeting.id))?.segments).toHaveLength(2)
    expect(await meetings.get(meeting.id)).toMatchObject({ audioPath: null, transcriptPath: null })
  })

  it('pedaço inválido ou grande demais é recusado sem escrever', async () => {
    await files.begin({ startedAt: STARTED, title: 'x', extension: 'm4a' })
    expect(await files.append({ id: 'sessao-1', data: 'texto' })).toBe(false)
    expect(await files.append({ id: 'sessao-1', data: new Uint8Array(AUDIO_CHUNK_MAX_BYTES + 1) })).toBe(false)
    expect(await files.append({ id: '../../x', data: bytes('a') })).toBe(false)
    expect(await files.append(null)).toBe(false)
    expect(await files.append({ id: 'sessao-1', data: bytes('ok').buffer })).toBe(true)
    await expect(files.begin({ startedAt: 'ontem', title: 'x', extension: 'm4a' })).rejects.toThrow()
    await expect(files.begin({ startedAt: STARTED, title: 'x', extension: 'exe' })).rejects.toThrow()
  })

  it('app fechado no meio: o .part fica e, na abertura seguinte, vira "(incompleto)" (CA7)', async () => {
    await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    await files.append({ id: 'sessao-1', data: bytes('meio') })
    writeFileSync(join(folder, `${BASE} - Outra.md.part`), '# Outra')
    writeFileSync(join(folder, `${BASE} - Planejamento (incompleto).m4a`), 'já existia')
    writeFileSync(join(folder, 'download.zip.part'), 'de outro programa')
    // App reaberto: outra instância do serviço, sem a sessão em memória.
    const reopened = createMeetingFilesService({
      settings: createFileSettingsStore({ dir: userData }),
      meetings,
      transcripts,
      home,
      documents: join(home, 'Documents'),
      dialog: { chooseFolder: () => Promise.resolve(null) },
      opener: { openPath: () => Promise.resolve(''), showItemInFolder: () => undefined },
    })
    expect((await reopened.recover()).sort()).toEqual([`${BASE} - Outra (incompleto).md`, `${BASE} - Planejamento (incompleto) (2).m4a`])
    expect(readdirSync(folder).sort()).toEqual([
      `${BASE} - Outra (incompleto).md`,
      `${BASE} - Planejamento (incompleto) (2).m4a`,
      `${BASE} - Planejamento (incompleto).m4a`,
      'download.zip.part',
    ])
    expect(readFileSync(join(folder, `${BASE} - Planejamento (incompleto) (2).m4a`), 'utf8')).toBe('meio')
    // Pasta que ainda não existe não é criada.
    rmSync(folder, { recursive: true })
    expect(await reopened.recover()).toEqual([])
    expect(existsSync(folder)).toBe(false)
  })

  it('a gravação em curso não é recuperada pelo mesmo processo', async () => {
    await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    expect(await files.recover()).toEqual([])
    expect(readdirSync(folder)).toEqual([`${BASE} - Planejamento.m4a.part`])
  })

  it('detalhe: nome, se ainda existe, e Abrir / Mostrar no Finder só pelo registro (CA8)', async () => {
    const begin = await files.begin({ startedAt: STARTED, title: 'Planejamento', extension: 'm4a' })
    await files.append({ id: 'sessao-1', data: bytes('a') })
    const meeting = await create()
    await transcripts.save(document(meeting.id, SEGMENTS))
    const { audioPath, transcriptPath } = await files.finish({ id: begin.ok ? begin.id : '', meetingId: meeting.id })
    expect(await files.info(meeting.id)).toEqual({
      folder: '~/Documents/Meeting Scribe',
      audio: { name: `${BASE} - Planejamento.m4a`, exists: true },
      transcript: { name: `${BASE} - Planejamento.md`, exists: true },
    })
    expect(await files.open({ meetingId: meeting.id, kind: 'audio' })).toBe(true)
    expect(await files.reveal({ meetingId: meeting.id, kind: 'transcript' })).toBe(true)
    expect(opened).toEqual([
      { action: 'open', path: audioPath },
      { action: 'reveal', path: transcriptPath },
    ])

    // Apagado ou movido: aparece como não encontrado e não abre nada.
    rmSync(audioPath ?? '')
    expect((await files.info(meeting.id))?.audio).toEqual({ name: `${BASE} - Planejamento.m4a`, exists: false })
    expect(await files.open({ meetingId: meeting.id, kind: 'audio' })).toBe(false)
    expect(await files.open({ meetingId: meeting.id, kind: 'outro' })).toBe(false)
    expect(await files.open({ path: '/etc/hosts' })).toBe(false)
    expect(opened).toHaveLength(2)

    // Reunião sem arquivo na pasta.
    const plain = await create('Sem pasta')
    expect(await files.info(plain.id)).toBeNull()
    expect(await files.info('nao-existe')).toBeNull()
  })

  it('reunião antiga, sem os campos, carrega com audioPath e transcriptPath nulos (CA6)', async () => {
    writeFileSync(
      join(userData, MEETINGS_FILE),
      JSON.stringify({ version: 1, meetings: [{ id: 'antiga', title: 'Antiga', startedAt: STARTED, durationMs: 1000, sources: { mic: true, system: false } }] }),
    )
    expect(await meetings.get('antiga')).toEqual({ id: 'antiga', title: 'Antiga', startedAt: STARTED, durationMs: 1000, sources: { mic: true, system: false }, audioPath: null, transcriptPath: null })
    expect(await meetings.setFiles('antiga', { audioPath: '/x/a.m4a', transcriptPath: null })).toMatchObject({ audioPath: '/x/a.m4a', transcriptPath: null })
    expect(await meetings.setFiles('nao-existe', { audioPath: null, transcriptPath: null })).toBeNull()
    // Excluir a reunião não apaga os arquivos da pasta: o store só tira o registro.
    expect(await meetings.remove('antiga')).toBe(true)
  })
})
