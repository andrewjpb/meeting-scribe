// Política de segurança da janela: funções puras de decisão (testadas em test/security.test.ts)
// e a ligação delas na sessão e em cada webContents.
import type { Session, WebContents } from 'electron'

export const APP_ORIGIN = 'scribe://app'

/**
 * Origem de uma URL no formato do Chromium. O `URL.origin` do Node devolve "null" para
 * esquemas próprios, então `scribe://app/index.html` vira `scribe://app` aqui à mão.
 */
export function originOf(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.origin
  if (!parsed.host) return null
  return `${parsed.protocol}//${parsed.host}`
}

export interface PermissionQuery {
  permission: string
  origin: string | null
  mediaTypes: readonly string[]
}

/** Só a própria origem recebe microfone (apenas áudio) e captura do áudio do sistema. */
export function decidePermission(query: PermissionQuery, appOrigin: string): boolean {
  if (query.origin === null || query.origin !== appOrigin) return false
  if (query.permission === 'display-capture') return true
  if (query.permission === 'media') {
    return query.mediaTypes.length > 0 && query.mediaTypes.every((type) => type === 'audio')
  }
  return false
}

/**
 * Checagem de permissão (sem diálogo). O Chromium consulta `media` com `mediaType: 'unknown'` ao
 * listar dispositivos e ao liberar os rótulos deles; da própria origem isso passa. O pedido de
 * verdade continua em `decidePermission`, que só concede áudio.
 */
export function decidePermissionCheck(query: PermissionQuery, appOrigin: string): boolean {
  if (query.origin === null || query.origin !== appOrigin) return false
  if (query.permission === 'media' && query.mediaTypes.length === 1 && query.mediaTypes[0] === 'unknown') return true
  return decidePermission(query, appOrigin)
}

/** Navegação só dentro da própria origem; qualquer outra é cancelada. */
export function decideNavigation(targetUrl: string, appOrigin: string): 'allow' | 'deny' {
  return originOf(targetUrl) === appOrigin ? 'allow' : 'deny'
}

/** O app tem uma janela só: pedido de janela nova é sempre negado. */
export function decideWindowOpen(_url: string): { action: 'deny' } {
  return { action: 'deny' }
}

export type CspMode = 'production' | 'development'

/**
 * CSP do renderer. Em produção tudo vem da própria origem; em desenvolvimento o servidor do
 * Vite precisa de script inline (preâmbulo do React) e de WebSocket para o recarregamento.
 */
export function buildCsp(mode: CspMode, devOrigin?: string): string {
  if (mode === 'production') {
    return [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "font-src 'self'",
      "img-src 'self' data:",
      // Única saída do renderer: a transcrição ao vivo vai direto para a AssemblyAI (CA13).
      "connect-src 'self' wss://streaming.assemblyai.com",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ')
  }
  const ws = devOrigin ? devOrigin.replace(/^http/, 'ws') : ''
  return [
    `default-src 'self' ${devOrigin ?? ''}`.trim(),
    `script-src 'self' 'unsafe-inline' ${devOrigin ?? ''}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' wss://streaming.assemblyai.com ${devOrigin ?? ''} ${ws}`.trim(),
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ')
}

/** Permissões e cabeçalhos da sessão. Chamar uma vez, antes de criar a janela. */
export function applySessionSecurity(ses: Session, appOrigin: string, mode: CspMode): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details && Array.isArray(details.mediaTypes) ? details.mediaTypes : []
    callback(decidePermission({ permission, origin: originOf(details.requestingUrl), mediaTypes }, appOrigin))
  })

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) => {
    const origin = originOf(details.requestingUrl ?? requestingOrigin) ?? originOf(requestingOrigin)
    const mediaTypes = details.mediaType ? [details.mediaType] : []
    return decidePermissionCheck({ permission, origin, mediaTypes }, appOrigin)
  })

  // Em produção o protocolo `scribe://` já devolve a CSP; aqui cobre o servidor do Vite.
  if (mode === 'development') {
    const csp = buildCsp('development', appOrigin)
    ses.webRequest.onHeadersReceived((details, callback) => {
      if (originOf(details.url) !== appOrigin) return callback({ responseHeaders: details.responseHeaders ?? {} })
      callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
  }
}

/** Trava de navegação de um webContents: outra origem, janela nova e `<webview>` são negados. */
export function guardWebContents(contents: WebContents, appOrigin: string): void {
  const block = (event: { preventDefault(): void }, url: string): void => {
    if (decideNavigation(url, appOrigin) === 'deny') event.preventDefault()
  }
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
  contents.on('will-attach-webview', (event) => event.preventDefault())
  contents.setWindowOpenHandler(({ url }) => decideWindowOpen(url))
}
