// Ilustração da fita de níveis parada: microfone para cima em --mic, sistema para baixo em --sys,
// barras de 3 px com 1 px de intervalo e pontas retas, encostadas no fio central. Os níveis são
// fixos (o mesmo gerador determinístico do mockup aprovado), para a imagem não mudar.

const BAR = 3
const STEP = BAR + 1
const COUNT = 80
const WIDTH = COUNT * STEP
const HEIGHT = 80
const MID = HEIGHT / 2

interface Bar {
  x: number
  mic: number
  sys: number
}

/** Uma conversa: você fala, os participantes respondem, você fecha, eles respondem, e a fita para. */
function buildBars(): Bar[] {
  let seed = 11
  const noise = (): number => {
    seed = (seed * 9301 + 49297) % 233280
    return seed / 233280
  }
  const bars: Bar[] = []
  for (let i = 0; i < COUNT; i++) {
    const micOn = (i > 6 && i < 28) || (i > 54 && i < 70)
    const sysOn = (i > 30 && i < 52) || i > 72
    bars.push({
      x: i * STEP,
      mic: micOn ? Math.round(5 + noise() * 28) : 0,
      sys: sysOn ? Math.round(5 + noise() * 28) : 0,
    })
  }
  return bars
}

const BARS = buildBars()

/** Fita parada com uma conversa gravada (estado vazio de Reuniões). */
export function TapeIllustration() {
  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" focusable="false" className="block">
      {BARS.map((bar) => (
        <g key={bar.x}>
          {bar.mic > 0 && <rect x={bar.x} y={MID - bar.mic} width={BAR} height={bar.mic} className="fill-mic" />}
          {bar.sys > 0 && <rect x={bar.x} y={MID + 1} width={BAR} height={bar.sys} className="fill-sys" />}
        </g>
      ))}
      <rect x={0} y={MID} width={WIDTH} height={1} className="fill-line-strong" />
    </svg>
  )
}

function SilentSide({ label, tone }: { label: string; tone: 'mic' | 'sys' }) {
  return (
    <div className="flex h-9 items-center gap-3">
      <span className={`caps shrink-0 ${tone === 'mic' ? 'text-mic' : 'text-sys'}`}>
        {label}
        <span className="ml-1.5 tracking-normal normal-case text-text-faint">sem sinal</span>
      </span>
      <svg height={1} className="min-w-0 flex-1" aria-hidden="true" focusable="false">
        <line x1={0} x2="100%" y1={0.5} y2={0.5} strokeWidth={1} strokeDasharray="6 6" className="stroke-line-strong" />
      </svg>
    </div>
  )
}

/** Fita sem sinal nas duas fontes: o tracejado de fonte ausente de design.md, com os rótulos. */
export function SilentTapeIllustration() {
  return (
    <div className="w-[320px]" aria-hidden="true">
      <SilentSide label="Você" tone="mic" />
      <div className="h-px bg-line-strong" />
      <SilentSide label="Participantes" tone="sys" />
    </div>
  )
}
