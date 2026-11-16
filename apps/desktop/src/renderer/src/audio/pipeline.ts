// Ligação real com o navegador: `navigator.mediaDevices` e um `AudioContext` por fonte, na taxa da
// trilha, com o worklet repassando os blocos (mesma montagem de prova/renderer/app.js).
import type { CreatePipeline, MediaApi, StreamLike } from './capture'
import workletUrl from './pcm-worklet.js?url'

const WORKLET_NAME = 'scribe-pcm'

export function browserMedia(): MediaApi {
  const devices = navigator.mediaDevices
  return {
    getUserMedia: (constraints) => devices.getUserMedia(constraints),
    // `restrictOwnAudio` ainda não está no lib.dom do TypeScript.
    getDisplayMedia: (constraints) => devices.getDisplayMedia(constraints as DisplayMediaStreamOptions),
    enumerateDevices: () => devices.enumerateDevices(),
    addEventListener: (type, listener) => devices.addEventListener(type, listener),
    removeEventListener: (type, listener) => devices.removeEventListener(type, listener),
  }
}

export const createWebAudioPipeline: CreatePipeline = async (_source, stream: StreamLike, onBlock) => {
  const media = stream as unknown as MediaStream
  const rate = media.getAudioTracks()[0]?.getSettings().sampleRate
  const context = rate ? new AudioContext({ sampleRate: rate }) : new AudioContext()
  try {
    await context.audioWorklet.addModule(workletUrl)
    const input = context.createMediaStreamSource(media)
    const node = new AudioWorkletNode(context, WORKLET_NAME)
    node.port.onmessage = (event: MessageEvent<{ channels: Float32Array[] }>) => onBlock(event.data.channels, context.sampleRate)
    input.connect(node)
    // Saída silenciosa; ligar ao destino garante que o worklet seja processado.
    node.connect(context.destination)
    await context.resume()
    return {
      close: async () => {
        node.port.onmessage = null
        input.disconnect()
        node.disconnect()
        if (context.state !== 'closed') await context.close()
      },
    }
  } catch (error) {
    if (context.state !== 'closed') void context.close()
    throw error
  }
}
