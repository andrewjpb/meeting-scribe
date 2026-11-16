// Contrato 10: a lista com a prévia do resumo numa chamada só (CA1) e a busca no main (CA4): acentos,
// maiúsculas, transcrição grande, termo curto, trecho em volta da ocorrência e o desempenho com 300
// reuniões de 1 h. Arquivos de verdade numa pasta temporária, com os mesmos stores do app.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMeetingsIndex, foldText, searchWords, snippetAround, type MeetingsIndex, type SummaryActivity } from '../src/main/meetings/overview'
import { createFileMeetingsStore, MEETINGS_FILE } from '../src/main/meetings/store'
import { createFileSummaryStore, summaryPath, type SummaryStore } from '../src/main/meetings/summaries'
import { createFileTranscriptStore, type TranscriptStore } from '../src/main/meetings/transcripts'
import type { MeetingSummary, SummaryStatus } from '../src/shared/meeting-summary'
import type { Meeting } from '../src/shared/meetings'
import { clipAtWord, firstSentence, SEARCH_SNIPPET_MAX, summaryPreview, SUMMARY_PREVIEW_MAX, withSummaryStatus, type MeetingOverview, type SnippetPart } from '../src/shared/meetings-overview'
import { TRANSCRIPT_VERSION, type TranscriptDocument } from '../src/shared/transcription'

const meeting = (id: string, title: string, startedAt: string, durationMs = 30 * 60_000): Meeting => ({
  id,
  title,
  startedAt,
  durationMs,
  sources: { mic: true, system: true },
  audioPath: null,
  transcriptPath: null,
})

const transcript = (meetingId: string, texts: readonly string[]): TranscriptDocument => ({
  version: TRANSCRIPT_VERSION,
  meetingId,
  sourceLanguage: 'pt',
  targetLanguage: null,
  translationModel: null,
  segments: texts.map((text, i) => ({ id: `s${i}`, source: i % 2 ? 'system' : 'mic', speaker: null, startMs: i * 10_000, endMs: i * 10_000 + 9_000, text, translation: null, translationModel: null })),
})

const summary = (meetingId: string, overview: string, extra: Partial<MeetingSummary> = {}): MeetingSummary => ({
  version: 1,
  meetingId,
  createdAt: '2026-11-15T18:00:00.000Z',
  model: 'claude-cli:haiku',
  overview,
  decisions: [],
  tasks: [],
  ...extra,
})

/** O trecho como aparece na tela, e só o que foi marcado. */
const joined = (parts: readonly SnippetPart[] | undefined): string => (parts ?? []).map((part) => part.text).join('')
const marked = (parts: readonly SnippetPart[] | undefined): string[] => (parts ?? []).filter((part) => part.mark).map((part) => part.text)

function writeMeetings(dir: string, meetings: readonly Meeting[]): void {
  writeFileSync(join(dir, MEETINGS_FILE), `${JSON.stringify({ version: 1, meetings })}\n`)
}

describe('prévia do resumo (CA1)', () => {
  it('primeira frase, até 200 caracteres, cortada em palavra com "…"', () => {
    expect(firstSentence('A equipe revisou o plano. Depois falou do prazo.')).toBe('A equipe revisou o plano.')
    expect(firstSentence('Sem ponto final')).toBe('Sem ponto final')
    expect(firstSentence('Versão 2.5 aprovada! E mais.')).toBe('Versão 2.5 aprovada!')
    const long = `${'palavra '.repeat(40)}fim.`
    const clipped = clipAtWord(long, SUMMARY_PREVIEW_MAX)
    expect(clipped.length).toBeLessThanOrEqual(SUMMARY_PREVIEW_MAX)
    expect(clipped.endsWith('palavra…')).toBe(true)
    expect(clipAtWord('a'.repeat(300), 200)).toBe(`${'a'.repeat(199)}…`)
    expect(clipAtWord('Curto, cabe.', 200)).toBe('Curto, cabe.')
    expect(clipAtWord('um dois, três quatro', 10)).toBe('um dois…')
    const preview = summaryPreview(summary('m', `Primeira frase.\nSegunda.`, { decisions: ['d1', 'd2'], tasks: [{ task: 't', owner: null, due: null }] }))
    expect(preview).toEqual({ overview: 'Primeira frase.', tasks: 1, decisions: 2 })
  })

  it('o evento do resumo atualiza a linha (CA5)', () => {
    const entry: MeetingOverview = { meeting: meeting('m', 'T', '2026-11-15T10:00:00.000Z'), summary: { overview: 'Antes.', tasks: 0, decisions: 0 }, summaryState: 'ready' }
    const ready: SummaryStatus = { state: 'ready', summary: summary('m', 'Depois. Mais.', { tasks: [{ task: 'x', owner: 'Ana', due: null }] }) }
    expect(withSummaryStatus(entry, { state: 'generating' })).toEqual({ ...entry, summaryState: 'generating' })
    expect(withSummaryStatus(entry, ready)).toEqual({ ...entry, summary: { overview: 'Depois.', tasks: 1, decisions: 0 }, summaryState: 'ready' })
    expect(withSummaryStatus(entry, { state: 'error', error: 'timeout', summary: null })).toEqual({ ...entry, summary: null, summaryState: 'error' })
    expect(withSummaryStatus(entry, { state: 'empty' })).toEqual({ ...entry, summary: null, summaryState: 'none' })
  })
})

describe('normalização e trecho (CA4)', () => {
  it('sem acento e em minúscula, com o mesmo tamanho do original', () => {
    const text = 'Ação, CORAÇÃO e Pinguim; İstanbul ﬁm 😀 Ñandú'
    const folded = foldText(text)
    expect(folded.length).toBe(text.length)
    expect(folded).toContain('acao, coracao e pinguim')
    expect(folded).toContain('nandu')
  })

  it('palavras do termo: NFC, sem acento, sem repetição, espaços múltiplos', () => {
    expect(searchWords('  Transcrição   em  TEMPO  em ')).toEqual(['transcricao', 'em', 'tempo'])
    expect(searchWords('CAFÉ'.normalize('NFD'))).toEqual(['cafe'])
  })

  it('trecho de até 120 caracteres em volta da ocorrência, cortado em palavra', () => {
    const words = Array.from({ length: 80 }, (_, i) => `palavra${i}`)
    const text = words.join(' ')
    const at = text.indexOf('palavra40')
    const snippet = snippetAround(text, at, 'palavra40'.length)
    expect(marked(snippet)).toEqual(['palavra40'])
    const shown = joined(snippet)
    expect(shown.startsWith('…palavra')).toBe(true)
    expect(shown.endsWith('…')).toBe(true)
    expect(shown.length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX)
    // Palavras inteiras nas pontas.
    expect(shown).toMatch(/^…palavra\d+ .* palavra\d+…$/)
  })

  it('no começo e no fim do texto não há reticências; quebras de linha viram espaço', () => {
    expect(snippetAround('Reunião curta\nsobre o prazo', 0, 7)).toEqual([
      { text: 'Reunião', mark: true },
      { text: ' curta sobre o prazo', mark: false },
    ])
    const text = `${'x '.repeat(100)}fim do texto`
    const shown = joined(snippetAround(text, text.indexOf('fim'), 3))
    expect(shown.endsWith('fim do texto')).toBe(true)
    expect(shown.startsWith('…')).toBe(true)
    expect(shown.length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX)
  })

  it('marca todas as palavras que caem dentro do trecho, juntando as que se sobrepõem', () => {
    const text = 'O prazo do prazo final ficou para o próximo prazo.'
    const ranges = (from: number, to: number): [number, number][] => {
      const out: [number, number][] = []
      for (let at = text.indexOf('prazo', from); at !== -1 && at < to; at = text.indexOf('prazo', at + 1)) out.push([at, at + 5], [at + 2, at + 5])
      return out
    }
    const snippet = snippetAround(text, text.indexOf('prazo'), 5, ranges)
    expect(marked(snippet)).toEqual(['prazo', 'prazo', 'prazo'])
    expect(joined(snippet)).toBe(text)
  })

  it('a borda do trecho não parte um emoji (par surrogate)', () => {
    // Janelas de tamanho par e ímpar dos dois lados: alguma borda cai no meio de um par.
    for (const max of [117, 118, 119, 120]) {
      for (const run of [57, 60, 70]) {
        const text = `${'😀'.repeat(run)}alvo${'😀'.repeat(run)}`
        const snippet = snippetAround(text, text.indexOf('alvo'), 4, undefined, max)
        const shown = joined(snippet)
        expect(shown.length).toBeLessThanOrEqual(max)
        // Nenhum surrogate solto: a string inteira é UTF-16 bem formada.
        expect(shown).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/)
        expect(marked(snippet)).toEqual(['alvo'])
      }
    }
  })
})

describe('índice da lista e da busca (CA1 e CA4)', () => {
  let dir: string
  let transcripts: TranscriptStore
  let summaries: SummaryStore
  let activity: Record<string, SummaryActivity>
  let index: MeetingsIndex
  const reads = { transcripts: 0, summaries: 0 }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meetings-overview-'))
    transcripts = createFileTranscriptStore({ dir })
    summaries = createFileSummaryStore({ dir })
    activity = {}
    reads.transcripts = 0
    reads.summaries = 0
    index = createMeetingsIndex({
      dir,
      meetings: createFileMeetingsStore({ dir }),
      transcripts: { get: (id) => (reads.transcripts++, transcripts.get(id)) },
      summaries: { get: (id) => (reads.summaries++, summaries.get(id)) },
      activity: (id) => activity[id] ?? null,
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  async function seed(): Promise<void> {
    writeMeetings(dir, [
      meeting('a', 'Planejamento da migração', '2026-11-15T12:00:00.000Z'),
      meeting('b', 'Revisão do contrato', '2026-11-14T12:00:00.000Z'),
      meeting('c', 'Visita à fábrica', '2026-11-10T12:00:00.000Z'),
    ])
    await transcripts.save(transcript('a', ['Bom dia a todos.', 'Vamos falar da TRANSCRIÇÃO em tempo real e do cronograma.']))
    await transcripts.save(transcript('b', ['O contrato precisa de revisão jurídica.']))
    await summaries.save(
      summary('a', 'A equipe revisou o plano de migração do banco. Depois falou do prazo.', {
        decisions: ['Migrar no sábado.'],
        tasks: [
          { task: 'Preparar o roteiro', owner: 'Joana Araújo', due: null },
          { task: 'Avisar o cliente', owner: null, due: null },
        ],
      }),
    )
  }

  it('uma chamada devolve cada reunião com a prévia, as contagens e o estado do resumo', async () => {
    await seed()
    activity['c'] = 'generating'
    activity['b'] = 'error'
    const list = await index.overview()
    expect(list.map((entry) => [entry.meeting.id, entry.summaryState])).toEqual([
      ['a', 'ready'],
      ['b', 'error'],
      ['c', 'generating'],
    ])
    expect(list[0]?.summary).toEqual({ overview: 'A equipe revisou o plano de migração do banco.', tasks: 2, decisions: 1 })
    expect(list[1]?.summary).toBeNull()
    expect(list[2]?.summary).toBeNull()
  })

  it('não relê o resumo que não mudou; relê quando é regravado ou apagado', async () => {
    await seed()
    await index.overview()
    const first = reads.summaries
    await index.overview()
    expect(reads.summaries).toBe(first)
    await summaries.save(summary('a', 'Outro resumo. Fim.'))
    expect((await index.overview())[0]?.summary?.overview).toBe('Outro resumo.')
    await summaries.remove('a')
    const after = await index.overview()
    expect(after[0]).toMatchObject({ summary: null, summaryState: 'none' })
  })

  it('busca sem diferenciar maiúsculas nem acentos, com onde achou e o trecho marcado', async () => {
    await seed()
    const byTitle = await index.search('MIGRACAO')
    expect(byTitle.map((r) => [r.meeting.id, r.field])).toEqual([['a', 'title']])
    expect(byTitle[0]?.snippet).toEqual([
      { text: 'Planejamento da ', mark: false },
      { text: 'migração', mark: true },
    ])

    const byTranscript = await index.search('transcricao em TEMPO')
    expect(byTranscript.map((r) => [r.meeting.id, r.field])).toEqual([['a', 'transcript']])
    expect(marked(byTranscript[0]?.snippet)).toEqual(['TRANSCRIÇÃO', 'em', 'tempo'])
    expect(byTranscript[0]?.summary?.tasks).toBe(2)

    // Responsável da tarefa está no resumo.
    const byOwner = await index.search('joana araujo')
    expect(byOwner.map((r) => [r.meeting.id, r.field])).toEqual([['a', 'summary']])
    expect(marked(byOwner[0]?.snippet)).toEqual(['Joana', 'Araújo'])

    // Título vem antes da transcrição; a ordem é a da lista.
    expect((await index.search('REVIS')).map((r) => [r.meeting.id, r.field])).toEqual([
      ['a', 'summary'],
      ['b', 'title'],
    ])
    expect(await index.search('  nada   disso  ')).toEqual([])
  })

  it('por palavras: fora de ordem, separadas, em campos diferentes; uma ausente não acha', async () => {
    await seed()
    const apart = await index.search('transcricao tempo')
    expect(apart.map((r) => r.meeting.id)).toEqual(['a'])
    expect(marked(apart[0]?.snippet)).toEqual(['TRANSCRIÇÃO', 'tempo'])
    expect((await index.search('tempo   TRANSCRICAO')).map((r) => r.meeting.id)).toEqual(['a'])
    // Pedaço de palavra acha, mas só o começo de palavra acende no trecho (a âncora sempre acende).
    const part = await index.search('ronogram')
    expect(marked(part[0]?.snippet)).toEqual(['ronogram'])
    expect(marked((await index.search('vamos em'))[0]?.snippet)).toEqual(['Vamos', 'em'])

    // "joana" só no resumo, "cronograma" só na transcrição, "planejamento" só no título.
    const spread = await index.search('cronograma joana planejamento')
    expect(spread.map((r) => r.meeting.id)).toEqual(['a'])
    // Trecho na mais rara; empate fica com a primeira do termo.
    expect(spread[0]?.field).toBe('transcript')
    expect(marked(spread[0]?.snippet)).toEqual(['cronograma'])

    expect(await index.search('joana inexistente')).toEqual([])
    expect(await index.search('contrato migracao')).toEqual([])
  })

  it('a palavra mais rara escolhe o trecho', async () => {
    writeMeetings(dir, [meeting('r', 'Reunião do prazo', '2026-11-15T12:00:00.000Z')])
    await transcripts.save(transcript('r', ['O prazo, o prazo e o prazo.', 'A multa só aparece aqui, junto do prazo.']))
    const [result] = await index.search('prazo multa')
    expect(result?.field).toBe('transcript')
    expect(joined(result?.snippet)).toContain('multa')
    expect(marked(result?.snippet)).toContain('multa')
  })

  it('texto gravado decomposto (NFD) é achado pelo termo composto e vice-versa', async () => {
    writeMeetings(dir, [meeting('n', 'Café da manhã com a diretoria'.normalize('NFD'), '2026-11-15T12:00:00.000Z')])
    await transcripts.save(transcript('n', ['Falamos da ação de março.'.normalize('NFD')]))
    const [byTitle] = await index.search('cafe')
    expect(byTitle?.field).toBe('title')
    expect(marked(byTitle?.snippet)).toEqual(['Café'])
    expect((await index.search('CAFÉ MANHÃ'.normalize('NFD'))).map((r) => r.meeting.id)).toEqual(['n'])
    const [byTranscript] = await index.search('acao de marco')
    expect(marked(byTranscript?.snippet)).toEqual(['ação', 'de', 'março'])
  })

  it('termo curto, longo ou que não é texto é recusado', async () => {
    await seed()
    await expect(index.search('a')).rejects.toThrow()
    await expect(index.search('  b  ')).rejects.toThrow()
    await expect(index.search('x'.repeat(101))).rejects.toThrow()
    await expect(index.search(42)).rejects.toThrow()
    await expect(index.search('qz')).resolves.toEqual([])
    await expect(index.search('x'.repeat(100))).resolves.toEqual([])
  })

  it('transcrição nova ou excluída entra e sai da busca', async () => {
    await seed()
    expect(await index.search('palavra nova')).toEqual([])
    await transcripts.save(transcript('c', ['Aqui aparece a palavra nova.']))
    expect((await index.search('palavra nova')).map((r) => r.meeting.id)).toEqual(['c'])
    writeMeetings(dir, [meeting('a', 'Planejamento da migração', '2026-11-15T12:00:00.000Z')])
    expect(await index.search('palavra nova')).toEqual([])
  })

  it('transcrição grande: acha a ocorrência no fim e corta o trecho', async () => {
    writeMeetings(dir, [meeting('g', 'Grande', '2026-11-15T12:00:00.000Z', 3_600_000)])
    const texts = Array.from({ length: 2_000 }, (_, i) => `Trecho número ${i} da conversa sobre o orçamento do ano que vem.`)
    texts[1_999] = 'No fim alguém disse: a decisão final é contratar a Fábrica Ágil.'
    await transcripts.save(transcript('g', texts))
    const [result] = await index.search('fabrica agil')
    expect(result?.field).toBe('transcript')
    expect(marked(result?.snippet)).toEqual(['Fábrica', 'Ágil'])
    expect(joined(result?.snippet).endsWith('Ágil.')).toBe(true)
    expect(joined(result?.snippet).length).toBeLessThanOrEqual(SEARCH_SNIPPET_MAX)
  })

  it('caminho do resumo segue a regra de id da transcrição', () => {
    expect(summaryPath(dir, '../fora')).toBeNull()
  })

  it('desempenho: 300 reuniões de 1 h em menos de 300 ms', { timeout: 120_000 }, async () => {
    const meetings: Meeting[] = []
    const day = Date.parse('2026-11-15T12:00:00.000Z')
    // Uma hora de fala: ~360 trechos de 10 s, ~9 mil palavras (~55 mil caracteres) por reunião.
    const sentence = (m: number, i: number): string =>
      `No trecho ${i} da reunião ${m} discutimos o cronograma, as pendências da equipe e o orçamento previsto para o próximo trimestre sem mudanças.`
    for (let m = 0; m < 300; m++) {
      const id = `p${m}`
      meetings.push(meeting(id, `Reunião ${m}`, new Date(day - m * 3_600_000 * 7).toISOString(), 3_600_000))
      const texts = Array.from({ length: 360 }, (_, i) => sentence(m, i))
      if (m === 299) texts[359] = 'Por fim, a palavra-chave única ficou registrada.'
      await transcripts.save(transcript(id, texts))
      if (m % 3 === 0) await summaries.save(summary(id, `Resumo da reunião ${m}. Mais texto.`, { decisions: ['Seguir.'], tasks: [{ task: 'Revisar', owner: 'Ana', due: null }] }))
    }
    writeMeetings(dir, meetings)

    // A lista aquece o índice em segundo plano, como no app.
    const overviewStart = performance.now()
    const list = await index.overview()
    const overviewMs = performance.now() - overviewStart
    expect(list).toHaveLength(300)
    const warmStart = performance.now()
    await index.warmed()
    const warmMs = performance.now() - warmStart

    const timings: number[] = []
    for (const term of ['palavra-chave unica', 'ORCAMENTO previsto', 'nada parecido com isso']) {
      const start = performance.now()
      const results = await index.search(term)
      timings.push(performance.now() - start)
      if (term.startsWith('palavra')) expect(results.map((r) => r.meeting.id)).toEqual(['p299'])
      if (term.startsWith('ORCAMENTO')) expect(results).toHaveLength(300)
    }
    console.log(`[desempenho] 300 reuniões de 1 h: lista ${overviewMs.toFixed(0)} ms, aquecimento ${warmMs.toFixed(0)} ms, buscas ${timings.map((t) => t.toFixed(0)).join(' / ')} ms`)
    for (const ms of timings) expect(ms).toBeLessThan(300)
  })
})
