// Esquema `scribe://` que serve o renderer em produção. Origem fixa `scribe://app`: contexto
// seguro (OPFS e AudioWorklet funcionam) e a mesma origem que os filtros de permissão comparam.
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { protocol, type Session } from 'electron'
import { buildCsp } from './security'

export const APP_SCHEME = 'scribe'
export const APP_HOST = 'app'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
}

/** Precisa rodar antes de `app.whenReady()`. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
    },
  ])
}

/**
 * Caminho do arquivo pedido dentro de `root`, ou `null` se a URL não for do app ou tentar sair
 * da pasta (`..`, barra invertida codificada etc.).
 */
export function resolveAssetPath(requestUrl: string, root: string): string | null {
  let url: URL
  try {
    url = new URL(requestUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const base = normalize(root.endsWith(sep) ? root : root + sep)
  const full = normalize(join(base, relative))
  return full.startsWith(base) ? full : null
}

export function mimeOf(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export function handleAppScheme(ses: Session, root: string): void {
  const csp = buildCsp('production')
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAssetPath(request.url, root)
    if (!file) return new Response(null, { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': mimeOf(file),
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-cache',
        },
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}
