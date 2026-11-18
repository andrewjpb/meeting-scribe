// LAP Reuniões — Quem fala no Meet (contrato 27, CA1): junta o que o `content.js` vê e manda ao app, a cada ~1 s,
// por POST em http://127.0.0.1:<porta>/v1/eventos. Só fala com 127.0.0.1: nada sai do computador. O app responde
// só `{ ok: true }` e nunca manda nada de volta. Sem resposta do app, guarda os eventos por até 60 s e descarta o
// que passar disso.
'use strict'

/** Portas que o app pode usar, na ordem em que ele tenta. */
const PORTS = [47632, 47633, 47634, 47635, 47636, 47637, 47638, 47639, 47640, 47641]
const PATH = '/v1/eventos'
const FLUSH_MS = 1000
/** Eventos sem entrega há mais que isto são descartados. */
const KEEP_MS = 60_000
/** Limites do app por envio. */
const EVENTS_PER_POST = 200
const PARTICIPANTS_MAX = 100
const NAME_MAX = 80
/** Cada porta tem este prazo para responder. */
const REQUEST_TIMEOUT_MS = 1500
/** App fechado: espera isto antes de procurar de novo nas 10 portas. */
const RETRY_MS = 5000
/** Sem mensagem da aba do Meet há mais que isto, não manda mais o "ainda conectado". */
const TAB_SILENT_MS = 5000

/** Porta que respondeu por último (`null`: procura de novo na ordem). */
let port = null
let meeting = null
let participants = []
/** Eventos ainda não entregues, com o horário da chegada aqui. */
let queue = []
let lastMessageAt = 0
let sending = false
let retryAt = 0

const cleanName = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim() : '')

chrome.runtime.onMessage.addListener((message, sender) => {
  // Só o nosso `content.js`, de uma aba do Meet.
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url || !sender.url.startsWith('https://meet.google.com/')) return
  if (!message || message.tipo !== 'meet' || typeof message.reuniao !== 'string' || !Array.isArray(message.participantes) || !Array.isArray(message.eventos)) return
  const now = Date.now()
  lastMessageAt = now
  meeting = message.reuniao.slice(0, 200)
  participants = message.participantes.map(cleanName).filter(Boolean).slice(0, PARTICIPANTS_MAX)
  for (const event of message.eventos) {
    const nome = cleanName(event && event.nome)
    if (!nome || typeof event.falando !== 'boolean' || typeof event.ts !== 'number' || !Number.isFinite(event.ts)) continue
    queue.push({ nome, falando: event.falando, ts: event.ts, at: now })
  }
})

async function post(candidate, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`http://127.0.0.1:${candidate}${PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
    if (!response.ok) return false
    const reply = await response.json().catch(() => null)
    return Boolean(reply && reply.ok === true)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function flush() {
  if (sending || !meeting) return
  const now = Date.now()
  // Guarda até 60 s; o resto é descartado.
  queue = queue.filter((event) => now - event.at <= KEEP_MS)
  const tabAlive = now - lastMessageAt <= TAB_SILENT_MS
  if (!queue.length && !tabAlive) return
  if (now < retryAt) return
  sending = true
  try {
    const batch = queue.slice(0, EVENTS_PER_POST)
    const body = JSON.stringify({ reuniao: meeting, participantes: participants, eventos: batch.map(({ nome, falando, ts }) => ({ nome, falando, ts })) })
    const order = port === null ? PORTS : [port, ...PORTS.filter((candidate) => candidate !== port)]
    for (const candidate of order) {
      if (await post(candidate, body)) {
        port = candidate
        retryAt = 0
        // Só sai da fila o que foi entregue (o que chegou durante o envio fica).
        queue = queue.filter((event) => !batch.includes(event))
        return
      }
    }
    port = null
    retryAt = Date.now() + RETRY_MS
  } finally {
    sending = false
  }
}

setInterval(() => void flush(), FLUSH_MS)
