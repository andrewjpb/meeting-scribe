// Mistura das duas fontes num único fluxo para o arquivo da reunião (contrato 07, CA3): um
// `AudioContext` só para isso, cada fonte ligada direto a um destino mono (sem ganho extra) e o
// `MediaRecorder` sobre ele. A captura que vai para a AssemblyAI tem os próprios `AudioContext` e não
// é tocada: aqui só se lê a mesma trilha uma segunda vez.
import { AUDIO_BITS_PER_SECOND } from '@shared/meeting-files'
import type { StreamLike } from './capture'
import type { MeetingAudioRecorder, RecorderLike } from './recorder'

export function createMixedRecorder(mime: string): MeetingAudioRecorder {
  const context = new AudioContext()
  const destination = context.createMediaStreamDestination()
  // Mono: o sistema chega em estéreo e é somado pelos canais (`speakers`), como o resto do app.
  destination.channelCount = 1
  destination.channelCountMode = 'explicit'
  destination.channelInterpretation = 'speakers'
  const sources: MediaStreamAudioSourceNode[] = []
  const recorder = new MediaRecorder(destination.stream, { mimeType: mime, audioBitsPerSecond: AUDIO_BITS_PER_SECOND })
  void context.resume().catch(() => undefined)
  return {
    recorder: recorder as unknown as RecorderLike,
    addStream: (_source, stream: StreamLike) => {
      if (context.state === 'closed') return
      const node = context.createMediaStreamSource(stream as unknown as MediaStream)
      node.connect(destination)
      sources.push(node)
    },
    close: async () => {
      for (const node of sources) node.disconnect()
      if (context.state !== 'closed') await context.close().catch(() => undefined)
    },
  }
}
