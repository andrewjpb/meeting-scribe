// CA12: transcrição por reunião em `meetings/<id>.json`, atômica, e o Markdown de "Copiar transcrição".
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileTranscriptStore, MEETINGS_DIR, transcriptPath, type TranscriptStore } from '../src/main/meetings/transcripts'
import { transcriptMarkdown } from '../src/shared/transcript-markdown'
import { stitchedSpan, type TranscriptDocument, type TranscriptWord } from '../src/shared/transcription'

const document = (meetingId: string): TranscriptDocument => ({
  version: 1,
  meetingId,
  sourceLanguage: 'pt',
  targetLanguage: 'en',
  translationModel: 'qwen3.5-4b-32k-fast',
  segments: [
    { id: 's1', source: 'mic', speaker: null, startMs: 12_000, endMs: 14_000, text: 'Bom dia, pessoal.', translation: 'Good morning, everyone.', translationModel: 'qwen3.5-4b-32k-fast' },
    { id: 's2', source: 'system', speaker: 'A', startMs: 21_000, endMs: 23_000, text: 'A integração ficou pronta.', translation: null, translationModel: null },
  ],
})

describe('TranscriptStore (CA12)', () => {
  let dir: string
  let store: TranscriptStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'transcripts-'))
    store = createFileTranscriptStore({ dir, now: () => Date.parse('2026-11-14T18:00:00.000Z') })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('salva em meetings/<id>.json com modo 0600, sem temporário e com o formato exato', async () => {
    await store.save(document('reuniao-1'))
    const file = join(dir, MEETINGS_DIR, 'reuniao-1.json')
    expect(readdirSync(join(dir, MEETINGS_DIR))).toEqual(['reuniao-1.json'])
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(document('reuniao-1'))
    expect(await store.get('reuniao-1')).toEqual(document('reuniao-1'))
  })

  it('excluir apaga o arquivo; reunião sem transcrição devolve null', async () => {
    await store.save(document('reuniao-1'))
    expect(await store.get('outra')).toBeNull()
    await store.remove('reuniao-1')
    expect(existsSync(join(dir, MEETINGS_DIR, 'reuniao-1.json'))).toBe(false)
    expect(await store.get('reuniao-1')).toBeNull()
    await expect(store.remove('reuniao-1')).resolves.toBeUndefined()
  })

  it('id que escaparia da pasta não vira caminho', async () => {
    expect(transcriptPath(dir, '../fora')).toBeNull()
    expect(transcriptPath(dir, 'a/b')).toBeNull()
    expect(transcriptPath(dir, 'ok-1')).toBe(join(dir, MEETINGS_DIR, 'ok-1.json'))
    await expect(store.get('../fora')).resolves.toBeNull()
    await expect(store.remove('../fora')).resolves.toBeUndefined()
  })

  it('arquivo inválido vira .corrupt-<data> e a leitura devolve null', async () => {
    mkdirSync(join(dir, MEETINGS_DIR), { recursive: true })
    const file = join(dir, MEETINGS_DIR, 'quebrada.json')
    writeFileSync(file, '{ não é json')
    expect(await store.get('quebrada')).toBeNull()
    const files = readdirSync(join(dir, MEETINGS_DIR))
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^quebrada\.json\.corrupt-/)
  })

  it('não deixa temporário para trás em duas gravações seguidas', async () => {
    await Promise.all([store.save(document('a')), store.save(document('b'))])
    expect(readdirSync(join(dir, MEETINGS_DIR)).sort()).toEqual(['a.json', 'b.json'])
  })
})

describe('transcriptMarkdown (CA12)', () => {
  const started = new Date(2026, 10, 14, 18, 12, 0)
  const meeting = { title: 'Alinhamento semanal', startedAt: started.toISOString(), durationMs: 32 * 60_000 }

  it('falante, horário, texto e tradução, com o título, a data e a duração', () => {
    const markdown = transcriptMarkdown(meeting, document('reuniao-1'))
    expect(markdown).toBe(
      [
        '# Alinhamento semanal',
        '',
        '14 de novembro de 2026 · 18:12 · 32 min',
        '',
        '**Você** · 00:12',
        'Bom dia, pessoal.',
        '',
        '> Good morning, everyone.',
        '',
        '**Participante A** · 00:21',
        'A integração ficou pronta.',
        '',
      ].join('\n'),
    )
  })

  it('trecho vazio não entra; duração em segundos e horas', () => {
    const empty = {
      ...document('x'),
      segments: [{ id: 'vazio', source: 'mic' as const, speaker: null, startMs: 0, endMs: 0, text: '   ', translation: null, translationModel: null }],
    }
    expect(transcriptMarkdown(meeting, empty)).not.toContain('**Você**')
    expect(transcriptMarkdown({ ...meeting, durationMs: 45_000 }, empty)).toContain('· 45 s')
    expect(transcriptMarkdown({ ...meeting, durationMs: 62 * 60_000 }, empty)).toContain('· 1 h 02 min')
  })

  it('tradução com várias linhas: cada linha fica dentro da citação', () => {
    const multi: TranscriptDocument = {
      ...document('reuniao-2'),
      segments: [{ id: 's1', source: 'mic', speaker: null, startMs: 0, endMs: 1_000, text: 'Duas frases.', translation: 'First line.\n\nSecond line.\r\nThird.', translationModel: 'm' }],
    }
    expect(transcriptMarkdown(meeting, multi).split('\n').slice(4)).toEqual(['**Você** · 00:00', 'Duas frases.', '', '> First line.', '>', '> Second line.', '> Third.', ''])
  })
})

describe('stitchedSpan', () => {
  it('devolve ms inteiros mesmo com o relógio em fração de ms, como o arquivo salvo exige', () => {
    const span = stitchedSpan(1234.567, [{ text: 'oi', start: 100, end: 480 } as TranscriptWord])
    expect(span).toEqual({ startMs: 1335, endMs: 1715 })
  })
})
