// Anotações da aba "Anotações" do detalhe (contrato 13, CA5), por reunião, fora do componente: trocar de
// aba ou sair do detalhe não perde a edição que esperava os 500 ms nem o "Desfazer". Uma gravação por vez
// por reunião, sempre a lista inteira mais recente; a versão só conta como salva depois de o main
// responder. Falhou: tenta de novo uma vez; falhou de novo, `saveFailed` liga o aviso do detalhe (visível
// em qualquer aba) com "Tentar de novo".
import { create } from 'zustand'
import type { MeetingNote, NoteColor, NotePosition } from '@shared/meeting-notes'
import { addNote, createNote, editNote, moveNote, NOTE_SAVE_DELAY_MS, NOTE_UNDO_MS, noteWithText, removeNote, reopenNote, resolveNote, restoreNote, type NotePatch, type RemovedNote } from '../notes/noteList'
import { rereadWhenUnlocked } from '../../app/lockStore'

export interface MeetingNotesEntry {
  status: 'loading' | 'ready' | 'failed'
  notes: MeetingNote[]
  /** Versão da lista na tela e a última que o main confirmou: diferentes = há o que salvar. */
  version: number
  savedVersion: number
  saving: boolean
  saveFailed: boolean
  /** Card criado agora, que abre com o cursor no texto (limpo depois do foco). */
  focusId: string | null
  /** Última anotação excluída, por 5 s. */
  undo: RemovedNote | null
}

interface MeetingNotesState {
  meetings: Record<string, MeetingNotesEntry>
  /** Lê do main ao abrir a aba. Com edição ainda não salva, fica a da memória. */
  load: (meetingId: string) => Promise<void>
  create: (meetingId: string) => void
  /** "Virar anotação" de um item da análise (contrato 19): card amarelo com o texto e o tempo, salvo já. */
  createWithText: (meetingId: string, text: string, atMs: number | null) => Promise<void>
  change: (meetingId: string, id: string, patch: NotePatch & { color?: NoteColor }) => void
  /** "Concluir" no detalhe (contrato 30): resolvida pela pessoa, sem tempo de gravação; salva já. */
  resolve: (meetingId: string, id: string, reason: string) => void
  /** "Reabrir"; salva já. */
  reopen: (meetingId: string, id: string) => void
  /** Soltar o card no quadro: a posição nova, salva já. */
  move: (meetingId: string, id: string, position: NotePosition) => void
  remove: (meetingId: string, id: string) => void
  undo: (meetingId: string) => void
  clearFocus: (meetingId: string) => void
  /** Salva agora o que estiver pendente; termina quando não houver mais nada a gravar (ou falhar). */
  flush: (meetingId: string) => Promise<void>
  /** Reunião excluída: esquece pendências, timers e o aviso. */
  forget: (meetingId: string) => void
}

export const isDirty = (entry: Pick<MeetingNotesEntry, 'version' | 'savedVersion'>): boolean => entry.version !== entry.savedVersion

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
const undoTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Gravação em curso de cada reunião, para o `flush` de quem chega depois esperar a vez. */
const inFlight = new Map<string, Promise<void>>()

const clearTimer = (timers: Map<string, ReturnType<typeof setTimeout>>, meetingId: string): void => {
  const timer = timers.get(meetingId)
  if (timer) clearTimeout(timer)
  timers.delete(meetingId)
}

const empty = (): MeetingNotesEntry => ({ status: 'loading', notes: [], version: 0, savedVersion: 0, saving: false, saveFailed: false, focusId: null, undo: null })

let listening = false

export const useMeetingNotes = create<MeetingNotesState>()((set, get) => {
  /** Contrato 23: um agente acrescentou um post-it; a reunião aberta relê (com edição pendente, o main guarda o dele). */
  const listen = (): void => {
    if (listening) return
    listening = true
    window.__scribeApi.on('scribe:notes-changed', ({ meetingId }) => {
      if (get().meetings[meetingId]) void get().load(meetingId)
    })
  }

  const patchEntry = (meetingId: string, patch: Partial<MeetingNotesEntry> | ((entry: MeetingNotesEntry) => Partial<MeetingNotesEntry>)): void =>
    set((state) => {
      const entry = state.meetings[meetingId]
      if (!entry) return state
      return { meetings: { ...state.meetings, [meetingId]: { ...entry, ...(typeof patch === 'function' ? patch(entry) : patch) } } }
    })

  /** Lista nova na tela: salva já (`now`) ou 500 ms depois da última mudança. */
  const update = (meetingId: string, notes: MeetingNote[], when: 'now' | 'later', extra: Partial<MeetingNotesEntry> = {}): void => {
    patchEntry(meetingId, (entry) => ({ notes, version: entry.version + 1, ...extra }))
    clearTimer(saveTimers, meetingId)
    if (when === 'now') void get().flush(meetingId)
    else saveTimers.set(meetingId, setTimeout(() => void get().flush(meetingId), NOTE_SAVE_DELAY_MS))
  }

  /** Uma gravação: a lista daquele instante, com uma nova tentativa se o canal falhar. */
  async function save(meetingId: string): Promise<void> {
    const entry = get().meetings[meetingId]
    if (!entry || !isDirty(entry)) return
    const { version, notes } = entry
    patchEntry(meetingId, { saving: true })
    let result: boolean | null = null
    for (let attempt = 0; attempt < 2 && result === null; attempt++) {
      try {
        result = await window.__scribeApi.invoke('scribe:notes-save', { meetingId, notes })
      } catch {
        result = null
      }
    }
    if (result === null) {
      patchEntry(meetingId, { saving: false, saveFailed: true })
      return
    }
    // `false`: a reunião não existe mais; não há onde salvar nem o que avisar.
    patchEntry(meetingId, (current) => ({ saving: false, saveFailed: false, savedVersion: Math.max(current.savedVersion, version) }))
  }

  return {
    meetings: {},

    async load(meetingId) {
      listen()
      const current = get().meetings[meetingId]
      if (current && (isDirty(current) || current.saving)) return
      if (!current) set((state) => ({ meetings: { ...state.meetings, [meetingId]: empty() } }))
      try {
        const notes = await window.__scribeApi.invoke('scribe:notes-get', { meetingId })
        const now = get().meetings[meetingId]
        // Editou enquanto a leitura voltava: vale a edição.
        if (now && !isDirty(now)) patchEntry(meetingId, { status: 'ready', notes })
      } catch (error) {
        // Recusada com o app bloqueado (contrato 22): fica carregando e relê no desbloqueio.
        if (rereadWhenUnlocked(error, () => void get().load(meetingId))) return
        if (get().meetings[meetingId]?.status === 'loading') patchEntry(meetingId, { status: 'failed' })
      }
    },

    create(meetingId) {
      const entry = get().meetings[meetingId]
      if (entry?.status !== 'ready') return
      const note = createNote(null, Date.now())
      const notes = addNote(entry.notes, note)
      if (notes.length !== entry.notes.length) update(meetingId, notes, 'now', { focusId: note.id })
    },

    async createWithText(meetingId, text, atMs) {
      if (get().meetings[meetingId]?.status !== 'ready') await get().load(meetingId)
      const entry = get().meetings[meetingId]
      if (entry?.status !== 'ready' || !text.trim()) return
      const notes = addNote(entry.notes, noteWithText(text, atMs, Date.now()))
      if (notes.length !== entry.notes.length) update(meetingId, notes, 'now')
    },

    change(meetingId, id, patch) {
      const entry = get().meetings[meetingId]
      if (!entry) return
      const notes = editNote(entry.notes, id, patch, Date.now())
      if (notes !== entry.notes) update(meetingId, notes, patch.color !== undefined ? 'now' : 'later')
    },

    resolve(meetingId, id, reason) {
      const entry = get().meetings[meetingId]
      if (!entry) return
      const notes = resolveNote(entry.notes, id, { reason, by: 'manual', atMs: null }, Date.now())
      if (notes !== entry.notes) update(meetingId, notes, 'now')
    },

    reopen(meetingId, id) {
      const entry = get().meetings[meetingId]
      if (!entry) return
      const notes = reopenNote(entry.notes, id, Date.now())
      if (notes !== entry.notes) update(meetingId, notes, 'now')
    },

    move(meetingId, id, position) {
      const entry = get().meetings[meetingId]
      if (!entry) return
      const notes = moveNote(entry.notes, id, position, Date.now())
      if (notes !== entry.notes) update(meetingId, notes, 'now')
    },

    remove(meetingId, id) {
      const entry = get().meetings[meetingId]
      if (!entry) return
      const { list, removed } = removeNote(entry.notes, id)
      if (!removed) return
      clearTimer(undoTimers, meetingId)
      undoTimers.set(
        meetingId,
        setTimeout(() => {
          undoTimers.delete(meetingId)
          patchEntry(meetingId, (current) => (current.undo === removed ? { undo: null } : {}))
        }, NOTE_UNDO_MS),
      )
      update(meetingId, list, 'now', { undo: removed })
    },

    undo(meetingId) {
      const entry = get().meetings[meetingId]
      if (!entry?.undo) return
      clearTimer(undoTimers, meetingId)
      update(meetingId, restoreNote(entry.notes, entry.undo), 'now', { undo: null })
    },

    clearFocus(meetingId) {
      if (get().meetings[meetingId]?.focusId) patchEntry(meetingId, { focusId: null })
    },

    async flush(meetingId) {
      clearTimer(saveTimers, meetingId)
      // Cada chamada (edição, sair do card, "Tentar de novo") é uma tentativa nova.
      patchEntry(meetingId, (entry) => (entry.saveFailed ? { saveFailed: false } : {}))
      // Uma gravação por vez; quem chega depois espera a vez e grava a lista mais nova.
      for (;;) {
        const running = inFlight.get(meetingId)
        if (running) {
          await running
          continue
        }
        const entry = get().meetings[meetingId]
        if (!entry || !isDirty(entry) || entry.saveFailed) return
        const run = save(meetingId).finally(() => inFlight.delete(meetingId))
        inFlight.set(meetingId, run)
        await run
      }
    },

    forget(meetingId) {
      clearTimer(saveTimers, meetingId)
      clearTimer(undoTimers, meetingId)
      set((state) => ({ meetings: Object.fromEntries(Object.entries(state.meetings).filter(([id]) => id !== meetingId)) }))
    },
  }
})
