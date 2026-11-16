// Teste 12 (AssemblyAI): sessão de streaming v3 com um WAV 16 kHz mono, em ritmo real.
// Uso: ASSEMBLYAI_API_KEY=... node scripts/test-assemblyai.mjs out/<arquivo>-16000hz-1ch.wav
// Node 22, sem dependências (WebSocket global do Node; o undici aceita { headers } no 2º argumento).
import { readFileSync } from 'node:fs';

const chave = process.env.ASSEMBLYAI_API_KEY;
if (!chave) { console.error('defina ASSEMBLYAI_API_KEY'); process.exit(2); }
const arquivo = process.argv[2];
if (!arquivo) { console.error('uso: node scripts/test-assemblyai.mjs <arquivo 16 kHz mono .wav>'); process.exit(2); }

// Lê o WAV e confere que é PCM 16 bits, mono, 16 kHz (o que a URL abaixo declara).
function lerWav(caminho) {
  const b = readFileSync(caminho);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('não é WAV (RIFF/WAVE)');
  let fmt = null;
  let dados = null;
  for (let p = 12; p + 8 <= b.length;) {
    const id = b.toString('ascii', p, p + 4);
    const tam = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { formato: b.readUInt16LE(p + 8), canais: b.readUInt16LE(p + 10), taxa: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data') dados = b.subarray(p + 8, Math.min(p + 8 + tam, b.length));
    p += 8 + tam + (tam % 2);
  }
  if (!fmt || !dados) throw new Error('WAV sem bloco fmt ou data');
  if (fmt.formato !== 1 || fmt.bits !== 16 || fmt.canais !== 1 || fmt.taxa !== 16000) {
    throw new Error(`esperado PCM 16 bits mono 16000 Hz; veio formato=${fmt.formato} bits=${fmt.bits} canais=${fmt.canais} taxa=${fmt.taxa}`);
  }
  return dados;
}

let pcm;
try { pcm = lerWav(arquivo); } catch (e) { console.error(`${arquivo}: ${e.message}`); process.exit(2); }
const BYTES_FRAME = 16000 * 2 / 10; // 100 ms de s16le mono
console.log(`arquivo: ${arquivo} (${(pcm.length / 32000).toFixed(2)} s de áudio)`);

const params = new URLSearchParams({
  sample_rate: '16000',
  speech_model: 'universal-3-6-pro',
  speaker_labels: 'true',
  language_codes: 'pt',
  format_turns: 'true',
});
// Tradução em tempo real (opcional): AAI_LLM_GATEWAY='{"model":"...","prompt":"... {{turn}}"}'
if (process.env.AAI_LLM_GATEWAY) params.set('llm_gateway', process.env.AAI_LLM_GATEWAY);
const url = `wss://streaming.assemblyai.com/v3/ws?${params}`;
console.log(`conectando: ${url}`);

const t0 = Date.now();
let enviadoMs = 0; // quanto áudio já foi enviado, para comparar com os timestamps das palavras
const seg = () => `${((Date.now() - t0) / 1000).toFixed(1)}s | áudio enviado ${enviadoMs} ms`;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

const ws = new WebSocket(url, { headers: { Authorization: chave } });
let enviando = false;

// Frames binários de 100 ms em ritmo de tempo real (mais rápido que isso a API devolve erro 3007).
async function enviarAudio() {
  enviando = true;
  const inicio = Date.now();
  for (let i = 0, off = 0; off < pcm.length; i++, off += BYTES_FRAME) {
    await dormir(inicio + i * 100 - Date.now());
    if (ws.readyState !== WebSocket.OPEN) return;
    let frame = pcm.subarray(off, off + BYTES_FRAME);
    // último frame completado com silêncio: frames abaixo de 20 ms são recusados
    if (frame.length < BYTES_FRAME) { const cheio = Buffer.alloc(BYTES_FRAME); frame.copy(cheio); frame = cheio; }
    ws.send(frame);
    enviadoMs += 100;
  }
  console.log(`[${seg()}] fim do áudio; enviando Terminate`);
  ws.send(JSON.stringify({ type: 'Terminate' }));
  setTimeout(() => { console.log('sem Termination em 20 s; fechando'); ws.close(); }, 20000).unref();
}

ws.onopen = () => console.log(`[${seg()}] WebSocket aberto`);

ws.onmessage = (ev) => {
  let msg;
  try { msg = JSON.parse(ev.data); } catch { console.log(`[${seg()}] mensagem não JSON:`, ev.data); return; }
  switch (msg.type) {
    case 'Begin':
      console.log(`[${seg()}] Begin id=${msg.id} expires_at=${msg.expires_at}`);
      console.log('Begin.configuration =', JSON.stringify(msg.configuration ?? '(ausente)', null, 2));
      if (!msg.configuration) console.log('Begin completo =', JSON.stringify(msg));
      if (!enviando) enviarAudio();
      break;
    case 'Turn': {
      const p = msg.words ?? [];
      const a = p[0];
      const z = p[p.length - 1];
      const tipo = msg.end_of_turn ? (msg.turn_is_formatted ? 'FINAL' : 'final sem formatação') : 'parcial';
      console.log(`[${seg()}] Turn #${msg.turn_order} ${tipo} speaker_label=${msg.speaker_label ?? '-'} palavras=${p.length}` +
        ` 1ª start/end=${a?.start}/${a?.end} última start/end=${z?.start}/${z?.end} "${msg.transcript}"`);
      break;
    }
    case 'SpeakerRevision':
      console.log(`[${seg()}] SpeakerRevision`, JSON.stringify(msg));
      break;
    default:
      console.log(`[${seg()}] ${msg.type ?? '(sem type)'}`, JSON.stringify(msg));
  }
};

ws.onerror = (ev) => console.error(`[${seg()}] erro no WebSocket:`, ev.message ?? ev.error?.message ?? ev);
ws.onclose = (ev) => {
  console.log(`[${seg()}] fechado: code=${ev.code} reason="${ev.reason}"`);
  process.exit(ev.code === 1000 ? 0 : 1);
};
