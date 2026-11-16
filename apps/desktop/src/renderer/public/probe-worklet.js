// AudioWorkletProcessor mínimo. O smoke carrega este arquivo pela própria origem
// (scribe://app/probe-worklet.js) para provar que `audioWorklet.addModule` funciona nela.
class ScribeProbeProcessor extends AudioWorkletProcessor {
  process() {
    return false
  }
}

registerProcessor('scribe-probe', ScribeProbeProcessor)
