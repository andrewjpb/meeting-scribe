// Fita de níveis ao vivo: microfone para cima em --mic, sistema para baixo em --sys, barras de 3 px
// com 1 px de intervalo e pontas retas, encostadas no fio central, a mais nova à direita rolando para
// a esquerda. Uma coluna a cada 50 ms de
// gravação; entre colunas a fita desliza de forma contínua (um quadro por `requestAnimationFrame`).
// Pausada, congela e cai para 40%. Fonte ausente: tracejado em --line-strong e "sem sinal". Microfone desligado
// de propósito (contrato 29): sem barras nem tracejado, com "mic desligado" ao lado de "Você".
import { useEffect, useRef } from 'react'
import type { CapturePhase, CaptureSession } from '../../audio/capture'
import { dbfsToLevel, rmsToDbfs } from '../../audio/levels'
import { COLUMN_MS, type TapeHistory } from './tapeHistory'
import { tapeStats } from './tapeStats'

const HEIGHT = 96
const MID = HEIGHT / 2
const BAR = 3
const STEP = BAR + 1
/** O fio central ocupa a linha MID; o microfone termina nele e o sistema começa logo abaixo. */
const SIDE_MAX = MID - 8
/** Espaço entre o fim dos rótulos à esquerda e a barra mais antiga. */
const LABEL_GAP = 16
/** Tracejado de fonte ausente: no meio da metade dela, 1 px, 8 px cheio e 8 px vazio (2 colunas). */
const DASH_Y = 24

interface TapeColors {
  mic: string
  sys: string
  line: string
}

function readColors(element: Element): TapeColors {
  const style = getComputedStyle(element)
  const read = (name: string): string => style.getPropertyValue(name).trim()
  return { mic: read('--mic'), sys: read('--sys'), line: read('--line-strong') }
}

/** Borda direita do rótulo mais largo, mais a folga. */
function measureGutter(labels: HTMLElement | null): number {
  let right = 0
  for (const label of Array.from(labels?.children ?? [])) {
    if (label instanceof HTMLElement) right = Math.max(right, label.offsetLeft + label.offsetWidth)
  }
  return right + LABEL_GAP
}

export const levelOf = (rms: number | null): number | null => (rms === null ? null : dbfsToLevel(rmsToDbfs(rms)))

interface LevelTapeProps {
  session: CaptureSession
  tape: TapeHistory
  phase: CapturePhase
  micAbsent: boolean
  systemAbsent: boolean
  /** "Ouvir só os participantes" (contrato 29). */
  micOff?: boolean
}

export function LevelTape({ session, tape, phase, micAbsent, systemAbsent, micOff = false }: LevelTapeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const labelsRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  /** As barras vão até onde terminam os rótulos ("sem sinal" alarga o rótulo). */
  const gutterRef = useRef(0)
  const redrawRef = useRef<(() => void) | null>(null)
  const live = phase === 'recording'

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    gutterRef.current = measureGutter(labelsRef.current)
    redrawRef.current?.()
  }, [micAbsent, systemAbsent, micOff])

  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    let width = 0
    let dpr = 1
    let colors = readColors(canvas)
    let lastColumnAt = performance.now()
    let frac = 0
    let raf = 0

    const snap = (x: number): number => Math.round(x * dpr) / dpr

    const drawSide = (level: number | null, index: number, x: number, up: boolean, color: string): void => {
      if (level === null) {
        // Tracejado ancorado no índice absoluto, para rolar junto com a fita.
        if (index % 4 >= 2) return
        context.fillStyle = colors.line
        context.fillRect(x, up ? MID - DASH_Y : MID + DASH_Y, STEP, 1)
        return
      }
      const h = Math.round(level * SIDE_MAX)
      if (h < 1) return
      context.fillStyle = color
      context.fillRect(x, up ? MID - h : MID + 1, BAR, h)
    }

    const draw = (): void => {
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, width, HEIGHT)
      const left = gutterRef.current
      const right = width
      if (right <= left) return
      context.fillStyle = colors.line
      context.fillRect(left, MID, right - left, 1)
      for (let age = 0; ; age++) {
        const entry = tape.at(age)
        if (!entry) break
        const x = snap(right - BAR - (age + frac) * STEP)
        if (x < left) break
        drawSide(entry.column.mic, entry.index, x, true, colors.mic)
        drawSide(entry.column.system, entry.index, x, false, colors.sys)
      }
      tapeStats.frames++
    }

    const resize = (): void => {
      gutterRef.current = measureGutter(labelsRef.current)
      dpr = window.devicePixelRatio || 1
      width = canvas.clientWidth
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(HEIGHT * dpr)
      draw()
    }

    const loop = (now: number): void => {
      if (phaseRef.current === 'recording') {
        // Voltando de um intervalo longo sem quadros (janela oculta): não despeja colunas vazias.
        if (now - lastColumnAt > 1000) lastColumnAt = now - COLUMN_MS
        while (now - lastColumnAt >= COLUMN_MS) {
          lastColumnAt += COLUMN_MS
          const levels = session.takeLevels()
          tape.push({ mic: levelOf(levels.mic), system: levelOf(levels.system) })
        }
        frac = (now - lastColumnAt) / COLUMN_MS
        draw()
      } else {
        // Congelada: guarda o deslocamento para retomar do mesmo ponto.
        lastColumnAt = now - frac * COLUMN_MS
      }
      raf = requestAnimationFrame(loop)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(canvas)
    const themeObserver = new MutationObserver(() => {
      colors = readColors(canvas)
      draw()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    resize()
    // Por garantia: se a largura dos rótulos mudar depois da primeira medida, a fita acompanha.
    void document.fonts.ready.then(resize)
    redrawRef.current = draw
    raf = requestAnimationFrame(loop)

    return () => {
      redrawRef.current = null
      cancelAnimationFrame(raf)
      resizeObserver.disconnect()
      themeObserver.disconnect()
    }
  }, [session, tape])

  return (
    <div className="relative h-24 bg-bg-sunken" role="img" aria-label="Níveis de áudio de você e dos participantes">
      <div className={`absolute inset-0 transition-opacity duration-[var(--duration-slow)] ease-[var(--ease-out)] ${live ? 'opacity-100' : 'opacity-40'}`}>
        <canvas ref={canvasRef} className="absolute inset-0 h-24 w-full" aria-hidden="true" />
        <div ref={labelsRef}>
          <TapeLabel label="Você" tone="mic" absent={micAbsent} off={micOff} position="top" />
          <TapeLabel label="Participantes" tone="sys" absent={systemAbsent} position="bottom" />
        </div>
      </div>
    </div>
  )
}

function TapeLabel({ label, tone, absent, off = false, position }: { label: string; tone: 'mic' | 'sys'; absent: boolean; off?: boolean; position: 'top' | 'bottom' }) {
  return (
    <p
      data-source-label={tone}
      data-source-off={off || undefined}
      className={`caps absolute left-10 flex h-12 items-center ${position === 'top' ? 'top-0' : 'bottom-0'}`}
    >
      <span className={tone === 'mic' ? 'text-mic' : 'text-sys'}>{label}</span>
      {off ? (
        <span data-mic-off-label className="ml-1.5 tracking-normal text-text-muted normal-case">
          mic desligado
        </span>
      ) : (
        absent && <span className="ml-1.5 tracking-normal text-text-faint normal-case">sem sinal</span>
      )}
    </p>
  )
}
