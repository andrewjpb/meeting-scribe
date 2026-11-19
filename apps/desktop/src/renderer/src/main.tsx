import './design/base.css'

// Contrato 48: a mesma entrada serve a janela do aviso de reunião (`?janela=aviso`), que carrega só o componente
// dele: sem o app, sem a camada de bloqueio e sem os stores da gravação. Qualquer outro valor é a janela principal.
if (new URLSearchParams(window.location.search).get('janela') === 'aviso') void import('./features/meeting-prompt/boot')
else void import('./app/boot')
