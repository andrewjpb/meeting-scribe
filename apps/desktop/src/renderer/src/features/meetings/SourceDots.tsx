import type { MeetingSources } from '@shared/meetings'

/** Dois quadrados de 6 px nas cores das fontes; a fonte que não entregou som fica só com o contorno. */
export function SourceDots({ sources }: { sources: MeetingSources }) {
  const label =
    sources.mic && sources.system ? 'Você e participantes' : sources.mic ? 'Só você' : sources.system ? 'Só participantes' : 'Sem som captado'
  return (
    <span className="flex shrink-0 items-center gap-1" role="img" aria-label={label} title={label}>
      <span className={`size-1.5 ${sources.mic ? 'bg-mic' : 'border border-line-strong'}`} />
      <span className={`size-1.5 ${sources.system ? 'bg-sys' : 'border border-line-strong'}`} />
    </span>
  )
}
