// App de prova da fase 0 (descartável). Processo principal: permissões, loopback do sistema,
// status do microfone, gravação de WAV e log em arquivo.
const { app, BrowserWindow, session, systemPreferences, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

// Rodando pelo terminal, grava em prova/out. Empacotado, o executável fica em
// prova/dist/<nome>-darwin-<arch>/<nome>.app/Contents/MacOS/<nome>; sobe até prova/ para
// gravar no mesmo lugar. Se o .app foi movido para fora de dist/, cai no userData.
function resolverDirOut() {
  if (!app.isPackaged) return path.join(__dirname, 'out');
  const dist = path.resolve(process.execPath, '../../../../..');
  if (path.basename(dist) === 'dist') return path.join(path.dirname(dist), 'out');
  return path.join(app.getPath('userData'), 'out');
}

const DIR_OUT = resolverDirOut();
const ARQ_LOG = path.join(DIR_OUT, 'prova.log');
fs.mkdirSync(DIR_OUT, { recursive: true });

function registrar(origem, msg) {
  fs.appendFileSync(ARQ_LOG, `${new Date().toISOString()} [${origem}] ${msg}\n`);
}

let janela = null;

// Só a página file:// da própria janela recebe mic e áudio do sistema.
function ehPropria(wc, url) {
  return !!janela && wc === janela.webContents && typeof url === 'string' && url.startsWith('file://');
}

function configurarSessao() {
  const ses = session.defaultSession;

  // Pedido só de áudio (video:false) vira Core Audio Tap via 'loopback'; o resto é recusado.
  ses.setDisplayMediaRequestHandler((req, cb) => {
    const url = req.frame?.url ?? '';
    const origemOk = url.startsWith('file://') || String(req.securityOrigin).startsWith('file:');
    const ok = origemOk && !req.videoRequested && req.audioRequested;
    registrar('main', `displayMedia: origin=${req.securityOrigin} frame=${url} video=${req.videoRequested} audio=${req.audioRequested} gesto=${req.userGesture} -> ${ok ? "{audio:'loopback'}" : 'null'}`);
    if (ok) cb({ audio: 'loopback' });
    else cb(null);
  }, { useSystemPicker: false });

  ses.setPermissionRequestHandler((wc, permissao, cb, detalhes) => {
    const ok = (permissao === 'media' || permissao === 'display-capture') && ehPropria(wc, detalhes.requestingUrl);
    registrar('main', `permissionRequest: ${permissao} url=${detalhes.requestingUrl} tipos=${detalhes.mediaTypes ?? '-'} -> ${ok}`);
    cb(ok);
  });

  ses.setPermissionCheckHandler((wc, permissao, origem, detalhes) => {
    if (permissao !== 'media' && permissao !== 'display-capture') return false;
    const ok = ehPropria(wc, detalhes.requestingUrl ?? origem);
    registrar('main', `permissionCheck: ${permissao} origem=${origem} tipo=${detalhes.mediaType ?? '-'} -> ${ok}`);
    return ok;
  });
}

// WAV PCM 16 bits little-endian: cabeçalho RIFF de 44 bytes + amostras intercaladas.
function montarWav(sampleRate, channels, pcm) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);                       // tamanho do bloco fmt
  h.writeUInt16LE(1, 20);                        // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * 2, 28); // byte rate
  h.writeUInt16LE(channels * 2, 32);             // block align
  h.writeUInt16LE(16, 34);                       // bits por amostra
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function configurarIpc() {
  ipcMain.handle('mic-status', () => systemPreferences.getMediaAccessStatus('microphone'));
  ipcMain.handle('ask-mic', () => systemPreferences.askForMediaAccess('microphone'));

  ipcMain.handle('save-wav', (_e, { name, sampleRate, channels, int16 }) => {
    const sr = Math.round(Number(sampleRate));
    const ch = Math.round(Number(channels));
    if (!(sr > 0) || !(ch >= 1 && ch <= 8)) throw new Error(`save-wav: sampleRate=${sampleRate} channels=${channels} inválidos`);
    const pcm = ArrayBuffer.isView(int16)
      ? Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength)
      : Buffer.from(int16);
    const carimbo = new Date().toISOString().replace(/[:.]/g, '-');
    const nome = String(name).replace(/[^\w.-]/g, '_');
    const arquivo = path.join(DIR_OUT, `${carimbo}-${nome}.wav`);
    fs.writeFileSync(arquivo, montarWav(sr, ch, pcm));
    registrar('main', `wav gravado: ${arquivo} (${sr} Hz, ${ch} canal(is), ${pcm.length} bytes)`);
    return arquivo;
  });

  ipcMain.on('log', (_e, msg) => registrar('renderer', String(msg)));
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Meeting Scribe — prova',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // janela em segundo plano não pode atrasar timers e medidores
    },
  });
  janela.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  janela.on('closed', () => { janela = null; });
}

app.whenReady().then(() => {
  registrar('main', `início: electron=${process.versions.electron} chrome=${process.versions.chrome} empacotado=${app.isPackaged} exec=${process.execPath} out=${DIR_OUT}`);
  registrar('main', `mic (getMediaAccessStatus, sem diálogo): ${systemPreferences.getMediaAccessStatus('microphone')}`);
  configurarSessao();
  configurarIpc();
  criarJanela();
});

app.on('window-all-closed', () => app.quit());
