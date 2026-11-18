// Mídia no balão do WhatsApp (contrato 37): tudo só no clique. Imagem, vídeo e áudio com as chaves do download viram
// o botão "Baixar"; os bytes vêm pelo IPC, viram blob (guardado na sessão) e um object URL que cada elemento revoga ao
// sair da tela. O áudio ganha o player do app e "Transcrever" (o áudio vai só à AssemblyAI, pelo main); a imagem abre
// em tamanho natural numa sobreposição (Esc fecha); o vídeo usa os controles nativos. Mensagem de antes desta versão,
// documento e figurinha continuam como chip. Os bytes são só dado: nunca HTML, nunca script.
import { Download, FileText, Image as ImageIcon, LoaderCircle, Mic, Pause, Paperclip, Play, Sticker, Video, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { mediaLabel, type WhatsAppMedia, type WhatsAppMessage, type WhatsAppMessageType } from '@shared/whatsapp'
import { Icon } from '../../design/Icon'
import {
  canDownload,
  knownDuration,
  mediaErrorFinal,
  mediaErrorText,
  mediaKey,
  nextRate,
  objectUrls,
  OLD_MEDIA_TITLE,
  rateLabel,
  seekRatio,
  sessionBlobs,
  sessionTranscripts,
  supportsDownload,
  timeLabel,
  toBlob,
  TRANSCRIBE_TITLE,
  transcribeErrorText,
} from './media'

const MEDIA_ICONS: Record<WhatsAppMessageType, LucideIcon> = {
  text: Paperclip,
  image: ImageIcon,
  video: Video,
  audio: Mic,
  document: FileText,
  sticker: Sticker,
  other: Paperclip,
}

/** O object URL do blob enquanto o elemento está na tela; revogado quando o último elemento que o usa sai. */
function useObjectUrl(blob: Blob | undefined): string | null {
  const url = blob ? objectUrls.urlFor(blob) : null
  useEffect(() => {
    if (!blob) return
    objectUrls.acquire(blob)
    return () => objectUrls.release(blob)
  }, [blob])
  return url
}

/** Sobreposição simples com a imagem em tamanho natural; Esc, o fundo e o "Fechar" fecham. */
function ImageOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    close.current?.focus()
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Imagem em tamanho natural"
      data-wa-image-overlay
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="no-drag fixed inset-0 z-[90] flex items-center justify-center overflow-auto bg-[var(--lock-veil)] p-8"
    >
      <button
        ref={close}
        type="button"
        data-action="wa-image-close"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute top-4 right-4 inline-flex size-8 items-center justify-center rounded-[var(--radius-control)] border border-line-strong bg-bg-raised text-title hover:bg-bg-sunken"
      >
        <Icon icon={X} size={16} />
      </button>
      <img src={url} alt="" className="max-w-none rounded-[var(--radius-panel)]" />
    </div>
  )
}

/** Player do áudio: tocar/pausar, a barra (clique ou setas mudam a posição), o tempo e a velocidade. */
function AudioPlayer({ url, seconds, mine }: { url: string; seconds: number | undefined; mine: boolean }) {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(knownDuration(NaN, seconds))
  const [rate, setRate] = useState(1)
  const progress = duration > 0 ? Math.min(100, (current / duration) * 100) : 0

  const toggle = (): void => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => setPlaying(false))
    else el.pause()
  }
  const seekTo = (time: number): void => {
    const el = audio.current
    if (!el || !(duration > 0)) return
    el.currentTime = Math.min(duration, Math.max(0, time))
    setCurrent(el.currentTime)
  }
  const onBar = (event: MouseEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect()
    seekTo(seekRatio(event.clientX, box.left, box.width) * duration)
  }
  const onBarKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      seekTo(current + (event.key === 'ArrowRight' ? 5 : -5))
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      seekTo(event.key === 'Home' ? 0 : duration)
    }
  }
  const changeRate = (): void => {
    const next = nextRate(rate)
    setRate(next)
    if (audio.current) audio.current.playbackRate = next
  }
  const control = 'inline-flex shrink-0 items-center justify-center rounded-[var(--radius-control)] text-title hover:bg-bg-sunken'

  return (
    <div data-wa-audio className={`flex w-[300px] max-w-full items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1 text-text ${mine ? 'bg-bg-raised' : 'bg-bg-sunken'}`}>
      <audio
        ref={audio}
        src={url}
        preload="metadata"
        className="hidden"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(knownDuration(event.currentTarget.duration, seconds))}
        onDurationChange={(event) => setDuration(knownDuration(event.currentTarget.duration, seconds))}
      />
      <button type="button" data-wa-audio-toggle aria-label={playing ? 'Pausar' : 'Ouvir'} onClick={toggle} className={`${control} size-7`}>
        <Icon icon={playing ? Pause : Play} size={16} />
      </button>
      <div
        role="slider"
        tabIndex={0}
        data-wa-audio-bar
        aria-label="Posição do áudio"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(current)}
        aria-valuetext={`${timeLabel(current)} de ${timeLabel(duration)}`}
        onClick={onBar}
        onKeyDown={onBarKey}
        className="flex h-6 min-w-0 flex-1 cursor-pointer items-center"
      >
        <div className="relative h-1 w-full overflow-hidden rounded-[var(--radius-control)] bg-line-strong">
          <div data-wa-audio-progress className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${progress}%` }} />
        </div>
      </div>
      <span data-wa-audio-time className="shrink-0 text-12 text-text-muted tabular">
        {timeLabel(current)} / {timeLabel(duration)}
      </span>
      <button type="button" data-wa-audio-rate aria-label={`Velocidade ${rateLabel(rate)}`} onClick={changeRate} className={`${control} h-7 min-w-9 px-1 text-12 font-medium tabular`}>
        {rateLabel(rate)}
      </button>
    </div>
  )
}

/** "Transcrever" e o texto do áudio (o que já foi transcrito aparece sem clicar; o main lê do arquivo dele). */
function Transcript({ chatId, messageId, downloaded, mine }: { chatId: string; messageId: string; downloaded: boolean; mine: boolean }) {
  const key = mediaKey(chatId, messageId)
  const [text, setText] = useState<string | null>(() => sessionTranscripts.get(key) ?? null)
  const [checked, setChecked] = useState(() => sessionTranscripts.has(key))
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Só lê o que já foi transcrito: nada é baixado nem enviado sem o clique.
  useEffect(() => {
    if (sessionTranscripts.has(key)) return
    let alive = true
    void window.__scribeApi.invoke('scribe:whatsapp-transcribe', { chatId, messageId, peek: true }).then(
      (result) => {
        const found = result.ok ? result.text : null
        sessionTranscripts.set(key, found)
        if (!alive) return
        setText(found)
        setChecked(true)
      },
      () => {
        if (alive) setChecked(true)
      },
    )
    return () => {
      alive = false
    }
  }, [chatId, messageId, key])

  const run = (): void => {
    if (running) return
    setRunning(true)
    setError(null)
    void window.__scribeApi.invoke('scribe:whatsapp-transcribe', { chatId, messageId }).then(
      (result) => {
        setRunning(false)
        if (result.ok) {
          sessionTranscripts.set(key, result.text)
          setText(result.text)
        } else setError(transcribeErrorText(result.error))
      },
      () => {
        setRunning(false)
        setError(transcribeErrorText('failed'))
      },
    )
  }

  if (text !== null)
    return (
      <p data-wa-transcript className="border-t border-current/20 pt-1.5 text-13 whitespace-pre-wrap select-text">
        {text || 'Sem fala reconhecida neste áudio.'}
      </p>
    )
  if (!downloaded || !checked) return null
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        data-wa-transcribe
        title={TRANSCRIBE_TITLE}
        onClick={run}
        disabled={running}
        aria-busy={running || undefined}
        className="no-drag inline-flex h-7 items-center gap-1.5 self-start rounded-[var(--radius-control)] border border-current/30 px-2 text-12 font-medium hover:bg-current/10 disabled:opacity-60"
      >
        {running && <Icon icon={LoaderCircle} size={14} className="animate-spin" />}
        {running ? 'Transcrevendo…' : 'Transcrever'}
      </button>
      {error && (
        <span role="alert" data-wa-transcribe-error className={`text-12 ${mine ? '' : 'text-rec'}`}>
          {error}
        </span>
      )}
    </div>
  )
}

/** O chip de antes (metadado): documento, figurinha e as mídias sem as chaves do download. */
function MediaChip({ media, mine }: { media: WhatsAppMedia; mine: boolean }) {
  return (
    <span
      data-whatsapp-media
      title={supportsDownload(media) ? OLD_MEDIA_TITLE : undefined}
      className={`flex items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1 text-13 ${mine ? 'bg-bg-raised text-text' : 'bg-bg-sunken text-text-muted'}`}
    >
      <Icon icon={MEDIA_ICONS[media.kind]} size={14} className="shrink-0" />
      {mediaLabel(media)}
    </span>
  )
}

/** A mídia da mensagem no balão: o chip, o "Baixar" ou, baixada, a imagem, o vídeo ou o player. */
export function MessageMedia({ message, mine }: { message: WhatsAppMessage; mine: boolean }) {
  const media = message.media
  const key = mediaKey(message.chatId, message.id)
  const [blob, setBlob] = useState<Blob | undefined>(() => sessionBlobs.get(key))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ text: string; final: boolean } | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const url = useObjectUrl(blob)
  if (!media) return null
  if (!canDownload(media)) return <MediaChip media={media} mine={mine} />
  const label = mediaLabel(media)

  const download = (): void => {
    if (loading) return
    setLoading(true)
    setError(null)
    void window.__scribeApi.invoke('scribe:whatsapp-media', { chatId: message.chatId, messageId: message.id }).then(
      (result) => {
        setLoading(false)
        if (result.ok) {
          const made = toBlob(result.bytes, result.mime)
          sessionBlobs.put(key, made)
          setBlob(made)
        } else setError({ text: mediaErrorText(result.error), final: mediaErrorFinal(result.error) })
      },
      () => {
        setLoading(false)
        setError({ text: mediaErrorText('unavailable'), final: false })
      },
    )
  }

  let body
  if (!url) {
    body = (
      <button
        type="button"
        data-wa-download
        onClick={download}
        disabled={loading || error?.final === true}
        aria-busy={loading || undefined}
        aria-label={`Baixar ${label}`}
        title="Baixar e mostrar aqui"
        className={`no-drag flex items-center gap-1.5 self-start rounded-[var(--radius-control)] px-2 py-1 text-left text-13 disabled:opacity-70 ${mine ? 'bg-bg-raised text-text hover:bg-bg-sunken' : 'bg-bg-sunken text-text-muted hover:text-text'}`}
      >
        <Icon icon={loading ? LoaderCircle : Download} size={14} className={`shrink-0 ${loading ? 'animate-spin' : ''}`} />
        <Icon icon={MEDIA_ICONS[media.kind]} size={14} className="shrink-0" />
        <span>{label}</span>
        <span className="font-medium text-accent">{loading ? 'Baixando…' : 'Baixar'}</span>
      </button>
    )
  } else if (media.kind === 'image') {
    body = (
      <>
        <button type="button" data-wa-image-open aria-label="Abrir a imagem em tamanho natural" onClick={() => setZoomed(true)} className="no-drag self-start">
          <img data-wa-image src={url} alt="" className="max-h-[320px] max-w-full rounded-[var(--radius-panel)] object-contain" />
        </button>
        {zoomed && <ImageOverlay url={url} onClose={() => setZoomed(false)} />}
      </>
    )
  } else if (media.kind === 'video') {
    body = <video data-wa-video src={url} controls preload="metadata" className="max-h-[320px] max-w-full rounded-[var(--radius-panel)]" />
  } else {
    body = <AudioPlayer url={url} seconds={media.seconds} mine={mine} />
  }

  return (
    <div data-wa-media={media.kind} className="flex flex-col gap-1.5">
      {body}
      {error && (
        <span role="alert" data-wa-media-error className={`text-12 ${mine ? '' : 'text-rec'}`}>
          {error.text}
        </span>
      )}
      {media.kind === 'audio' && <Transcript chatId={message.chatId} messageId={message.id} downloaded={Boolean(blob)} mine={mine} />}
    </div>
  )
}
