// Acervo do chat (contrato 15, CA1): `userData/chat-corpus/` com um `.md` por reunião e o `INDICE.md`. É a
// pasta onde o `claude` do chat roda, só com ferramentas de leitura: em vez de colar as reuniões no pedido,
// ele lê o índice e abre o que precisa. Atualizado ao salvar, renomear ou excluir a reunião e ao mudar o
// resumo ou as anotações; reconstruído inteiro quando a pasta ou o índice somem. Pasta 0700, arquivos 0600,
// gravação atômica (temporário + `rename`) numa fila, como os outros stores. Nada daqui vai para log.
//
// Contrato 16: a conversa da tela "Perguntar" com escopo menor que "Todas as reuniões" (últimos 7 ou 30 dias,
// ou as reuniões escolhidas) roda em `userData/chat-scope/<id da conversa>/`, só com os `.md` do escopo e um
// `INDICE.md` deles, com as mesmas permissões e a mesma limpeza das pastas da conversa de uma reunião.
import { randomUUID } from 'node:crypto'
import { chmod, copyFile, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHAT_SCOPE_MEETINGS_MAX, MEETING_LINK_SCHEME, type ChatScope } from '../../shared/chat'
import { notesInOrder, type MeetingNote } from '../../shared/meeting-notes'
import { escapeHeadings, taskLine, type MeetingSummary } from '../../shared/meeting-summary'
import type { Meeting } from '../../shared/meetings'
import { firstSentence } from '../../shared/meetings-overview'
import { WHATSAPP_EXPORT_PREFIX } from '../../shared/whatsapp'
import { durationLabel } from '../../shared/transcript-markdown'
import { formatClock, type TranscriptDocument } from '../../shared/transcription'
import { cleanFileTitle } from '../audio-files/names'
import { summaryLines } from '../claude-cli/summary'
import type { NotesStore } from '../meetings/notes'
import type { MeetingsStore } from '../meetings/store'
import type { SummaryStore } from '../meetings/summaries'
import type { TranscriptStore } from '../meetings/transcripts'

export const CHAT_CORPUS_DIR = 'chat-corpus'
export const CHAT_INDEX_FILE = 'INDICE.md'
/** Pastas temporárias das conversas de uma reunião: `userData/chat-scope/<id da conversa>/`. */
export const CHAT_SCOPE_DIR = 'chat-scope'

const two = (value: number): string => String(value).padStart(2, '0')
const dateLabel = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Final do nome do arquivo de uma reunião: ` - <id inteiro>.md`. O id inteiro (e não os 8 primeiros
 * caracteres) evita que duas reuniões com o mesmo começo de id apaguem o arquivo uma da outra.
 */
export function corpusFileSuffix(id: string): string {
  return ` - ${id.replace(/[^\w-]/g, '') || 'reuniao'}.md`
}

/** `2026-11-15 14h05 - Planejamento - <id>.md`, na hora local de início. */
export function corpusFileName(meeting: Pick<Meeting, 'id' | 'title' | 'startedAt'>): string {
  const started = new Date(meeting.startedAt)
  const date = `${started.getFullYear()}-${two(started.getMonth() + 1)}-${two(started.getDate())}`
  const time = `${two(started.getHours())}h${two(started.getMinutes())}`
  return `${date} ${time} - ${cleanFileTitle(meeting.title)}${corpusFileSuffix(meeting.id)}`
}

/** Título numa linha só e sem abrir seção falsa. */
const oneLine = (text: string): string => escapeHeadings(text.replace(/\s+/g, ' ').trim())

export interface CorpusMeeting {
  meeting: Meeting
  transcript: TranscriptDocument | null
  summary: MeetingSummary | null
  notes: readonly MeetingNote[]
}

/**
 * `.md` de uma reunião: título, id e link para citar, data, duração, participantes da agenda (se houver),
 * resumo, decisões, tarefas, anotações e a transcrição em `[mm:ss] Rótulo: texto`. O trecho marcado como
 * eco nunca chega ao arquivo da transcrição (contrato 06), então não há o que tirar aqui.
 */
export function meetingCorpusMarkdown({ meeting, transcript, summary, notes }: CorpusMeeting): string {
  const started = new Date(meeting.startedAt)
  const lines: string[] = [
    `# ${oneLine(meeting.title)}`,
    '',
    `- Id: ${meeting.id}`,
    `- Link para citar: ${MEETING_LINK_SCHEME}${meeting.id}`,
    `- Data: ${dateLabel.format(started)}, ${two(started.getHours())}:${two(started.getMinutes())} (${two(started.getDate())}/${two(started.getMonth() + 1)})`,
    `- Duração: ${durationLabel(meeting.durationMs)}`,
  ]
  const attendees = meeting.calendar?.attendees ?? []
  if (attendees.length) {
    const names = attendees.map((person) => oneLine(person.name && person.email ? `${person.name} <${person.email}>` : person.name || person.email)).filter(Boolean)
    lines.push(`- Participantes da agenda: ${names.join(', ')}`)
  }
  lines.push('', '## Resumo', '', summary ? escapeHeadings(summary.overview.trim()) : 'Sem resumo.')
  lines.push('', '## Decisões', '')
  if (summary?.decisions.length) lines.push(...summary.decisions.map((decision) => `- ${oneLine(decision)}`))
  else lines.push('Nenhuma decisão registrada.')
  lines.push('', '## Tarefas', '')
  if (summary?.tasks.length) lines.push(...summary.tasks.map(taskLine))
  else lines.push('Nenhuma tarefa registrada.')
  const ordered = notesInOrder(notes)
  lines.push('', '## Anotações', '')
  if (ordered.length) lines.push(...ordered.map((note) => `- [${note.atMs === null ? 'depois' : formatClock(note.atMs)}] ${oneLine(note.text)}`))
  else lines.push('Nenhuma anotação.')
  const speech = transcript ? summaryLines(transcript).map(escapeHeadings) : []
  lines.push('', '## Transcrição', '')
  if (speech.length) lines.push(...speech)
  else lines.push('Sem transcrição.')
  return `${lines.join('\n')}\n`
}

/** Uma linha do índice: data, título, primeira frase do resumo, arquivo e link da reunião. */
export function corpusIndexLine(meeting: Meeting, summary: MeetingSummary | null): string {
  const started = new Date(meeting.startedAt)
  const date = `${two(started.getDate())}/${two(started.getMonth() + 1)}/${started.getFullYear()} ${two(started.getHours())}:${two(started.getMinutes())}`
  const overview = summary ? oneLine(firstSentence(summary.overview)) : 'Sem resumo.'
  return `- ${date} · ${oneLine(meeting.title)} · ${overview} · arquivo: ${corpusFileName(meeting)} · ${MEETING_LINK_SCHEME}${meeting.id}`
}

/** `INDICE.md`: uma linha por reunião, da mais recente para a mais antiga; no fim, as conversas do WhatsApp da pasta (contrato 24). */
export function corpusIndexMarkdown(entries: readonly { meeting: Meeting; summary: MeetingSummary | null }[], whatsappFiles: readonly string[] = []): string {
  const sorted = [...entries].sort((a, b) => Date.parse(b.meeting.startedAt) - Date.parse(a.meeting.startedAt))
  const lines = [
    '# Índice das reuniões',
    '',
    'Uma linha por reunião, da mais recente para a mais antiga: data e hora · título · primeira frase do resumo · arquivo · link para citar.',
    '',
    ...(sorted.length ? sorted.map(({ meeting, summary }) => corpusIndexLine(meeting, summary)) : ['Nenhuma reunião gravada.']),
    ...(whatsappFiles.length ? ['', '## Conversas do WhatsApp', '', 'Um arquivo por conversa escolhida, com as mensagens dos últimos dias.', '', ...whatsappFiles.map((file) => `- arquivo: ${file}`)] : []),
  ]
  return `${lines.join('\n')}\n`
}

const DAY_MS = 86_400_000

/**
 * Reuniões de um escopo (contrato 16, CA4): `7d` e `30d` contam do início da reunião até agora; `meetings`
 * fica com as escolhidas que ainda existem (até 50), na ordem da lista; `all` são todas.
 */
export function scopeMeetingIds(scope: ChatScope, meetings: readonly Pick<Meeting, 'id' | 'startedAt'>[], now: number): string[] {
  if (scope.kind === 'all') return meetings.map((meeting) => meeting.id)
  if (scope.kind === 'meetings') {
    const chosen = new Set((scope.meetingIds ?? []).slice(0, CHAT_SCOPE_MEETINGS_MAX))
    return meetings.filter((meeting) => chosen.has(meeting.id)).map((meeting) => meeting.id)
  }
  const since = now - (scope.kind === '7d' ? 7 : 30) * DAY_MS
  return meetings.filter((meeting) => Date.parse(meeting.startedAt) >= since).map((meeting) => meeting.id)
}

export interface ChatCorpusDeps {
  /** `userData`. */
  dir: string
  meetings: Pick<MeetingsStore, 'list' | 'get'>
  transcripts: Pick<TranscriptStore, 'get'>
  summaries: Pick<SummaryStore, 'get'>
  notes?: Pick<NotesStore, 'get'>
}

export interface ChatCorpus {
  /** `userData/chat-corpus`. */
  readonly dir: string
  /**
   * Reunião salva, renomeada ou com resumo e anotações novos: reescreve o `.md` dela, o índice e a cópia nas
   * pastas das conversas abertas dela.
   */
  sync(meetingId: string): Promise<void>
  /** Reunião excluída: apaga o `.md` dela e reescreve o índice. */
  remove(meetingId: string): Promise<void>
  /** Apaga tudo e escreve de novo, a partir do disco. */
  rebuild(): Promise<void>
  /** Antes de abrir o chat: reconstrói se a pasta ou o índice faltarem. */
  ensure(): Promise<void>
  /**
   * Pasta temporária `userData/chat-scope/<chave>/` só com o `.md` da reunião, para o chat dela. `null` se a
   * reunião não existe.
   */
  scope(meetingId: string, key: string): Promise<string | null>
  /**
   * Pasta temporária `userData/chat-scope/<chave>/` com os `.md` das reuniões dadas e um `INDICE.md` só
   * delas (contrato 16). Reunião que não existe fica de fora.
   */
  scopeMany(meetingIds: readonly string[], key: string): Promise<string | null>
  /** Reescreve o `INDICE.md` de uma pasta de escopo (as conversas do WhatsApp entraram nela; contrato 24). */
  reindexScope(key: string): Promise<void>
  /** Apaga a pasta temporária de uma conversa. */
  dropScope(key: string): Promise<void>
  /** Ao abrir o app: apaga as pastas temporárias que sobraram. */
  clearScopes(): Promise<void>
}

const safeKey = (key: string): string | null => (/^[\w-]{1,100}$/.test(key) ? key : null)

export function createChatCorpus(deps: ChatCorpusDeps): ChatCorpus {
  const dir = join(deps.dir, CHAT_CORPUS_DIR)
  const scopes = join(deps.dir, CHAT_SCOPE_DIR)
  let queue: Promise<unknown> = Promise.resolve()

  const serial = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true, mode: 0o700 })
    // A pasta que já existia com outra permissão também fica só para o dono.
    await chmod(path, 0o700)
  }

  async function writeAtomic(file: string, content: string): Promise<void> {
    const temp = `${file}.tmp-${process.pid}-${randomUUID()}`
    await writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
    await rename(temp, file)
  }

  async function load(meeting: Meeting): Promise<CorpusMeeting> {
    const [transcript, summary, notes] = await Promise.all([
      deps.transcripts.get(meeting.id).catch(() => null),
      deps.summaries.get(meeting.id).catch(() => null),
      deps.notes ? deps.notes.get(meeting.id).catch(() => []) : Promise.resolve([]),
    ])
    return { meeting, transcript, summary, notes }
  }

  async function files(): Promise<string[]> {
    try {
      return (await readdir(dir)).filter((name) => name.endsWith('.md') && name !== CHAT_INDEX_FILE)
    } catch {
      return []
    }
  }

  /** Apaga os `.md` da reunião com outro nome (título ou data mudou). */
  async function dropOld(meetingId: string, keep: string | null): Promise<void> {
    const suffix = corpusFileSuffix(meetingId)
    for (const name of await files()) if (name.endsWith(suffix) && name !== keep) await rm(join(dir, name), { force: true })
  }

  /** Índice de uma pasta de escopo: as reuniões cujos `.md` estão nela. */
  async function writeScopeIndex(target: string, ids: readonly string[]): Promise<void> {
    const wanted = new Set(ids)
    const meetings = (await deps.meetings.list()).filter((meeting) => wanted.has(meeting.id))
    const entries = await Promise.all(meetings.map(async (meeting) => ({ meeting, summary: await deps.summaries.get(meeting.id).catch(() => null) })))
    const file = join(target, CHAT_INDEX_FILE)
    const whatsappFiles = (await readdir(target).catch(() => [] as string[])).filter((name) => name.startsWith(WHATSAPP_EXPORT_PREFIX) && name.endsWith('.md')).sort()
    await writeAtomic(file, corpusIndexMarkdown(entries, whatsappFiles))
    await chmod(file, 0o600)
  }

  /** Ids das reuniões cujos `.md` estão numa pasta. */
  const idsIn = (names: readonly string[]): string[] =>
    names.flatMap((file) => {
      const id = file !== CHAT_INDEX_FILE ? /^.* - ([\w-]{1,200})\.md$/.exec(file)?.[1] : undefined
      return id ? [id] : []
    })

  /**
   * Pastas de conversa abertas com esta reunião: a cópia do `.md` é trocada pela atual (ou apagada, com
   * `meeting` nulo) e o `INDICE.md` delas, quando há, é reescrito.
   */
  async function refreshScopes(meetingId: string, meeting: Meeting | null): Promise<void> {
    let folders: string[]
    try {
      folders = await readdir(scopes)
    } catch {
      return
    }
    const suffix = corpusFileSuffix(meetingId)
    const name = meeting ? corpusFileName(meeting) : null
    for (const folder of folders) {
      const target = join(scopes, folder)
      let names: string[]
      try {
        names = await readdir(target)
      } catch {
        continue
      }
      if (!names.some((file) => file.endsWith(suffix))) continue
      if (name) {
        await copyFile(join(dir, name), join(target, name))
        await chmod(join(target, name), 0o600)
      }
      for (const file of names) if (file.endsWith(suffix) && file !== name) await rm(join(target, file), { force: true })
      if (names.includes(CHAT_INDEX_FILE)) await writeScopeIndex(target, idsIn(await readdir(target)))
    }
  }

  async function writeMeeting(meeting: Meeting): Promise<void> {
    const name = corpusFileName(meeting)
    await writeAtomic(join(dir, name), meetingCorpusMarkdown(await load(meeting)))
    await dropOld(meeting.id, name)
  }

  async function writeIndex(): Promise<void> {
    const meetings = await deps.meetings.list()
    const entries = await Promise.all(meetings.map(async (meeting) => ({ meeting, summary: await deps.summaries.get(meeting.id).catch(() => null) })))
    await writeAtomic(join(dir, CHAT_INDEX_FILE), corpusIndexMarkdown(entries))
  }

  async function rebuildNow(): Promise<void> {
    await ensureDir(dir)
    const meetings = await deps.meetings.list()
    const expected = new Set(meetings.map(corpusFileName))
    for (const name of await readdir(dir)) if (name !== CHAT_INDEX_FILE && !expected.has(name)) await rm(join(dir, name), { force: true, recursive: true })
    for (const meeting of meetings) await writeMeeting(meeting)
    await writeIndex()
  }

  async function exists(path: string): Promise<boolean> {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  return {
    dir,

    sync: (meetingId) =>
      serial(async () => {
        const meeting = await deps.meetings.get(meetingId)
        // Sem o índice, a pasta inteira é refeita (inclui esta reunião).
        if (!(await exists(join(dir, CHAT_INDEX_FILE)))) await rebuildNow()
        else {
          await ensureDir(dir)
          if (meeting) await writeMeeting(meeting)
          else await dropOld(meetingId, null)
          await writeIndex()
        }
        await refreshScopes(meetingId, meeting)
      }),

    remove: (meetingId) =>
      serial(async () => {
        await refreshScopes(meetingId, null)
        if (!(await exists(dir))) return
        await dropOld(meetingId, null)
        await writeIndex()
      }),

    rebuild: () => serial(rebuildNow),

    ensure: () =>
      serial(async () => {
        if (!(await exists(join(dir, CHAT_INDEX_FILE)))) await rebuildNow()
      }),

    scope: (meetingId, key) =>
      serial(async () => {
        const folder = safeKey(key)
        if (!folder) return null
        const meeting = await deps.meetings.get(meetingId)
        if (!meeting) return null
        await ensureDir(dir)
        await writeMeeting(meeting)
        const target = join(scopes, folder)
        await ensureDir(scopes)
        await rm(target, { recursive: true, force: true })
        await ensureDir(target)
        const name = corpusFileName(meeting)
        await copyFile(join(dir, name), join(target, name))
        await chmod(join(target, name), 0o600)
        return target
      }),

    scopeMany: (meetingIds, key) =>
      serial(async () => {
        const folder = safeKey(key)
        if (!folder) return null
        const wanted = new Set(meetingIds)
        const meetings = (await deps.meetings.list()).filter((meeting) => wanted.has(meeting.id))
        await ensureDir(dir)
        const target = join(scopes, folder)
        await ensureDir(scopes)
        await rm(target, { recursive: true, force: true })
        await ensureDir(target)
        for (const meeting of meetings) {
          const name = corpusFileName(meeting)
          // O `.md` do acervo é a fonte; faltando (acervo antigo), é escrito agora.
          if (!(await exists(join(dir, name)))) await writeMeeting(meeting)
          await copyFile(join(dir, name), join(target, name))
          await chmod(join(target, name), 0o600)
        }
        await writeScopeIndex(target, meetings.map((meeting) => meeting.id))
        return target
      }),

    reindexScope: (key) =>
      serial(async () => {
        const folder = safeKey(key)
        if (!folder) return
        const target = join(scopes, folder)
        if (!(await exists(target))) return
        await writeScopeIndex(target, idsIn(await readdir(target)))
      }),

    // Na fila: a pasta apagada ao fechar uma conversa nunca some depois de a próxima pergunta montá-la de novo.
    dropScope: (key) =>
      serial(async () => {
        const folder = safeKey(key)
        if (folder) await rm(join(scopes, folder), { recursive: true, force: true })
      }),

    clearScopes: () => rm(scopes, { recursive: true, force: true }),
  }
}
