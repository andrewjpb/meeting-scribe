// Contrato 48 (aviso-reuniao): a janela do aviso de reunião (`?janela=aviso`). Monta só o aviso: sem o app, sem a
// camada de bloqueio e sem os stores da gravação. O tema vem do main na URL quando a pessoa escolheu claro ou
// escuro; sem ele, segue o macOS (e a troca dele). A janela é transparente: o fundo da página também.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { parseForcedTheme, resolveTheme } from '../../app/theme'
import { MeetingPrompt } from './MeetingPrompt'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const applyTheme = (): void => {
  document.documentElement.dataset['theme'] = resolveTheme('system', media.matches, parseForcedTheme(window.location.search))
}
applyTheme()
media.addEventListener('change', applyTheme)
document.documentElement.classList.add('bg-transparent')

const root = document.getElementById('root')
if (!root) throw new Error('Elemento #root ausente em index.html')
createRoot(root).render(
  <StrictMode>
    <MeetingPrompt />
  </StrictMode>,
)
