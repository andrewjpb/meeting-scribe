// Ponte mínima entre a página e o processo principal (contextIsolation ligado).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prova', {
  micStatus: () => ipcRenderer.invoke('mic-status'),
  askMic: () => ipcRenderer.invoke('ask-mic'),
  // dados = { name, sampleRate, channels, int16: ArrayBuffer }; devolve o caminho gravado
  saveWav: (dados) => ipcRenderer.invoke('save-wav', dados),
  log: (msg) => ipcRenderer.send('log', String(msg)),
});
