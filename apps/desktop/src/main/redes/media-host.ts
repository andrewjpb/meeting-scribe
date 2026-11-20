// Teste do armazenamento de mídia (contrato 70; a interface veio do contrato 69): confere a configuração, sobe 1 byte
// para `instagram/_teste/<uuid>.txt`, lê de volta pela URL pública (sem assinatura, como a Meta vai ler) e apaga.
// `uploadMedia` e `removeMedia` são o que o contrato 71 usa para a mídia das publicações.
import { randomUUID } from 'node:crypto'
import type { HttpFetch } from '../accounts/http'
import type { MediaHostConfig } from '../../shared/redes'
import { fetchWithTimeout, RedesTimeoutError } from './hosts'
import { assertHost, createS3Client, mediaHostHosts, S3_ERRORS, safeKey, type S3Client, type S3PutResult } from './s3'

export interface MediaHostTestResult {
  ok: boolean
  detail: string
}

export type MediaHostTester = (config: MediaHostConfig, secretAccessKey: string, fetch: HttpFetch) => Promise<MediaHostTestResult>

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost'])
/** O byte do teste. */
const PROBE = new Uint8Array([0x31])

/** `https://`, ou `http://` só no próprio Mac (o smoke). `null` quando vale; senão o motivo. */
function urlProblem(value: string, label: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return `${label} não é um endereço válido`
  }
  if (parsed.username || parsed.password) return `${label} não pode ter usuário ou senha`
  if (parsed.protocol === 'https:') return null
  if (parsed.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(parsed.hostname)) return null
  return `${label} precisa começar com https://`
}

/** Contrato 69 (devolução): o que está errado na configuração, sem olhar a chave secreta; o Salvar usa também. */
export function mediaHostConfigProblem(config: MediaHostConfig): string | null {
  return (
    urlProblem(config.endpoint, 'O endpoint') ??
    urlProblem(config.publicBaseUrl, 'A URL pública base') ??
    (!config.bucket.trim() ? 'Falta o bucket' : null) ??
    (!config.region.trim() ? 'Falta a região' : null) ??
    (!config.accessKeyId.trim() ? 'Faltam as chaves de acesso' : null)
  )
}

function configProblem(config: MediaHostConfig, secretAccessKey: string): string | null {
  return mediaHostConfigProblem(config) ?? (!secretAccessKey ? 'Faltam as chaves de acesso' : null)
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index])

/**
 * Lê o objeto pela URL pública, sem assinatura: `null` quando voltou o byte; `timeout` quando passou do prazo (contrato
 * 69, devolução: 15 s com a leitura do corpo); senão o status (ou o motivo).
 */
async function publicReadProblem(url: string, hosts: readonly string[], fetch: HttpFetch): Promise<string | null> {
  try {
    assertHost(url, hosts)
  } catch {
    return S3_ERRORS.host
  }
  try {
    return await fetchWithTimeout(fetch, url, { method: 'GET', headers: {} }, async (response) => {
      if (response.status !== 200) return String(response.status)
      return sameBytes(await response.bytes(), PROBE) ? null : '200, com outro conteúdo'
    })
  } catch (error) {
    return error instanceof RedesTimeoutError ? 'timeout' : 'sem resposta'
  }
}

export const testMediaHost: MediaHostTester = async (config, secretAccessKey, fetch) => {
  const problem = configProblem(config, secretAccessKey)
  if (problem) return { ok: false, detail: `Configuração inválida: ${problem}` }
  const client = createS3Client(fetch, config, secretAccessKey)
  const key = safeKey(['instagram', '_teste', `${randomUUID()}.txt`])

  const put = await client.put(key, PROBE, 'text/plain')
  if (!put.ok) return { ok: false, detail: `Upload falhou: ${put.error}` }

  const read = await publicReadProblem(client.publicUrl(key), mediaHostHosts(config), fetch)
  if (read) {
    // O arquivo de teste não fica no bucket mesmo quando a leitura falha; o resultado é o da leitura.
    await client.delete(key)
    if (read === 'timeout') return { ok: false, detail: `Leitura pública falhou: ${S3_ERRORS.timeout}` }
    return { ok: false, detail: `O endereço público não devolveu o arquivo (status ${read}): confira a URL pública base e o acesso público do bucket` }
  }

  const removed = await client.delete(key)
  if (!removed.ok) return { ok: false, detail: `Não consegui apagar o arquivo de teste: ${removed.error ?? 'erro desconhecido'}` }
  return { ok: true, detail: 'Upload e leitura pública ok' }
}

/** Sobe a mídia de uma publicação; devolve a URL pública. */
export const uploadMedia = (client: S3Client, key: string, bytes: Uint8Array, contentType: string): Promise<S3PutResult> => client.put(key, bytes, contentType)

/** Apaga a mídia depois da publicação (404 conta como apagada). */
export const removeMedia = (client: S3Client, key: string): Promise<{ ok: boolean; error?: string }> => client.delete(key)
