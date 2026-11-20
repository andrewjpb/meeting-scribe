import { ChevronLeft, ChevronRight, Info, Plus, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
// Só do `redes-rules` (sem o zod): o `@shared/redes` monta os esquemas do zod ao carregar, e a CSP recusa o teste dele.
import { ALT_TEXT_MAX, CAROUSEL_MAX, captionStats, inferPublicationType } from '@shared/redes-rules'
import type { MediaCandidate, Publication, PublicationActionResult, PublicationMediaKind, PublicationSaveInput } from '@shared/redes'
import { MEDIA_HOST_ANCHOR, settingsPath } from '@shared/routes'
import { Button } from '../../design/Button'
import { CONTROL_CLASS, TextField } from '../../design/Field'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { MediaThumb } from './MediaThumb'
import { mediaInspection, publicationTypeLabel } from './redesFormat'
import { useRedes } from './redesStore'

/** Uma mídia no editor: a cópia salva (pelo `localPath`) ou o arquivo que o diálogo acabou de conferir. */
interface EditorMedia {
  key: string
  path: string
  fileName: string
  kind: PublicationMediaKind
  mimeType: string
  width: number
  height: number
  bytes: number
  durationSeconds: number | null
  altText: string
}

const fromPublication = (publication: Publication | null): EditorMedia[] =>
  (publication?.media ?? []).map((media) => ({ key: media.id, path: media.localPath, fileName: media.fileName, kind: media.kind, mimeType: media.mimeType, width: media.width, height: media.height, bytes: media.bytes, durationSeconds: media.durationSeconds, altText: media.altText }))

const fromCandidate = (candidate: MediaCandidate): EditorMedia => ({
  key: crypto.randomUUID(),
  path: candidate.path,
  fileName: candidate.fileName,
  kind: candidate.kind ?? 'imagem',
  mimeType: candidate.mimeType ?? '',
  width: candidate.width ?? 0,
  height: candidate.height ?? 0,
  bytes: candidate.bytes,
  durationSeconds: candidate.durationSeconds,
  altText: '',
})

const pad = (value: number): string => String(value).padStart(2, '0')
/** A hora marcada nos campos de data e hora (hora local do Mac). */
const localParts = (iso: string | null): { date: string; time: string } => {
  if (!iso) return { date: '', time: '' }
  const at = new Date(iso)
  return { date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`, time: `${pad(at.getHours())}:${pad(at.getMinutes())}` }
}
/** Os dois campos de volta em ISO; incompletos ou inválidos, `null`. */
const scheduledIso = (date: string, time: string): string | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const at = new Date(`${date}T${time}:00`)
  return Number.isNaN(at.getTime()) ? null : at.toISOString()
}

const FIELD_LABEL = 'text-13 font-medium text-text'
const STATE_TITLES: Partial<Record<Publication['state'], string>> = { agendada: 'Agendada', erro: 'Com erro' }

/**
 * O editor de publicação (contrato 72, artboards 04 e 04b): painel de 300 px à direita da fila, como o Contexto. Mídias
 * em miniaturas de 96 px (as setas ‹ › reordenam, o × tira), a inspeção da selecionada, a legenda com o contador, o texto
 * alternativo da imagem selecionada e o agendamento opcional; no pé, "Salvar rascunho", "Agendar" e "Publicar agora"
 * (estes dois pelo clique da pessoa, no preload, com a edição junto: o main salva depois de gastar o token). Imagem e
 * carrossel sem o armazenamento de mídia não publicam nem agendam (a nota diz o porquê). Esc fecha; com mudança não
 * salva, pergunta antes. Sair da tela ou da seção com mudança salva como rascunho e avisa; o editor não volta sozinho.
 */
export function PublicationEditor({ accountId, publication, notice, revision, onClose }: { accountId: string; publication: Publication | null; notice: string | null; revision: number; onClose: () => void }) {
  const storageReady = useRedes((state) => state.state?.mediaHost.configured === true)
  const navigate = useNavigate()
  const initial = localParts(publication?.scheduledAt ?? null)
  const [media, setMedia] = useState<EditorMedia[]>(() => fromPublication(publication))
  const [selected, setSelected] = useState(0)
  const [caption, setCaption] = useState(publication?.caption ?? '')
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(notice)
  const [busy, setBusy] = useState<'save' | 'schedule' | 'publish' | 'delete' | 'pick' | null>(null)
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null)
  // O relógio do "horário no futuro": relido ao mexer na data ou na hora e a cada 30 s.
  const [now, setNow] = useState(() => Date.now())
  const snapshot = (): string => JSON.stringify([media.map((item) => [item.path, item.altText]), caption, date, time])
  const [baseline] = useState(snapshot)
  const dirty = snapshot() !== baseline
  // Contrato 76: o rascunho que o Assistente criou sem mídia salva a legenda antes das imagens (publicar e agendar, não).
  const emptyDraft = publication !== null && publication.state === 'rascunho' && publication.media.length === 0
  const canSave = media.length > 0 || emptyDraft
  const panelRef = useRef<HTMLElement>(null)
  /** O editor terminou por uma ação dele (fechar, descartar, salvar, publicar, agendar, excluir): sair não salva nada. */
  const settledRef = useRef(false)

  const current = media[Math.min(selected, media.length - 1)] ?? null
  const type = media.length ? inferPublicationType(media) : null
  const typeError = type && typeof type !== 'string' ? type.error : null
  const needsStorage = media.some((item) => item.kind === 'imagem')
  const blocked = needsStorage && !storageReady
  const stats = captionStats(caption)
  const at = scheduledIso(date, time)
  const future = at !== null && Date.parse(at) > now
  const idle = busy === null

  // Aberto: o foco no primeiro passo ("Adicionar mídia" numa nova; a legenda numa que já existe).
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>(publication ? '[data-redes-caption]' : '[data-redes-media-add]')?.focus({ preventScroll: true })
    // Só ao abrir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const finish = (): void => {
    settledRef.current = true
    onClose()
  }
  /** Reabre pela publicação salva (as mídias novas viram as cópias guardadas), com um aviso se houver. */
  const reopen = (id: string, text?: string): void => {
    settledRef.current = true
    useRedes.getState().openEditor({ accountId, id, ...(text ? { notice: text } : {}) })
  }
  /** O que vai ao main: a ordem das mídias e o texto alternativo por caminho (a cópia salva ou o arquivo novo). */
  const saveInput = (): PublicationSaveInput => {
    const altTexts: Record<string, string> = {}
    for (const item of media) if (item.kind === 'imagem') altTexts[item.path] = item.altText
    return { ...(publication ? { id: publication.id } : {}), accountId, caption, mediaPaths: media.map((item) => item.path), altTexts, scheduledAt: at }
  }

  // Esc fecha; com mudança não salva, a confirmação no painel (Esc de novo continua editando).
  const escRef = useRef<() => void>(() => undefined)
  // Sair da tela (outra seção, outra conta, outra rota) sem uma ação do editor: o último estado dele, para salvar.
  const leaveRef = useRef<{ dirty: boolean; input: PublicationSaveInput; media: number; emptyDraft: boolean }>({ dirty: false, input: saveInput(), media: 0, emptyDraft: false })
  useEffect(() => {
    escRef.current = () => {
      if (confirm) setConfirm(null)
      else if (dirty) setConfirm('close')
      else finish()
    }
    leaveRef.current = { dirty, input: saveInput(), media: media.length, emptyDraft }
  })
  // A desmontagem de verdade (a do `StrictMode` remonta na hora, e o adiamento a ignora): fecha o editor no store, para
  // ele não reabrir ao voltar, e salva a mudança como rascunho, com o aviso na tela.
  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      const last = leaveRef.current
      window.setTimeout(() => {
        if (mountedRef.current || settledRef.current) return
        const store = useRedes.getState()
        if (store.editor?.revision === revision) store.openEditor(null)
        if (!last.dirty) return
        if (!last.media && !last.emptyDraft) {
          store.setNotice({ accountId, text: 'A publicação nova não foi guardada: ela ainda não tinha mídia.' })
          return
        }
        void store.savePublication(last.input).then((result) =>
          store.setNotice({ accountId, text: result.ok ? 'As mudanças da publicação que estava aberta foram salvas como rascunho.' : `As mudanças da publicação que estava aberta não foram salvas: ${result.problems.join('. ')}` }),
        )
      }, 0)
    }
  }, [accountId, revision])
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      escRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const addMedia = async (): Promise<void> => {
    if (!idle) return
    setBusy('pick')
    const picked = await useRedes.getState().pickMedia()
    setBusy(null)
    if (!picked) {
      setProblems(['Não foi possível abrir as mídias. Tente de novo.'])
      return
    }
    if (!picked.length) return
    const refused = picked.filter((item) => !item.ok).flatMap((item) => item.problems.map((problem) => `${item.fileName}: ${problem}`))
    // O mesmo arquivo duas vezes fica de fora, com o aviso (o texto alternativo é por caminho).
    const known = new Set(media.map((item) => item.path))
    const accepted: EditorMedia[] = []
    for (const candidate of picked.filter((item) => item.ok)) {
      if (known.has(candidate.path)) refused.push(`${candidate.fileName}: já está na publicação`)
      else {
        known.add(candidate.path)
        accepted.push(fromCandidate(candidate))
      }
    }
    const room = CAROUSEL_MAX - media.length
    if (accepted.length > room) refused.push(`Carrossel aceita no máximo ${CAROUSEL_MAX} imagens`)
    const added = accepted.slice(0, Math.max(0, room))
    setProblems(refused)
    if (added.length) {
      setMedia((list) => [...list, ...added])
      setSelected(media.length)
    }
  }
  const move = (index: number, by: -1 | 1): void => {
    const target = index + by
    if (target < 0 || target >= media.length) return
    setMedia((list) => {
      const next = [...list]
      const [item] = next.splice(index, 1)
      if (item) next.splice(target, 0, item)
      return next
    })
    setSelected(target)
  }
  const removeAt = (index: number): void => {
    setMedia((list) => list.filter((_, position) => position !== index))
    setSelected((value) => Math.max(0, Math.min(value, media.length - 2)))
  }

  const save = async (): Promise<void> => {
    if (!idle || !canSave) return
    setBusy('save')
    setError(null)
    const result = await useRedes.getState().savePublication(saveInput())
    setBusy(null)
    if (result.ok) reopen(result.publication.id)
    else setProblems(result.problems)
  }

  // "Agendar" e "Publicar agora": nada é esperado antes do preload (a ativação do clique dura poucos segundos). A edição
  // vai junto quando há o que salvar (nova, mudada ou com erro) e o main salva depois de gastar o token.
  const editing = publication === null || dirty || publication.state === 'erro'
  const settle = (result: PublicationActionResult): void => {
    setBusy(null)
    if (result.ok) finish()
    else if (result.problems) setProblems(result.problems)
    else if (result.saved) reopen(result.saved.id, result.error)
    else setError(result.error)
  }

  const schedule = async (): Promise<void> => {
    if (!idle || !media.length || blocked || !at || !future) return
    setBusy('schedule')
    setError(null)
    settle(await useRedes.getState().schedule(publication?.id ?? null, at, editing ? saveInput() : undefined))
  }

  const publishNow = async (): Promise<void> => {
    if (!idle || !media.length || blocked) return
    setBusy('publish')
    setError(null)
    settle(await useRedes.getState().publish(publication?.id ?? null, editing ? saveInput() : undefined))
  }

  const remove = async (): Promise<void> => {
    if (!publication || !idle) return
    setBusy('delete')
    const result = await useRedes.getState().deletePublication(publication.id)
    setBusy(null)
    if (result.ok) finish()
    else {
      setConfirm(null)
      setError(result.error)
    }
  }

  const title = (publication && STATE_TITLES[publication.state]) ?? 'Rascunho'
  return (
    <aside ref={panelRef} data-redes-editor={publication?.id ?? 'novo'} aria-label={`Editor: ${title}`} className="flex w-[300px] shrink-0 flex-col border-l border-line">
      <header className="flex h-[var(--panel-head-h)] shrink-0 items-center gap-2 border-b border-line px-4">
        <h2 className="text-15 font-bold text-title">{title}</h2>
        {type && typeof type === 'string' && (
          <span data-redes-editor-type className="rounded-[var(--radius-control)] border border-line-strong px-1.5 text-12 font-medium text-title">
            {publicationTypeLabel(type)}
          </span>
        )}
        <span className="flex-1" />
        {publication && (
          <button
            type="button"
            data-redes-editor-delete
            aria-label="Excluir a publicação"
            title="Excluir a publicação"
            onClick={() => setConfirm('delete')}
            disabled={!idle || publication.state === 'publicando'}
            className="no-drag inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-rec disabled:opacity-50"
          >
            <Icon icon={Trash2} />
          </button>
        )}
        <button
          type="button"
          data-redes-editor-close
          aria-label="Fechar o editor"
          title="Fechar o editor (Esc)"
          onClick={() => escRef.current()}
          className="no-drag inline-flex size-7 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-bg-sunken hover:text-title"
        >
          <Icon icon={X} />
        </button>
      </header>
      {confirm === 'close' && <ConfirmBar text="Descartar as mudanças que não foram salvas?" attrs={{ 'data-redes-discard-confirm': '' }} yes="Descartar" no="Continuar editando" disabled={!idle} onYes={finish} onNo={() => setConfirm(null)} />}
      {confirm === 'delete' && <ConfirmBar text="Excluir esta publicação? As cópias das mídias neste Mac saem junto." attrs={{ 'data-redes-delete-confirm': '' }} yes="Excluir" no="Cancelar" disabled={!idle} onYes={() => void remove()} onNo={() => setConfirm(null)} />}

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {blocked && (
          <div data-redes-s3-note>
            <Note
              id="redes-editor-no-storage"
              icon={Info}
              layout="stacked"
              action={
                <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => void navigate(settingsPath('contas', MEDIA_HOST_ANCHOR))}>
                  Configurar armazenamento
                </button>
              }
            >
              Imagens precisam do armazenamento de mídia configurado em Configurações › Contas. Vídeos (Reels) publicam sem ele.
            </Note>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <p className={FIELD_LABEL}>
            Mídias
            <span className="font-normal text-text-muted">
              {' '}
              · {type && typeof type === 'string' ? `${publicationTypeLabel(type)} (${media.length} de ${CAROUSEL_MAX})` : `até ${CAROUSEL_MAX}`}
            </span>
          </p>
          <ul className="flex flex-wrap gap-2">
            {media.map((item, index) => (
              <li key={item.key} data-redes-media={item.key} data-redes-media-selected={index === selected ? '' : undefined} className="group relative size-24">
                <button
                  type="button"
                  aria-label={`Mídia ${index + 1}: ${item.fileName}`}
                  aria-pressed={index === selected}
                  onClick={() => setSelected(index)}
                  className={`no-drag block size-24 rounded-[var(--radius-control)] ${index === selected ? 'outline-2 outline-offset-1 outline-accent' : ''}`}
                >
                  <MediaThumb path={item.path} kind={item.kind} size={96} />
                </button>
                <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity duration-[var(--duration-fast)] group-focus-within:opacity-100 group-hover:opacity-100">
                  <span className="flex gap-0.5">
                    <MiniButton icon={ChevronLeft} label="Mover para a esquerda" disabled={index === 0} onClick={() => move(index, -1)} />
                    <MiniButton icon={ChevronRight} label="Mover para a direita" disabled={index === media.length - 1} onClick={() => move(index, 1)} />
                  </span>
                  <MiniButton icon={X} label={`Tirar ${item.fileName}`} onClick={() => removeAt(index)} />
                </div>
              </li>
            ))}
            {media.length < CAROUSEL_MAX && (
              <li>
                <button
                  type="button"
                  data-redes-media-add
                  onClick={() => void addMedia()}
                  disabled={!idle}
                  className="no-drag flex size-24 flex-col items-center justify-center gap-1 rounded-[var(--radius-control)] border border-dashed border-line-strong text-12 font-medium text-accent hover:bg-bg-sunken disabled:opacity-50"
                >
                  <Icon icon={Plus} />
                  {busy === 'pick' ? 'Abrindo…' : 'Adicionar mídia'}
                </button>
              </li>
            )}
          </ul>
          <p data-redes-media-info className={`text-12 ${typeError ? 'text-rec' : 'text-text-muted'}`}>
            {typeError ?? (current ? mediaInspection(current) : 'JPEG para imagem e carrossel (até 10); MP4 ou MOV para Reels.')}
          </p>
          {problems.length > 0 && (
            <div data-redes-media-problems>
              <Note id="redes-editor-problems" icon={TriangleAlert} role="alert" layout="stacked">
                {problems.length === 1 ? (
                  problems[0]
                ) : (
                  <span className="flex flex-col gap-0.5">
                    {problems.map((problem) => (
                      <span key={problem}>{problem}</span>
                    ))}
                  </span>
                )}
              </Note>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="redes-editor-caption" className={FIELD_LABEL}>
            Legenda
          </label>
          <textarea
            id="redes-editor-caption"
            data-redes-caption
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={4}
            spellCheck
            aria-describedby="redes-editor-caption-stats"
            aria-invalid={stats.problems.length > 0 || undefined}
            className={`no-drag field-sizing-content max-h-[320px] min-h-[88px] w-full resize-none rounded-[var(--radius-control)] border bg-bg-raised px-2.5 py-1.5 text-13 text-text select-text placeholder:text-text-faint ${stats.problems.length ? 'border-rec' : 'border-line-strong'}`}
            placeholder="Escreva a legenda"
          />
          <p id="redes-editor-caption-stats" data-redes-caption-stats className={`text-right text-12 tabular ${stats.problems.length ? 'text-rec' : 'text-text-muted'}`}>
            {captionStatsLine(stats)}
          </p>
          {stats.problems.length > 0 && <p className="text-12 text-rec">{stats.problems.join('. ')}</p>}
        </div>

        {current?.kind === 'imagem' && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="redes-editor-alt" className={FIELD_LABEL}>
              Texto alternativo<span className="font-normal text-text-muted"> · imagem {Math.min(selected, media.length - 1) + 1}</span>
            </label>
            <div className="flex">
              <TextField
                id="redes-editor-alt"
                value={current.altText}
                onChange={(value) => setMedia((list) => list.map((item) => (item.key === current.key ? { ...item, altText: value } : item)))}
                placeholder="Descreva a imagem para quem não vê"
                maxLength={ALT_TEXT_MAX}
                data={{ 'data-redes-alt': '' }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <p className={FIELD_LABEL}>
            Agendamento<span className="font-normal text-text-muted"> · opcional</span>
          </p>
          <div className="flex gap-2">
            <input type="date" aria-label="Data" data-redes-date value={date} onChange={(event) => {
                setDate(event.target.value)
                setNow(Date.now())
              }} className={`${CONTROL_CLASS} min-w-0 flex-1 px-2.5 select-text`} />
            <input type="time" aria-label="Hora" data-redes-time value={time} onChange={(event) => {
                setTime(event.target.value)
                setNow(Date.now())
              }} className={`${CONTROL_CLASS} w-[96px] shrink-0 px-2.5 select-text`} />
          </div>
          <p className="text-12 text-text-muted">Publica quando o LAP Reuniões estiver aberto. Com o app fechado, sai na próxima abertura.</p>
          {at !== null && !future && <p className="text-12 text-rec">Escolha um horário no futuro para agendar.</p>}
        </div>
      </div>

      {error && (
        <div data-redes-editor-error className="shrink-0 px-4 pb-2">
          <Note id="redes-editor-error" icon={TriangleAlert} role="alert" layout="stacked">
            {error}
          </Note>
        </div>
      )}
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <Button variant="secondary" action="redes-save" data={{ 'data-redes-save': '' }} onClick={() => void save()} disabled={!idle || !canSave}>
          {busy === 'save' ? 'Salvando…' : 'Salvar rascunho'}
        </Button>
        <span className="ml-auto flex gap-2">
          <Button variant="secondary" action="redes-schedule" data={{ 'data-redes-schedule': '' }} onClick={() => void schedule()} disabled={!idle || !media.length || blocked || !future}>
            {busy === 'schedule' ? 'Agendando…' : 'Agendar'}
          </Button>
          <Button action="redes-publish" data={{ 'data-redes-publish': '' }} onClick={() => void publishNow()} disabled={!idle || !media.length || blocked}>
            {busy === 'publish' ? 'Publicando…' : 'Publicar agora'}
          </Button>
        </span>
      </footer>
    </aside>
  )
}

/** A confirmação no topo do painel (descartar as mudanças, excluir a publicação). */
function ConfirmBar({ text, attrs, yes, no, disabled, onYes, onNo }: { text: string; attrs: Record<`data-${string}`, string>; yes: string; no: string; disabled: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div {...attrs} role="alertdialog" aria-label={text} className="flex flex-wrap items-center gap-2 border-b border-line bg-bg-sunken px-4 py-2">
      <p className="min-w-0 flex-[1_1_100%] text-13 text-text">{text}</p>
      <Button variant="danger" action="redes-editor-confirm" onClick={onYes} disabled={disabled}>
        {yes}
      </Button>
      <Button variant="secondary" action="redes-editor-cancel" onClick={onNo}>
        {no}
      </Button>
    </div>
  )
}

const THOUSANDS = new Intl.NumberFormat('pt-BR')
/** `187/2.200 · 4 hashtags · 1 @`. */
function captionStatsLine(stats: ReturnType<typeof captionStats>): string {
  return `${THOUSANDS.format(stats.chars)}/2.200 · ${stats.hashtags} ${stats.hashtags === 1 ? 'hashtag' : 'hashtags'} · ${stats.mentions} @`
}

/** Botão de 20 px sobre a miniatura (mover ou tirar), à mostra no hover ou no foco da miniatura. */
function MiniButton({ icon, label, onClick, disabled = false }: { icon: typeof X; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="no-drag inline-flex size-5 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-title hover:bg-bg-sunken disabled:opacity-40"
    >
      <Icon icon={icon} size={14} />
    </button>
  )
}
