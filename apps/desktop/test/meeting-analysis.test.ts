// "Analisar até agora" (contrato 19): o tipo e os limites (CA1), a instrução, o pedido e a leitura da
// resposta (CA2), o arquivo `meetings/<id>.analyses.json` (CA5), o serviço na gravação e depois dela (CA2,
// CA5, CA6), o Markdown (CA6) e o resumo que recebe as perguntas em aberto (CA6). O `claude` é o falso
// (test/fixtures/fake-claude.mjs) ou um processo de mentira; nunca o de verdade.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  analysisContentOf,
  analysisInput,
  analysisLines,
  analysisNoteLines,
  analysisParser,
  analysisSystemPrompt,
  clockToMs,
  openQuestionLines,
  previousAnalysisLines,
  ANALYSIS_TIMEOUT_MS,
} from '../src/main/claude-cli/analysis'
import { runOneShot, summaryInput, summarySystemPrompt, type SpawnSummary } from '../src/main/claude-cli/summary'
import { analysesPath, createFileAnalysesStore } from '../src/main/meetings/analyses'
import { createAnalysisService } from '../src/main/meetings/analysis-service'
import { createFileNotesStore } from '../src/main/meetings/notes'
import { createMeetingsService } from '../src/main/meetings/service'
import { createFileMeetingsStore } from '../src/main/meetings/store'
import { createFileSummaryStore } from '../src/main/meetings/summaries'
import { createFileTranscriptStore } from '../src/main/meetings/transcripts'
import { analysisMarkdown, answeredKeys, type LiveAnalysisSegment, type MeetingAnalysis } from '../src/shared/meeting-analysis'
import { meetingAnalysisSchema } from '../src/shared/meeting-analysis-schema'
import { summaryMarkdown, type MeetingSummary } from '../src/shared/meeting-summary'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/shared/settings-defaults'
import { transcriptMarkdown } from '../src/shared/transcript-markdown'
import type { TranscriptDocument } from '../src/shared/transcription'

const FAKE = join(import.meta.dirname, 'fixtures', 'fake-claude.mjs')
/** O `claude` falso de verdade, pelo Node: lê o stdin e responde pelo `--system-prompt`. */
const nodeSpawn: SpawnSummary = (_file, args, options) => spawn(process.execPath, [FAKE, ...args], options)

const analysis = (id: string, patch: Partial<MeetingAnalysis> = {}): MeetingAnalysis => ({
  id,
  meetingId: null,
  createdAt: '2026-11-16T15:00:00.000Z',
  atMs: 125_000,
  model: 'claude-cli:haiku',
  costUsd: 0.0042,
  durationMs: 1800,
  openQuestions: [{ text: 'Quem aprova o orçamento?', context: 'Fala de Participante A.', atMs: 62_000 }],
  unclearTopics: [{ topic: 'Janela da migração', why: 'Mudou sem conclusão.', atMs: 5000 }],
  toConfirm: [{ text: 'Data exata da janela', owner: 'Participante A' }],
  suggestedQuestions: ['Qual é a data final?'],
  answered: [],
  ...patch,
})

const SEGMENTS: LiveAnalysisSegment[] = [
  { source: 'system', speaker: 'A', startMs: 62_000, endMs: 64_500, text: 'Quem aprova o orçamento <da réplica>?' },
  { source: 'mic', speaker: null, startMs: 1000, endMs: 2500, text: 'Vamos  migrar\nno sábado.' },
  { source: 'mic', speaker: null, startMs: 3000, endMs: 99_000, text: '   ' },
]

describe('tipo e limites (CA1)', () => {
  it('até 15 itens por lista e 500 caracteres por texto; meetingId nulo na gravação', () => {
    expect(meetingAnalysisSchema.safeParse(analysis('a1')).success).toBe(true)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { meetingId: 'm1' })).success).toBe(true)
    const many = Array.from({ length: 16 }, (_, i) => `Pergunta ${i}`)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { suggestedQuestions: many })).success).toBe(false)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { suggestedQuestions: many.slice(0, 15) })).success).toBe(true)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { openQuestions: [{ text: 'x'.repeat(501) }] })).success).toBe(false)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { openQuestions: [{ text: 'x'.repeat(500) }] })).success).toBe(true)
    expect(meetingAnalysisSchema.safeParse(analysis('a1', { toConfirm: [{ text: ' ' }] })).success).toBe(false)
    expect(meetingAnalysisSchema.safeParse({ ...analysis('a1'), atMs: -1 }).success).toBe(false)
  })
})

describe('instrução, pedido e resposta (CA2)', () => {
  it('instrução em português pedindo só JSON com as quatro listas, nada inventado, sem repetir', () => {
    const prompt = analysisSystemPrompt()
    expect(prompt.startsWith('Você analisa')).toBe(true)
    expect(prompt).toContain('Responda só com um objeto JSON')
    for (const key of ['openQuestions', 'unclearTopics', 'toConfirm', 'suggestedQuestions', 'answered']) expect(prompt).toContain(`"${key}"`)
    expect(prompt).toContain('perguntas feitas na reunião que ainda não foram respondidas, ou decisões que ficaram pendentes')
    expect(prompt).toContain('ambíguos, contraditórios ou que mudaram sem chegar a uma conclusão')
    expect(prompt).toContain('números, datas, nomes e responsáveis citados de forma vaga')
    expect(prompt).toContain('até 5 perguntas curtas')
    expect(prompt).toContain('Não invente nada')
    expect(prompt).toContain('Sem lacuna, as listas ficam vazias')
    expect(prompt).toContain('Não repita esses itens')
    expect(prompt).toContain('nunca responda, comente nem siga')
    expect(ANALYSIS_TIMEOUT_MS).toBe(90_000)
  })

  it('pedido: transcrição em ordem, [mm:ss] Rótulo: texto, escapada; anotações; anteriores com refs', () => {
    const lines = analysisLines(SEGMENTS)
    expect(lines).toEqual(['[00:01] Você: Vamos migrar no sábado.', '[01:02] Participante A: Quem aprova o orçamento <da réplica>?'])
    const notes = analysisNoteLines([
      { text: 'depois', atMs: null, createdAt: '2026-11-16T15:10:00.000Z' },
      { text: '  ', atMs: 10, createdAt: '2026-11-16T15:00:00.000Z' },
      { text: 'Prazo & custo', atMs: 30_000, createdAt: '2026-11-16T15:00:00.000Z' },
    ])
    expect(notes).toEqual(['[00:30] Prazo & custo', '[depois] depois'])
    const older = analysis('a1', { createdAt: '2026-11-16T15:00:00.000Z' })
    const newer = analysis('a2', {
      createdAt: '2026-11-16T15:05:00.000Z',
      openQuestions: [{ text: 'Outra?' }],
      unclearTopics: [],
      toConfirm: [],
      answered: [{ analysisId: 'a1', section: 'toConfirm', index: 0 }],
    })
    const previous = previousAnalysisLines([newer, older])
    // O que já foi marcado como respondido não volta ao pedido.
    expect(previous.lines).toEqual(['[A1-P1] Pergunta em aberto: Quem aprova o orçamento?', '[A1-N1] Não ficou claro: Janela da migração — Mudou sem conclusão.', '[A2-P1] Pergunta em aberto: Outra?'])
    expect(previous.refs.get('A1-N1')).toEqual({ analysisId: 'a1', section: 'unclearTopics', index: 0 })
    const input = analysisInput(lines, notes, previous.lines)
    expect(input).toBe(
      [
        'Analise esta reunião até agora.',
        '',
        '<transcricao>',
        '[00:01] Você: Vamos migrar no sábado.',
        '[01:02] Participante A: Quem aprova o orçamento &lt;da réplica&gt;?',
        '</transcricao>',
        '<anotacoes>',
        '[00:30] Prazo &amp; custo',
        '[depois] depois',
        '</anotacoes>',
        '<analises_anteriores>',
        ...previous.lines,
        '</analises_anteriores>',
        '',
      ].join('\n'),
    )
    expect(analysisInput(lines)).not.toContain('<anotacoes>')
  })

  it('resposta: com cercas, at em mm:ss vira atMs, null some, refs viram AnsweredRef; inválido é format', () => {
    const refs = previousAnalysisLines([analysis('a1')]).refs
    const parse = analysisParser(refs)
    const body = {
      openQuestions: [{ text: ' Quem aprova? ', context: null, at: '01:02' }],
      unclearTopics: [{ topic: 'Janela', why: 'Mudou.', at: '[1:00:05]' }],
      toConfirm: [{ text: 'Data', owner: '' }],
      suggestedQuestions: ['Qual a data?'],
      answered: ['A1-C1', '[A1-C1]', 'A9-P1'],
    }
    const result = parse(`Aqui:\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\``, 0.01, 900)
    expect(result).toEqual({
      ok: true,
      costUsd: 0.01,
      durationMs: 900,
      content: {
        openQuestions: [{ text: 'Quem aprova?', atMs: 62_000 }],
        unclearTopics: [{ topic: 'Janela', why: 'Mudou.', atMs: 3_605_000 }],
        toConfirm: [{ text: 'Data' }],
        suggestedQuestions: ['Qual a data?'],
        answered: [{ analysisId: 'a1', section: 'toConfirm', index: 0 }],
      },
    })
    // Sem lacuna: listas vazias (ausente também vale como vazia).
    expect(parse('{"openQuestions": [], "unclearTopics": [], "suggestedQuestions": []}', null, null)).toMatchObject({ ok: true, content: { toConfirm: [], answered: [] } })
    expect(parse('não é JSON', null, null)).toEqual({ ok: false, error: 'format' })
    expect(parse('{"openQuestions": "texto"}', null, null)).toEqual({ ok: false, error: 'format' })
    expect(parse('{"openQuestions": [1]}', null, null)).toEqual({ ok: false, error: 'format' })
    // Tolerante com o conteúdo: texto longo cortado em 500, lista cortada em 15, item sem texto sai, porquê vazio vira "Sem detalhe".
    const loose = parse(
      JSON.stringify({
        openQuestions: [{ context: 'sem texto' }, { text: 'x'.repeat(800) }],
        unclearTopics: [{ topic: 'Prazo', why: null }, { topic: 'Custo', why: '  ' }],
        suggestedQuestions: Array.from({ length: 20 }, (_, i) => `p${i}`),
      }),
      null,
      null,
    )
    expect(loose).toMatchObject({ ok: true, content: { unclearTopics: [{ topic: 'Prazo', why: 'Sem detalhe' }, { topic: 'Custo', why: 'Sem detalhe' }] } })
    if (loose.ok) {
      expect(loose.content.openQuestions).toHaveLength(1)
      expect(loose.content.openQuestions[0]?.text).toHaveLength(500)
      expect(loose.content.suggestedQuestions).toEqual(Array.from({ length: 15 }, (_, i) => `p${i}`))
    }
    expect(analysisContentOf(null, refs)).toBeNull()
    expect(clockToMs('00:61')).toBeUndefined()
    expect(clockToMs('agora')).toBeUndefined()
    expect(clockToMs('12:34')).toBe(754_000)
  })

  it('com o claude falso de verdade: -p sem ferramentas, JSON entre cercas, custo nominal', async () => {
    const lines = analysisLines(SEGMENTS)
    const result = await runOneShot({
      binaryPath: FAKE,
      model: 'haiku',
      cwd: tmpdir(),
      env: { PATH: process.env['PATH'] ?? '' },
      spawn: nodeSpawn,
      input: analysisInput(lines),
      systemPrompt: analysisSystemPrompt(),
      parse: analysisParser(new Map()),
      label: 'análise',
    })
    expect(result).toMatchObject({ ok: true, costUsd: 0.0042, content: { openQuestions: [{ text: 'Quem aprova o orçamento <da réplica>?', atMs: 62_000 }], suggestedQuestions: ['Qual é a data final da janela?', 'Quem confirma com o cliente?'] } })
  })

  it('timeout: o processo morre e o resultado é timeout', async () => {
    const result = await runOneShot({
      binaryPath: FAKE,
      model: 'haiku',
      cwd: tmpdir(),
      env: { PATH: process.env['PATH'] ?? '' },
      spawn: nodeSpawn,
      input: analysisInput(['[00:01] Você: Oi?']),
      systemPrompt: analysisSystemPrompt(),
      parse: analysisParser(new Map()),
      label: 'análise',
      timeoutMs: 50,
    })
    expect(result).toEqual({ ok: false, error: 'timeout' })
  })
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'analise-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('arquivo das análises (CA5)', () => {
  it('escrita atômica com a reunião em cada análise; inválido ou de outra reunião = sem análises; add e remove', async () => {
    const store = createFileAnalysesStore({ dir })
    expect(await store.get('m1')).toEqual([])
    const saved = await store.save('m1', [analysis('a1')])
    expect(saved?.[0]?.meetingId).toBe('m1')
    const file = analysesPath(dir, 'm1') ?? ''
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, meetingId: 'm1', analyses: [{ id: 'a1', meetingId: 'm1' }] })
    await store.add('m1', analysis('a2'))
    await store.add('m1', analysis('a2', { atMs: 9 }))
    expect((await store.get('m1')).map((item) => [item.id, item.atMs])).toEqual([
      ['a1', 125_000],
      ['a2', 9],
    ])
    await expect(store.save('m1', [analysis('a1', { suggestedQuestions: [''] })])).rejects.toThrow()
    expect(analysesPath(dir, '../fora')).toBeNull()
    writeFileSync(file, '{ quebrado')
    expect(await store.get('m1')).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, meetingId: 'outra', analyses: [] }))
    expect(await store.get('m1')).toEqual([])
    await store.save('m1', [analysis('a1')])
    await store.remove('m1')
    expect(await store.get('m1')).toEqual([])
  })
})

const settingsStore = (patch: Partial<AppSettings> = {}) => ({ get: () => Promise.resolve({ ...DEFAULT_SETTINGS, claudeTransport: 'cli', claudeModel: 'haiku', ...patch } as AppSettings) })

describe('serviço da análise (CA2, CA5, CA6)', () => {
  const transcript = (meetingId: string): TranscriptDocument => ({
    version: 1,
    meetingId,
    sourceLanguage: 'pt',
    targetLanguage: 'en',
    translationModel: null,
    segments: [
      { id: 's1', source: 'mic', speaker: null, startMs: 1000, endMs: 2000, text: 'Vamos migrar no sábado?', translation: null, translationModel: null },
      { id: 's2', source: 'system', speaker: 'A', startMs: 5000, endMs: 6000, text: 'Depende do cliente.', translation: null, translationModel: null },
    ],
  })

  const setup = (locate: 'ok' | 'missing' = 'ok') => {
    const meetings = createFileMeetingsStore({ dir, newId: () => 'm1' })
    const transcripts = createFileTranscriptStore({ dir })
    const notes = createFileNotesStore({ dir })
    const analyses = createFileAnalysesStore({ dir })
    const copied: string[] = []
    const spawns: string[][] = []
    const service = createAnalysisService({
      settings: settingsStore(),
      meetings,
      transcripts,
      notes,
      analyses,
      locate: () => Promise.resolve(locate === 'ok' ? { ok: true, path: FAKE, version: '2.1.312', source: 'auto' } : { ok: false, error: 'not-found' }),
      spawn: (file, args, options) => {
        spawns.push([...args])
        return nodeSpawn(file, args, options)
      },
      userData: dir,
      baseEnv: { PATH: process.env['PATH'] ?? '', HOME: dir },
      clipboard: { writeText: (text) => void copied.push(text) },
      newId: (() => {
        let n = 0
        return () => `an-${++n}`
      })(),
    })
    return { meetings, transcripts, notes, analyses, service, copied, spawns }
  }

  it('na gravação: responde a análise sem gravar nada; sem trecho é empty; sem claude é not-found', async () => {
    const { service, analyses, spawns } = setup()
    const live = { recordingId: 'g1', atMs: 7000, segments: SEGMENTS, notes: [], previous: [] }
    const [one, same] = await Promise.all([service.run({ live }), service.run({ live })])
    expect(one).toMatchObject({ ok: true, analysis: { id: 'an-1', meetingId: null, atMs: 7000, model: 'claude-cli:haiku', costUsd: 0.0042 } })
    // Repetido enquanto gera: a mesma resposta, um processo só.
    expect(same).toBe(one)
    expect(spawns).toHaveLength(1)
    expect(spawns[0]).toContain('--strict-mcp-config')
    expect(spawns[0]?.[spawns[0].indexOf('--tools') + 1]).toBe('')
    // A transcrição só vai pelo stdin.
    expect(spawns[0]?.some((arg) => arg.includes('migrar'))).toBe(false)
    expect(await analyses.get('m1')).toEqual([])
    expect(await service.run({ live: { ...live, segments: [{ source: 'mic', speaker: null, startMs: 0, endMs: 0, text: ' ' }] } })).toEqual({ ok: false, error: 'empty' })
    expect(await setup('missing').service.run({ live })).toEqual({ ok: false, error: 'not-found' })
    await expect(service.run({ live: { ...live, atMs: -5 } })).rejects.toThrow()
  })

  it('a segunda análise marca o item respondido da primeira (refs do pedido)', async () => {
    const { service } = setup()
    const first = await service.run({ live: { recordingId: 'g1', atMs: 7000, segments: SEGMENTS, notes: [], previous: [] } })
    if (!first.ok) throw new Error('primeira falhou')
    const second = await service.run({ live: { recordingId: 'g1', atMs: 9000, segments: SEGMENTS, notes: [], previous: [first.analysis] } })
    expect(second).toMatchObject({ ok: true, analysis: { answered: [{ analysisId: first.analysis.id, section: 'openQuestions', index: 0 }] } })
    if (second.ok) expect(answeredKeys([first.analysis, second.analysis]).has(`${first.analysis.id}:openQuestions:0`)).toBe(true)
  })

  it('uma chave por gravação: outra gravação cancela a análise anterior, que nunca chega à nova; limite de 100; só 20 anteriores vão no pedido', async () => {
    const { service } = setup()
    const live = (recordingId: string, previous: MeetingAnalysis[] = []) => ({ live: { recordingId, atMs: 7000, segments: SEGMENTS, notes: [], previous } })
    const fromA = service.run(live('gravacao-A'))
    await new Promise((resolve) => setTimeout(resolve, 50))
    const fromB = await service.run(live('gravacao-B'))
    expect(await fromA).toEqual({ ok: false, error: 'failed' })
    expect(fromB).toMatchObject({ ok: true, analysis: { meetingId: null } })
    const many = Array.from({ length: 100 }, (_, i) => analysis(`p${i}`, { createdAt: new Date(Date.parse('2026-11-16T15:00:00.000Z') + i * 1000).toISOString() }))
    expect(await service.run(live('gravacao-B', many))).toEqual({ ok: false, error: 'limit' })
    // Com 25 anteriores, a segunda resposta marca a ref A1 das 20 mais recentes: a p5.
    const second = await service.run(live('gravacao-B', many.slice(0, 25)))
    expect(second).toMatchObject({ ok: true, analysis: { answered: [{ analysisId: 'p5', section: 'openQuestions', index: 0 }] } })
  })

  it('salvar ou acrescentar enquanto a reunião é excluída: a conferência na fila não deixa arquivo órfão', async () => {
    const { meetings, analyses, service } = setup()
    const meeting = await meetings.create({ title: 'Migração', startedAt: '2026-11-16T15:00:00.000Z', durationMs: 600_000, sources: { mic: true, system: true } })
    // Uma escrita anterior segura a fila; o "acrescentar" entra atrás dela e a reunião é excluída no meio.
    let release: () => void = () => undefined
    const held = new Promise<boolean>((resolve) => {
      release = () => resolve(false)
    })
    const blocking = analyses.save(meeting.id, [], () => held)
    const adding = service.add({ meetingId: meeting.id, analysis: analysis('tarde') })
    const saving = service.save({ meetingId: meeting.id, analyses: [analysis('gravada')] })
    await meetings.remove(meeting.id)
    release()
    await blocking
    expect(await adding).toBe(false)
    expect(await saving).toBe(false)
    expect(existsSync(analysesPath(dir, meeting.id) ?? '')).toBe(false)
  })

  it('depois da reunião: analisa a transcrição completa e salva junto; salvar e acrescentar; excluir a reunião apaga', async () => {
    const { meetings, transcripts, analyses, service, copied } = setup()
    const meeting = await meetings.create({ title: 'Migração', startedAt: '2026-11-16T15:00:00.000Z', durationMs: 600_000, sources: { mic: true, system: true } })
    expect(await service.save({ meetingId: meeting.id, analyses: [analysis('gravada')] })).toBe(true)
    expect(await service.save({ meetingId: 'nao-existe', analyses: [] })).toBe(false)
    await transcripts.save(transcript(meeting.id))
    const result = await service.run({ meetingId: meeting.id })
    // "Até" é o fim do último trecho com texto.
    expect(result).toMatchObject({ ok: true, analysis: { meetingId: meeting.id, atMs: 6000 } })
    expect((await service.list(meeting.id)).map((item) => item.id)).toEqual(['gravada', 'an-1'])
    expect(await service.add({ meetingId: meeting.id, analysis: analysis('atrasada') })).toBe(true)
    expect((await analyses.get(meeting.id)).map((item) => item.id)).toEqual(['gravada', 'an-1', 'atrasada'])
    expect(await service.copy({ text: 'Quem aprova?' })).toBe(true)
    expect(copied).toEqual(['Quem aprova?'])
    expect(await service.copy({ text: '' })).toBe(false)
    const meetingsService = createMeetingsService({ meetings, transcripts, summaries: createFileSummaryStore({ dir }), analyses: service, clipboard: { writeText: () => undefined } })
    expect(await meetingsService.deleteMeeting(meeting.id)).toBe(true)
    expect(await analyses.get(meeting.id)).toEqual([])
    expect(await service.list(meeting.id)).toEqual([])
  })
})

describe('Markdown e resumo (CA6)', () => {
  const meeting = { title: 'Migração', startedAt: '2026-11-16T15:00:00.000Z', durationMs: 600_000 }

  it('"## Perguntas em aberto" com a última análise; vazia ou sem análise não aparece', () => {
    const older = analysis('a1', { createdAt: '2026-11-16T15:00:00.000Z', suggestedQuestions: ['Antiga?'] })
    const latest = analysis('a2', { createdAt: '2026-11-16T15:10:00.000Z', atMs: 1_421_000, toConfirm: [{ text: 'Data exata' }] })
    expect(analysisMarkdown([latest, older])).toBe(
      [
        '## Perguntas em aberto',
        '',
        '_Análise da gravação até 23:41._',
        '',
        '**Perguntas em aberto**',
        '',
        '- Quem aprova o orçamento? (01:02) — Fala de Participante A.',
        '',
        '**Não ficou claro**',
        '',
        '- Janela da migração (00:05) — Mudou sem conclusão.',
        '',
        '**Para confirmar**',
        '',
        '- Data exata',
        '',
        '**Perguntas para fazer agora**',
        '',
        '- Qual é a data final?',
        '',
      ].join('\n'),
    )
    expect(analysisMarkdown([])).toBe('')
    expect(analysisMarkdown([analysis('v', { openQuestions: [], unclearTopics: [], toConfirm: [], suggestedQuestions: [] })])).toBe('')
  })

  it('o .md da transcrição e o do resumo ganham a seção quando houver', () => {
    const document: TranscriptDocument = { version: 1, meetingId: 'm1', sourceLanguage: 'pt', targetLanguage: null, translationModel: null, segments: [] }
    expect(transcriptMarkdown(meeting, document, [], [analysis('a1')])).toContain('\n\n## Perguntas em aberto\n\n')
    expect(transcriptMarkdown(meeting, document)).not.toContain('Perguntas em aberto')
    const summary: MeetingSummary = { version: 1, meetingId: 'm1', createdAt: '2026-11-16T16:00:00.000Z', model: 'claude-cli:haiku', overview: 'Ok.', decisions: [], tasks: [] }
    const markdown = summaryMarkdown(meeting, summary, [analysis('a1')])
    expect(markdown.indexOf('## Tarefas')).toBeLessThan(markdown.indexOf('## Perguntas em aberto'))
    expect(markdown.indexOf('## Perguntas em aberto')).toBeLessThan(markdown.indexOf('_Gerado pelo Claude'))
    expect(summaryMarkdown(meeting, summary)).not.toContain('Perguntas em aberto')
  })

  it('o resumo recebe as perguntas em aberto da última análise, sem as respondidas, como material', () => {
    const older = analysis('a1', { createdAt: '2026-11-16T15:00:00.000Z' })
    const latest = analysis('a2', { createdAt: '2026-11-16T15:10:00.000Z', answered: [] })
    const answeredLater = analysis('a3', { createdAt: '2026-11-16T15:20:00.000Z', openQuestions: [], unclearTopics: [], toConfirm: [], suggestedQuestions: [], answered: [] })
    expect(openQuestionLines([older, latest])).toEqual([
      'Pergunta em aberto: Quem aprova o orçamento?',
      'Não ficou claro: Janela da migração — Mudou sem conclusão.',
      'Para confirmar: Data exata da janela (Participante A)',
    ])
    const marked = analysis('a2', { createdAt: '2026-11-16T15:10:00.000Z', answered: [{ analysisId: 'a2', section: 'openQuestions', index: 0 }] })
    expect(openQuestionLines([marked])).not.toContain('Pergunta em aberto: Quem aprova o orçamento?')
    expect(openQuestionLines([older, answeredLater])).toEqual([])
    expect(openQuestionLines([])).toEqual([])
    const input = summaryInput(['[00:01] Você: Oi.'], [], ['Pergunta em aberto: A < B?'])
    expect(input).toBe('Resuma esta reunião.\n\n<transcricao>\n[00:01] Você: Oi.\n</transcricao>\n<perguntas_em_aberto>\nPergunta em aberto: A &lt; B?\n</perguntas_em_aberto>\n')
    expect(summarySystemPrompt()).toContain('apenas o que continuou sem resposta até o fim da reunião')
    expect(summarySystemPrompt()).toContain('Nunca copie a lista')
  })
})
