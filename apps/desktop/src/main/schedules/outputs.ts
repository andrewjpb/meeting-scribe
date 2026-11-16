// Saídas de uma execução (contrato 23, CA6): todas dentro deste Mac. `chat` cria uma conversa nova no
// "Perguntar" (16) com o pedido e a resposta, com o título "Tarefa: <nome>"; `note` acrescenta um post-it (13)
// à reunião alvo; `file` escreve `<pasta das reuniões>/Agentes/<tarefa>/<AAAA-MM-DD HHhMM>.md` com as regras de
// caminho do contrato 07 (nome limpo, nunca fora da pasta, nunca por cima de outro arquivo); `notification`
// fica com o serviço, que mostra a notificação. Nenhuma saída envia nada a ninguém. Sem Electron.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AGENTS_FOLDER_NAME, runFileStamp, type Agent, type AgentOutput } from '../../shared/automations'
import { chatTitle, type Chat, type ChatMessage, type ChatScope } from '../../shared/chat'
import { NOTE_TEXT_MAX, type MeetingNote } from '../../shared/meeting-notes'
import { cleanFileTitle, insideFolder, uniqueBase } from '../audio-files/names'
import type { ChatStore } from '../chat/store'
import type { MeetingsStore } from '../meetings/store'
import type { NotesStore } from '../meetings/notes'
import { isChatModel } from './runner'

export interface OutputDeps {
  chats: Pick<ChatStore, 'save'>
  notes: Pick<NotesStore, 'append'>
  meetings: Pick<MeetingsStore, 'get'>
  /** Pasta dos arquivos das reuniões (contrato 07). */
  meetingsFolder: () => Promise<string>
  /** Post-it novo: o acervo do chat e o detalhe aberto acompanham (o id protege o post-it do próximo `save` da tela). */
  onNoteSaved?: (meetingId: string, noteId: string) => void
  /** Conversa nova: a lista do "Perguntar" acompanha. */
  onChatSaved?: (chat: Chat) => void
  now?: () => number
  newId?: () => string
}

export interface OutputRequest {
  output: AgentOutput
  /** "Tarefa: <nome>" (tarefa) ou o nome do agente ("Pedir agora"). */
  title: string
  /** Nome da pasta do arquivo: a tarefa ou o agente. */
  folderName: string
  agent: Pick<Agent, 'name' | 'color' | 'scope' | 'model' | 'thinkMore'>
  prompt: string
  answer: ChatMessage
  /** Reunião que acabou (depois de cada reunião). */
  meetingId: string | null
}

const two = (value: number): string => String(value).padStart(2, '0')

/** Aplica a saída; devolve a frase do que foi feito (ou lança com o motivo). */
export async function applyOutput(deps: OutputDeps, request: OutputRequest): Promise<string> {
  const now = deps.now ?? Date.now
  const newId = deps.newId ?? randomUUID
  const at = new Date(now())
  const iso = at.toISOString()
  const { output, answer } = request

  if (output.kind === 'notification') return 'Notificação do macOS'

  if (output.kind === 'chat') {
    const scope: ChatScope =
      request.agent.scope.kind === 'none' ? { kind: 'all' } : request.agent.scope.kind === 'meetings' ? { kind: 'meetings', meetingIds: request.agent.scope.meetingIds ?? [] } : { kind: request.agent.scope.kind }
    const chat: Chat = {
      id: newId(),
      meetingId: null,
      title: chatTitle(request.title),
      createdAt: iso,
      messages: [{ role: 'user', text: request.prompt, at: answer.at }, answer],
      scope,
      model: isChatModel(request.agent.model) ? request.agent.model : null,
      thinkMore: request.agent.thinkMore,
    }
    const saved = await deps.chats.save(chat)
    deps.onChatSaved?.(saved)
    return 'Conversa criada em Perguntar'
  }

  if (output.kind === 'note') {
    const meetingId = request.meetingId ?? output.meetingId ?? null
    if (!meetingId) throw new Error('nenhuma reunião escolhida para o post-it')
    if (!(await deps.meetings.get(meetingId))) throw new Error('a reunião do post-it não existe mais')
    const text = `${request.title}\n${answer.text}`.slice(0, NOTE_TEXT_MAX)
    const note: MeetingNote = { id: newId(), text, color: request.agent.color, atMs: null, createdAt: iso, updatedAt: iso }
    // Acrescentado na fila do arquivo: o que a tela gravou no meio fica.
    if (!(await deps.notes.append(meetingId, note))) throw new Error('a reunião já tem o máximo de anotações')
    deps.onNoteSaved?.(meetingId, note.id)
    return 'Post-it na reunião'
  }

  // Arquivo: <pasta>/Agentes/<tarefa>/<AAAA-MM-DD HHhMM>.md, sem sobrescrever (o segundo ganha " (2)").
  const root = await deps.meetingsFolder()
  const agentsDir = insideFolder(root, AGENTS_FOLDER_NAME)
  const folderName = cleanFileTitle(request.folderName)
  const dir = insideFolder(agentsDir, folderName)
  await mkdir(dir, { recursive: true })
  const base = uniqueBase(runFileStamp(at), (candidate) => existsSync(insideFolder(dir, `${candidate}.md`)))
  const file = insideFolder(dir, `${base}.md`)
  const when = `${two(at.getDate())}/${two(at.getMonth() + 1)}/${at.getFullYear()} ${two(at.getHours())}:${two(at.getMinutes())}`
  const body = [`# ${request.title}`, '', `- Agente: ${request.agent.name}`, `- Executada em: ${when}`, '', answer.text.trim(), ''].join('\n')
  await writeFile(file, body, { encoding: 'utf8', flag: 'wx' })
  return `Arquivo ${join(AGENTS_FOLDER_NAME, folderName, `${base}.md`)}`
}
