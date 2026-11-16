import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './design/base.css'
import { App } from './app/App'
import { loadBranding } from './app/brandingStore'
import { loadSettings } from './app/settingsStore'
import { applyInitialAppearance } from './app/themeStore'
import { loadCaptureEnvironment } from './audio/environment'
import { exposeRecordingProbe } from './features/live/recordingStore'

// Tema antes do primeiro quadro, para não piscar o tema errado.
applyInitialAppearance()

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root ausente em index.html')
const container = root

// A gravação precisa saber, antes do primeiro clique, se capta de verdade ou usa o sinal do smoke.
// Se falhar, "Nova gravação" mostra o aviso com "Tentar de novo" (recordingStore). As configurações
// gravadas e a marca (nome e logo da barra lateral) chegam junto, e o tema é reaplicado com a aparência escolhida.
const capture = loadCaptureEnvironment()
  .then(exposeRecordingProbe)
  .catch(() => undefined)
void Promise.all([capture, loadSettings(), loadBranding()])
  .then(applyInitialAppearance)
  .finally(() => {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  })
