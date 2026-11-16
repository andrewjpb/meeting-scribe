// AudioWorkletProcessor da captura (porta de prova/renderer/pcm-worklet.js). Repassa à thread
// principal os blocos Float32 que chegam, um array por canal, em lotes de ~1024 quadros para não
// inundar a porta com mensagens de 128 quadros. Carregado por URL da própria origem.
class ScribePcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.batch = []
    this.frames = 0
  }

  flush() {
    if (!this.batch.length) return
    const channelCount = this.batch[0].length
    const channels = []
    for (let c = 0; c < channelCount; c++) {
      const out = new Float32Array(this.frames)
      let offset = 0
      for (const block of this.batch) {
        out.set(block[c], offset)
        offset += block[c].length
      }
      channels.push(out)
    }
    this.port.postMessage({ channels }, channels.map((channel) => channel.buffer))
    this.batch = []
    this.frames = 0
  }

  process(inputs) {
    const input = inputs[0]
    // Sem entrada conectada (ou trilha encerrada) o Chromium entrega zero canais.
    if (input && input.length) {
      if (this.batch.length && this.batch[0].length !== input.length) this.flush()
      this.batch.push(input.map((channel) => channel.slice()))
      this.frames += input[0].length
      if (this.frames >= 1024) this.flush()
    }
    return true // a saída fica em silêncio
  }
}

registerProcessor('scribe-pcm', ScribePcmProcessor)
