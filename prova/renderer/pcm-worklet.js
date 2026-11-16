// Repassa ao main thread os blocos Float32 que chegam (um array por canal), em lotes de
// ~1024 quadros para não inundar a porta com mensagens de 128 quadros.
class PcmRepasse extends AudioWorkletProcessor {
  constructor() {
    super();
    this.lote = [];
    this.quadros = 0;
  }

  enviar() {
    if (!this.lote.length) return;
    const nCanais = this.lote[0].length;
    const canais = [];
    for (let c = 0; c < nCanais; c++) {
      const saida = new Float32Array(this.quadros);
      let off = 0;
      for (const bloco of this.lote) { saida.set(bloco[c], off); off += bloco[c].length; }
      canais.push(saida);
    }
    this.port.postMessage({ canais }, canais.map((c) => c.buffer));
    this.lote = [];
    this.quadros = 0;
  }

  process(inputs) {
    const entrada = inputs[0];
    // Sem entrada conectada (ou trilha encerrada) o Chromium entrega zero canais.
    if (entrada && entrada.length) {
      if (this.lote.length && this.lote[0].length !== entrada.length) this.enviar();
      this.lote.push(entrada.map((c) => c.slice()));
      this.quadros += entrada[0].length;
      if (this.quadros >= 1024) this.enviar();
    }
    return true; // a saída fica em silêncio
  }
}

registerProcessor('pcm-repasse', PcmRepasse);
