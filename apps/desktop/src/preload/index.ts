// Ponte entre renderer e main. Roda com sandbox: só `electron` e o código empacotado aqui.
// Expõe apenas `window.__scribeApi`, e só para os canais declarados em `shared/ipc.ts`.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EMAIL_PRELOAD_ONLY_EVENTS,
  INVOKE_CHANNELS,
  MAIN_EVENT_CHANNELS,
  PRELOAD_ONLY_EVENTS,
  RECORDING_SESSION_CHANNELS,
  RENDERER_EVENT_CHANNELS,
  type RecordingSessionTag,
  type CspViolation,
  type ScribeApi,
} from '../shared/ipc'

function assertChannel(allowed: readonly string[], channel: string): void {
  if (!allowed.includes(channel)) throw new Error(`Canal não permitido: ${channel}`)
}

const api: ScribeApi = {
  invoke(channel, ...args) {
    assertChannel(INVOKE_CHANNELS, channel)
    return ipcRenderer.invoke(channel, ...args)
  },
  invokeInSession(token, channel, request) {
    assertChannel(RECORDING_SESSION_CHANNELS, channel)
    const tag: RecordingSessionTag = { recordingSession: token }
    return ipcRenderer.invoke(channel, request, tag)
  },
  send(channel, payload) {
    assertChannel(RENDERER_EVENT_CHANNELS, channel)
    if (PRELOAD_ONLY_EVENTS.includes(channel) || EMAIL_PRELOAD_ONLY_EVENTS.includes(channel)) throw new Error(`Canal não permitido: ${channel}`)
    ipcRenderer.send(channel, payload)
  },
  // Contrato 24, CA4: o token de clique nasce aqui, só com a ativação do usuário viva (um clique ou tecla de
  // verdade nos últimos segundos; `element.click()` de um script não conta), e vai ao main antes do pedido.
  whatsappSend(request) {
    if (!navigator.userActivation.isActive) return Promise.resolve({ ok: false, error: 'click' })
    const clickToken = crypto.randomUUID()
    ipcRenderer.send('scribe:whatsapp-click', clickToken)
    // Contrato 34: a resposta leva o id da mensagem citada.
    return ipcRenderer.invoke('scribe:whatsapp-send', { chatId: request.chatId, text: request.text, ...(request.replyToId ? { replyToId: request.replyToId } : {}), clickToken })
  },
  // Contrato 39: o anexo sai pelo mesmo caminho: a mesma ativação viva, o mesmo token e o mesmo guarda no main.
  whatsappSendMedia(request) {
    if (!navigator.userActivation.isActive) return Promise.resolve({ ok: false, error: 'click' })
    const clickToken = crypto.randomUUID()
    ipcRenderer.send('scribe:whatsapp-click', clickToken)
    const { chatId, name, mime, bytes, caption } = request
    return ipcRenderer.invoke('scribe:whatsapp-send-media', { chatId, name, mime, bytes, ...(caption ? { caption } : {}), clickToken })
  },
  // Contrato 34: reagir é envio: a mesma ativação viva, um token novo e o mesmo guarda no main.
  whatsappReact(request) {
    if (!navigator.userActivation.isActive) return Promise.resolve({ ok: false, error: 'click' })
    const clickToken = crypto.randomUUID()
    ipcRenderer.send('scribe:whatsapp-click', clickToken)
    return ipcRenderer.invoke('scribe:whatsapp-react', { chatId: request.chatId, messageId: request.messageId, emoji: request.emoji, clickToken })
  },
  // Contrato 42: o envio do email pelo mesmo caminho: a mesma ativação viva e um token de clique próprio.
  emailSend(request) {
    if (!navigator.userActivation.isActive) return Promise.resolve({ ok: false, error: 'click' })
    const clickToken = crypto.randomUUID()
    ipcRenderer.send('scribe:email-click', clickToken)
    const { accountId, to, subject, text, inReplyTo } = request
    return ipcRenderer.invoke('scribe:email-send', { accountId, to, subject, text, ...(inReplyTo ? { inReplyTo } : {}), clickToken })
  },
  on(channel, listener) {
    assertChannel(MAIN_EVENT_CHANNELS, channel)
    const wrapped = (_event: IpcRendererEvent, payload: Parameters<typeof listener>[0]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },
}

contextBridge.exposeInMainWorld('__scribeApi', api)

// Violação de CSP vai para o main, que registra (e o smoke reprova).
document.addEventListener('securitypolicyviolation', (event) => {
  const report: CspViolation = {
    directive: event.effectiveDirective,
    blockedUri: event.blockedURI,
    sourceFile: event.sourceFile,
  }
  ipcRenderer.send('scribe:csp-violation', report)
})
