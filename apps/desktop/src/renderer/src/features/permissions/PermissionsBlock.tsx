import type { MouseEvent, ReactNode } from 'react'
import { PRIVACY_PANE_URLS } from '@shared/privacy'
import { usePermissions, usePermissionsSync } from './permissionsStore'
import type { SystemAudioState } from './systemAudio'

type Tone = 'ok' | 'neutral' | 'bad'

// Quadrado de estado de 6 px sobre o azul: ok no azul vibrante do logo, neutro em --side-muted, problema em --side-rec.
const SQUARE: Record<Tone, string> = { ok: 'bg-side-ok', neutral: 'bg-side-muted', bad: 'bg-side-rec' }

const SYSTEM: Record<SystemAudioState, { tone: Tone; label: string }> = {
  unknown: { tone: 'neutral', label: 'não verificado' },
  ok: { tone: 'ok', label: 'ok' },
  silent: { tone: 'bad', label: 'sem áudio' },
}

/** Rodapé da barra lateral: microfone (estado do macOS) e áudio do sistema (última captura). */
export function PermissionsBlock() {
  usePermissionsSync()
  const mic = usePermissions((state) => state.mic)
  const systemAudio = usePermissions((state) => state.systemAudio)
  const requesting = usePermissions((state) => state.requesting)
  const requestMic = usePermissions((state) => state.requestMic)
  const system = SYSTEM[systemAudio]

  const openMicSettings = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    window.__scribeApi.send('scribe:open-privacy-settings', 'microphone')
  }

  let micTone: Tone = 'neutral'
  let micState: ReactNode = null
  if (mic === 'granted') {
    micTone = 'ok'
    micState = <span className="whitespace-nowrap text-side-muted">concedido</span>
  } else if (mic === 'denied') {
    micTone = 'bad'
    micState = (
      <a
        href={PRIVACY_PANE_URLS.microphone}
        onClick={openMicSettings}
        draggable={false}
        title="Abrir Ajustes do Sistema"
        data-action="open-mic-settings"
        className="no-drag rounded-[var(--radius-control)] text-side-muted underline decoration-1 underline-offset-3 transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-side-text"
      >
        negado
      </a>
    )
  } else if (mic === 'not-determined') {
    micState = (
      <button
        type="button"
        data-action="allow-mic"
        onClick={() => void requestMic()}
        disabled={requesting}
        aria-label="Microfone não pedido. Permitir"
        className="no-drag h-6 rounded-[var(--radius-control)] border border-side-outline px-2 text-11 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active disabled:opacity-50"
      >
        Permitir
      </button>
    )
  }

  return (
    // Recuo lateral de 4 px (o mockup tem 10): com 10, "Áudio do sistema" + "não verificado" passa dos
    // 180 px que sobram em 12 px de Helvetica e quebra em duas linhas.
    <section aria-label="Permissões" className="mt-auto flex flex-col gap-2.5 border-t border-side-active px-1 pt-4 pb-5">
      <h2 className="caps text-side-muted">Permissões</h2>
      <Row name="Microfone" tone={micTone} permission="mic" state={mic ?? ''}>
        {micState}
      </Row>
      <Row name="Áudio do sistema" tone={system.tone} permission="system" state={systemAudio}>
        <span className="whitespace-nowrap text-side-muted">{system.label}</span>
      </Row>
    </section>
  )
}

function Row({ name, tone, permission, state, children }: { name: string; tone: Tone; permission: string; state: string; children: ReactNode }) {
  return (
    <div data-permission={permission} data-state={state} className="flex items-center gap-2 text-12">
      <span aria-hidden="true" className={`size-1.5 shrink-0 ${SQUARE[tone]}`} />
      <span className="grow whitespace-nowrap">{name}</span>
      {children}
    </div>
  )
}
