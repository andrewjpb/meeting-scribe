// App de prova da fase 0: captura mic e áudio do sistema, mostra estado e nível de cada
// trilha, detecta falha silenciosa e grava WAV (taxa nativa e 16 kHz mono).
'use strict';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const fontes = {};        // 'mic' | 'sistema' -> estado da captura
let gravacao = null;      // { timer, fim, fontes } durante o "Gravar 30 s"
let tom = null;           // { ctx, osc } enquanto o tom de teste toca
let tomIniciadoEm = 0;    // performance.now() do início do tom; zera quando o loopback o detecta
let avisoAtual = '';

// Cópia de renderer/pcm-worklet.js (a fonte canônica) para o fallback por Blob URL.
// Alterou o arquivo? Copie aqui também.
const WORKLET_FONTE = `// Repassa ao main thread os blocos Float32 que chegam (um array por canal), em lotes de
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
`;

const hora = () => new Date().toISOString().slice(11, 23);

function log(msg) {
  const el = $('#log');
  el.textContent = `${hora()} ${msg}\n${el.textContent.slice(0, 30000)}`;
  window.prova.log(msg);
}

// ---------- captura ----------

async function iniciarMic() {
  const status = await window.prova.micStatus();
  log(`mic: getMediaAccessStatus = ${status}`);
  if (status === 'not-determined') log(`mic: askForMediaAccess -> ${await window.prova.askMic()}`);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  await ligarFonte('mic', stream);
  atualizarStatusMic();
}

async function iniciarSistema() {
  const audio = $('#restrict').checked ? { restrictOwnAudio: true } : true;
  log(`sistema: getDisplayMedia({video:false, audio:${JSON.stringify(audio)}})`);
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio });
  for (const v of stream.getVideoTracks()) {
    log(`sistema: veio trilha de vídeo "${v.label}"; parada e removida`);
    v.stop();
    stream.removeTrack(v);
  }
  await ligarFonte('sistema', stream);
}

async function ligarFonte(nome, stream) {
  pararFonte(nome);
  const track = stream.getAudioTracks()[0];
  if (!track) { log(`${nome}: stream sem trilha de áudio`); return; }
  const settings = track.getSettings();
  // AudioContext na taxa da trilha, para o WAV "nativo" sair sem reamostragem do WebAudio.
  const ctx = settings.sampleRate ? new AudioContext({ sampleRate: settings.sampleRate }) : new AudioContext();
  const agora = performance.now();
  const f = {
    nome, stream, track, ctx, sr: ctx.sampleRate, settings,
    soma2: 0, n: 0, pico: 0, ultimoSom: agora, blocos: 0, rec: null, eventos: [],
    painel: $(`#painel-${nome}`),
  };
  fontes[nome] = f;
  $('.eventos', f.painel).textContent = '';
  for (const tipo of ['ended', 'mute', 'unmute']) track.addEventListener(tipo, () => eventoTrilha(f, tipo));
  log(`${nome}: trilha "${track.label}" readyState=${track.readyState} muted=${track.muted} settings=${JSON.stringify(settings)} ctx.sampleRate=${ctx.sampleRate}`);
  if (track.readyState === 'ended') eventoTrilha(f, 'ended (já nasceu assim)');

  try {
    await carregarWorklet(nome, ctx);
  } catch (e) {
    pararFonte(nome);
    throw e;
  }
  const src = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, 'pcm-repasse');
  node.port.onmessage = (e) => receberBloco(f, e.data.canais);
  src.connect(node);
  node.connect(ctx.destination); // saída silenciosa; ligar ao destino garante que o worklet seja processado
  await ctx.resume();
  f.src = src;
  f.node = node;
  mostrarSettings(f);
}

// Primeiro pela URL do arquivo; se o file:// recusar, por Blob URL com a cópia embutida.
async function carregarWorklet(nome, ctx) {
  try {
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    log(`${nome}: addModule: url (${location.protocol}//)`);
    return;
  } catch (e) {
    log(`${nome}: addModule pela URL FALHOU em ${location.protocol}// — ${e.name}: ${e.message}; tentando Blob`);
  }
  const url = URL.createObjectURL(new Blob([WORKLET_FONTE], { type: 'text/javascript' }));
  try {
    await ctx.audioWorklet.addModule(url);
    log(`${nome}: addModule: blob`);
  } catch (e) {
    log(`${nome}: addModule pelo Blob também FALHOU — ${e.name}: ${e.message}`);
    throw e;
  }
}

function pararFonte(nome) {
  const f = fontes[nome];
  if (!f) return;
  delete fontes[nome];
  if (f.node) f.node.port.onmessage = null;
  for (const t of f.stream.getTracks()) t.stop();
  f.ctx.close();
  $('.estado', f.painel).textContent = 'parado';
  $('.db', f.painel).textContent = '—';
  $('.barra div', f.painel).style.width = '0';
  log(`${nome}: parado`);
}

function pararTudo() {
  if (gravacao) {
    clearInterval(gravacao.timer);
    for (const f of gravacao.fontes) f.rec = null;
    gravacao = null;
    $('#gravacao').textContent = '';
    log('gravar: cancelado pelo Parar');
  }
  for (const nome of Object.keys(fontes)) pararFonte(nome);
  mostrarAviso('');
}

function eventoTrilha(f, tipo) {
  f.eventos.unshift(`${hora()} ${tipo}`);
  $('.eventos', f.painel).textContent = f.eventos.join('\n');
  log(`${f.nome}: evento ${tipo} (readyState=${f.track.readyState}, muted=${f.track.muted})`);
  mostrarSettings(f);
}

function mostrarSettings(f) {
  // getSettings() de novo: deviceId/sampleRate podem mudar quando a saída padrão troca.
  f.settings = f.track.getSettings();
  $('.settings', f.painel).textContent = `label: ${f.track.label}\ngetSettings(): ${JSON.stringify(f.settings, null, 1)}`;
  $('.ctx', f.painel).textContent = `${f.ctx.sampleRate} Hz`;
}

// ---------- blocos do worklet: nível, falha silenciosa, latência, gravação ----------

function receberBloco(f, canais) {
  const n = canais[0].length;
  let pico = 0;
  for (const c of canais) {
    for (let i = 0; i < n; i++) {
      const v = c[i];
      f.soma2 += v * v;
      const a = v < 0 ? -v : v;
      if (a > pico) pico = a;
    }
  }
  f.n += n * canais.length;
  f.blocos++;
  if (pico > f.pico) f.pico = pico;
  if (pico > 0) f.ultimoSom = performance.now();
  if (f.blocos === 1) log(`${f.nome}: primeiro bloco do worklet: ${canais.length} canal(is), ${n} quadros, ${f.sr} Hz`);

  // Latência aproximada do loopback: do início do tom até o primeiro bloco com sinal.
  if (f.nome === 'sistema' && tomIniciadoEm && pico > 0.02) {
    log(`sistema: tom detectado no loopback ${(performance.now() - tomIniciadoEm).toFixed(0)} ms após o início (aprox.)`);
    tomIniciadoEm = 0;
  }
  if (f.rec) f.rec.push(canais);
}

// 10x por segundo: readyState, RMS/dBFS da janela de 100 ms e detector de falha silenciosa.
setInterval(() => {
  for (const f of Object.values(fontes)) {
    const rms = f.n ? Math.sqrt(f.soma2 / f.n) : 0;
    const db = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
    const pct = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    $('.estado', f.painel).textContent = f.track.readyState;
    $('.barra div', f.painel).style.width = `${pct}%`;
    $('.db', f.painel).textContent = `RMS ${rms.toFixed(5)} · ${Number.isFinite(db) ? db.toFixed(1) : '-∞'} dBFS · pico ${f.pico.toFixed(4)}`;
    f.soma2 = 0; f.n = 0; f.pico = 0;
  }
  verificarFalhaSilenciosa();
}, 100);

function verificarFalhaSilenciosa() {
  const s = fontes.sistema;
  let aviso = '';
  if (s && s.track.readyState === 'ended') {
    aviso = 'possível permissão negada: trilha do sistema em "ended"';
  } else if (s && s.track.readyState === 'live' && performance.now() - s.ultimoSom >= 3000) {
    aviso = 'possível permissão negada: trilha do sistema "live" com RMS zero absoluto há 3 s';
  }
  if (aviso !== avisoAtual) {
    if (aviso) log(`AVISO ${aviso}`);
    else if (avisoAtual) log('aviso de falha silenciosa sumiu');
    mostrarAviso(aviso);
  }
}

function mostrarAviso(texto) {
  avisoAtual = texto;
  $('#aviso').textContent = texto;
  $('#aviso').style.display = texto ? 'block' : 'none';
}

// ---------- gravação de 30 s ----------

function gravar20s() {
  const ativas = Object.values(fontes);
  if (!ativas.length) return log('gravar: nenhuma fonte ativa');
  if (gravacao) return log('gravar: já está gravando');
  for (const f of ativas) f.rec = [];
  const fim = performance.now() + 30000;
  log(`gravar: 30 s de ${ativas.map((f) => f.nome).join(' + ')}`);
  gravacao = {
    fim, fontes: ativas,
    timer: setInterval(() => {
      const falta = Math.max(0, (fim - performance.now()) / 1000);
      $('#gravacao').textContent = `gravando… ${falta.toFixed(0)} s`;
      if (falta > 0) return;
      clearInterval(gravacao.timer);
      gravacao = null;
      $('#gravacao').textContent = 'salvando…';
      Promise.all(ativas.map(salvarFonte))
        .catch((e) => log(`gravar: erro ao salvar — ${e.message}`))
        .finally(() => { $('#gravacao').textContent = ''; });
    }, 250),
  };
}

async function salvarFonte(f) {
  const blocos = f.rec;
  f.rec = null;
  if (!blocos || !blocos.length) { log(`${f.nome}: nada gravado (nenhum bloco chegou do worklet)`); return; }
  const nCanais = Math.max(...blocos.map((b) => b.length));
  const total = blocos.reduce((s, b) => s + b[0].length, 0);
  const canais = Array.from({ length: nCanais }, () => new Float32Array(total));
  let off = 0;
  for (const b of blocos) {
    for (let c = 0; c < nCanais; c++) canais[c].set(b[c] ?? b[0], off);
    off += b[0].length;
  }

  // 1) como veio: taxa e canais nativos, Int16 intercalado
  const nativo = new Int16Array(total * nCanais);
  for (let i = 0; i < total; i++) for (let c = 0; c < nCanais; c++) nativo[i * nCanais + c] = paraInt16(canais[c][i]);
  const arq1 = await window.prova.saveWav({ name: `${f.nome}-${f.sr}hz-${nCanais}ch`, sampleRate: f.sr, channels: nCanais, int16: nativo.buffer });

  // 2) 16 kHz mono Int16 (média dos canais + passa-baixa + decimação)
  const mono = new Float32Array(total);
  for (let c = 0; c < nCanais; c++) for (let i = 0; i < total; i++) mono[i] += canais[c][i] / nCanais;
  const r16 = Int16Array.from(reamostrar16k(mono, f.sr), paraInt16);
  const arq2 = await window.prova.saveWav({ name: `${f.nome}-16000hz-1ch`, sampleRate: 16000, channels: 1, int16: r16.buffer });

  log(`${f.nome}: ${(total / f.sr).toFixed(2)} s gravados -> ${arq1} | ${arq2}`);
}

function paraInt16(v) {
  const x = v > 1 ? 1 : v < -1 ? -1 : v;
  return Math.round(x < 0 ? x * 0x8000 : x * 0x7fff);
}

// FIR passa-baixa (sinc com janela de Blackman, 127 coeficientes, corte em 7 kHz) avaliado
// só nas posições de saída; posição fracionária (ex.: 44,1 kHz) usa interpolação linear.
function reamostrar16k(x, srEntrada) {
  const srSaida = 16000;
  if (srEntrada === srSaida) return x;
  const N = 127;
  const M = (N - 1) / 2;
  const fc = Math.min(7000, 0.45 * srEntrada) / srEntrada;
  const h = new Float64Array(N);
  let soma = 0;
  for (let k = 0; k < N; k++) {
    const t = k - M;
    const sinc = t === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * t) / (Math.PI * t);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (N - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (N - 1));
    h[k] = sinc * w;
    soma += h[k];
  }
  for (let k = 0; k < N; k++) h[k] /= soma; // ganho unitário em DC

  const filtrado = (i) => {
    let acc = 0;
    for (let k = 0; k < N; k++) {
      const j = i + k - M;
      if (j >= 0 && j < x.length) acc += h[k] * x[j];
    }
    return acc;
  };
  const passo = srEntrada / srSaida;
  const nSaida = Math.floor(x.length / passo);
  const y = new Float32Array(nSaida);
  for (let n = 0; n < nSaida; n++) {
    const pos = n * passo;
    const i = Math.floor(pos);
    const fr = pos - i;
    y[n] = fr === 0 ? filtrado(i) : filtrado(i) * (1 - fr) + filtrado(i + 1) * fr;
  }
  return y;
}

// ---------- tom de teste (teste 5): toca pelo próprio app ----------

function alternarTom() {
  if (tom) {
    tom.osc.stop();
    tom.ctx.close();
    tom = null;
    tomIniciadoEm = 0;
    $('#btn-tom').textContent = 'Tocar tom de teste';
    log('tom: parado');
    return;
  }
  const ctx = new AudioContext();
  const osc = ctx.createOscillator();
  const ganho = ctx.createGain();
  osc.frequency.value = 440;
  ganho.gain.value = 0.2;
  osc.connect(ganho).connect(ctx.destination);
  osc.start();
  tom = { ctx, osc };
  const s = fontes.sistema;
  tomIniciadoEm = s ? performance.now() : 0; // só mede latência com a captura já ativa
  $('#btn-tom').textContent = 'Parar tom';
  log(`tom: 440 Hz tocando pelo app; captura do sistema ${s ? `ativa, deviceId=${s.track.getSettings().deviceId}` : 'não está ativa'}`);
}

// ---------- botões e estado inicial ----------

async function atualizarStatusMic() {
  $('#mic-status').textContent = await window.prova.micStatus();
}

function botao(id, fn) {
  $(id).addEventListener('click', async () => {
    try { await fn(); } catch (e) { log(`ERRO (${id}): ${e.name}: ${e.message}`); }
  });
}

botao('#btn-mic', iniciarMic);
botao('#btn-sistema', iniciarSistema);
botao('#btn-ambos', async () => {
  // uma fonte falhar não impede a outra
  for (const [nome, fn] of [['mic', iniciarMic], ['sistema', iniciarSistema]]) {
    try { await fn(); } catch (e) { log(`ERRO (${nome}): ${e.name}: ${e.message}`); }
  }
});
botao('#btn-parar', pararTudo);
botao('#btn-gravar', gravar20s);
botao('#btn-tom', alternarTom);
$('#restrict').addEventListener('change', (e) => log(`restrictOwnAudio = ${e.target.checked} (vale na próxima captura do sistema)`));

// Troca de dispositivo (teste 3): só registra o momento, para cruzar com os eventos da trilha.
navigator.mediaDevices.addEventListener('devicechange', () => {
  log('devicechange');
  for (const f of Object.values(fontes)) mostrarSettings(f);
});

(async () => {
  const sup = navigator.mediaDevices.getSupportedConstraints();
  $('#suporte').textContent = `restrictOwnAudio suportado: ${!!sup.restrictOwnAudio}`;
  log(`início: ${location.href} · userAgent=${navigator.userAgent} · restrictOwnAudio suportado=${!!sup.restrictOwnAudio}`);
  await atualizarStatusMic();
  log(`mic: getMediaAccessStatus no início (sem diálogo) = ${$('#mic-status').textContent}`);
})();
