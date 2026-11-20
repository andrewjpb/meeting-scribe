// Comentários do Instagram (contrato 73, R5 e CA10 da spec redes-instagram): a leitura das 25 mídias mais recentes e dos
// comentários de cada uma, a mescla com o que já está guardado (o `read` de cada comentário fica; o novo chega `false`,
// menos o da própria conta) e as mudanças locais depois de responder, ocultar e excluir. Tudo vai para
// `instagram-<id>.comments.json` pela fila de escrita da conta (`store.ts`); a leitura da API roda fora da fila e só a
// mescla com o que está no arquivo entra nela, uma por vez por conta: marcar como lida no meio de uma atualização não se
// perde. A miniatura é baixada só dos servidores de imagem da Meta, só JPEG, para `thumbs/<mediaId>.jpg`.
import { chmod, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { HttpFetch } from '../accounts/http'
import { COMMENTS_MEDIA_LIMIT, redesMediaWithCommentsSchema, type RedesAccount, type RedesComment, type RedesCommentsPayload, type RedesMediaWithComments } from '../../shared/redes'
import { fetchWithTimeout } from './hosts'
import type { InstagramClient, InstagramComment, InstagramMedia } from './instagram-client'
import type { RedesStore } from './store'

const FILE_VERSION = 1
/** A miniatura: até 8 MB (a `media_url` da imagem é a foto inteira). */
export const THUMB_MAX_BYTES = 8 * 1024 * 1024

const commentsFileSchema = z
  .object({
    version: z.literal(FILE_VERSION),
    updatedAt: z.iso.datetime({ offset: true }).nullable(),
    error: z.string().max(500).nullable(),
    media: z.array(redesMediaWithCommentsSchema),
  })
  .strict()
export type CommentsFile = z.output<typeof commentsFileSchema>

export const EMPTY_COMMENTS_FILE: Readonly<CommentsFile> = Object.freeze({ version: FILE_VERSION, updatedAt: null, error: null, media: [] })

const byTime = (a: { timestamp: string }, b: { timestamp: string }): number => a.timestamp.localeCompare(b.timestamp)

/** Os não lidos de uma lista de comentários, com as respostas. */
export function countUnread(comments: readonly RedesComment[]): number {
  return comments.reduce((sum, comment) => sum + (comment.read ? 0 : 1) + comment.replies.filter((reply) => !reply.read).length, 0)
}

/** O arquivo lido e validado; ausente ou inválido vale como vazio. */
export async function readComments(store: RedesStore, accountId: string): Promise<CommentsFile> {
  const parsed = commentsFileSchema.safeParse(await store.readComments(accountId))
  return parsed.success ? parsed.data : { ...EMPTY_COMMENTS_FILE, media: [] }
}

/** O que a tela recebe: só as mídias com comentário, da mais nova para a mais antiga, e o total de não lidos. */
export function commentsPayload(accountId: string, file: CommentsFile): RedesCommentsPayload {
  const media = file.media.filter((item) => item.comments.length > 0).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
  return { accountId, media, unread: media.reduce((sum, item) => sum + item.unread, 0), updatedAt: file.updatedAt, error: file.error }
}

// Uma mudança do arquivo por vez por conta (as do mesmo `store`): ler, mudar e gravar sem outra no meio.
const chains = new WeakMap<RedesStore, Map<string, Promise<unknown>>>()
/**
 * Lê o arquivo, aplica `change` e grava (sem o arquivo da conta, nada é gravado). `change` devolve `null` para não
 * gravar. Devolve o arquivo como ficou.
 */
export function updateComments(store: RedesStore, accountId: string, change: (file: CommentsFile) => CommentsFile | null): Promise<CommentsFile> {
  let perStore = chains.get(store)
  if (!perStore) {
    perStore = new Map()
    chains.set(store, perStore)
  }
  const map = perStore
  const task = async (): Promise<CommentsFile> => {
    const current = await readComments(store, accountId)
    const next = change(current)
    if (!next) return current
    const valid = commentsFileSchema.parse({ ...next, media: next.media.map((item) => ({ ...item, unread: countUnread(item.comments) })) })
    await store.writeComments(accountId, valid)
    return valid
  }
  const run = (map.get(accountId) ?? Promise.resolve()).then(task, task)
  const settled = run.catch(() => undefined)
  map.set(accountId, settled)
  void settled.then(() => {
    if (map.get(accountId) === settled) map.delete(accountId)
  })
  return run
}

/** O comentário é da própria conta (a resposta que a pessoa mandou daqui ou do Instagram): já nasce lido. */
const ownComment = (comment: InstagramComment, account: Pick<RedesAccount, 'id' | 'username'>): boolean => comment.fromId === account.id || (comment.username !== '' && comment.username === account.username)

/**
 * Os comentários de uma mídia como vieram da API, mesclados com os guardados: o `read` de cada um fica; o novo chega
 * `false` (o da própria conta, `true`). O que sumiu da API (excluído no Instagram) sai. `added` conta os novos não lidos.
 * Com `baseline` (a primeira atualização da conta), tudo o que já existia entra lido: só o que chegar depois é novo.
 */
export function mergeComments(mediaId: string, previous: readonly RedesComment[], incoming: readonly InstagramComment[], account: Pick<RedesAccount, 'id' | 'username'>, baseline = false): { comments: RedesComment[]; added: number } {
  const known = new Map<string, boolean>()
  for (const comment of previous) {
    known.set(comment.id, comment.read)
    for (const reply of comment.replies) known.set(reply.id, reply.read)
  }
  let added = 0
  const convert = (comment: InstagramComment, parentId: string | null): RedesComment => {
    const before = known.get(comment.id)
    const read = before ?? (baseline || ownComment(comment, account))
    if (before === undefined && !read) added++
    return {
      id: comment.id,
      mediaId,
      parentId,
      text: comment.text,
      username: comment.username,
      fromId: comment.fromId,
      timestamp: comment.timestamp,
      hidden: comment.hidden,
      likeCount: comment.likeCount,
      read,
      replies: parentId === null ? [...comment.replies].sort(byTime).map((reply) => convert(reply, comment.id)) : [],
    }
  }
  // Uma resposta que a API mande solta, com o comentário de cima na mesma lista, já está aninhada nele.
  const topIds = new Set(incoming.filter((comment) => comment.parentId === null).map((comment) => comment.id))
  const tops = incoming.filter((comment) => comment.parentId === null || !topIds.has(comment.parentId))
  const comments = [...tops].sort(byTime).map((comment) => convert(comment, null))
  return { comments, added }
}

/** A miniatura só dos servidores de imagem da Meta, por `https://`, sem usuário, senha nem porta. */
export function thumbnailUrlAllowed(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) return false
  const host = parsed.hostname
  return host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net')
}

/** Baixa a miniatura (só JPEG, até 8 MB) para `path` (0600). `false` se não deu (a tela mostra o ícone). */
export async function downloadThumbnail(fetch: HttpFetch, url: string, path: string): Promise<boolean> {
  if (!thumbnailUrlAllowed(url)) return false
  try {
    const bytes = await fetchWithTimeout(fetch, url, { method: 'GET', headers: { accept: 'image/jpeg' } }, async (response) => (response.status === 200 ? response.bytes() : null))
    if (!bytes || bytes.byteLength < 4 || bytes.byteLength > THUMB_MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return false
    await writeFile(path, bytes, { mode: 0o600 })
    await chmod(path, 0o600)
    return true
  } catch {
    await rm(path, { force: true }).catch(() => undefined)
    return false
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export interface SyncCommentsOptions {
  /** Com ele, a miniatura de cada mídia com comentário é baixada (uma vez) para `thumbs/`. */
  fetch?: HttpFetch
}

export type SyncCommentsResult = { ok: true; added: number; file: CommentsFile } | { ok: false; error: string; file: CommentsFile }

/**
 * Uma atualização da conta: as 25 mídias mais recentes e os comentários das que têm algum (cada falha de uma mídia
 * deixa a dela como estava). Devolve o arquivo gravado e quantos comentários novos (não lidos) chegaram.
 */
export async function syncComments(client: InstagramClient, token: string, account: Pick<RedesAccount, 'id' | 'username'>, store: RedesStore, now: number, options: SyncCommentsOptions = {}): Promise<SyncCommentsResult> {
  const recent = await client.recentMedia(token, account.id, COMMENTS_MEDIA_LIMIT)
  if (!recent.ok) {
    const error = recent.error
    const file = await updateComments(store, account.id, (current) => ({ ...current, error }))
    return { ok: false, error, file }
  }
  const media = recent.media.slice(0, COMMENTS_MEDIA_LIMIT)
  const fetched = new Map<string, InstagramComment[]>()
  let firstError: string | null = null
  for (const item of media) {
    if (!item.commentsCount) continue
    const result = await client.comments(token, item.id)
    if (result.ok) fetched.set(item.id, result.comments)
    else firstError ??= result.error
  }

  const thumbs = new Map<string, string>()
  if (options.fetch) {
    const dir = await store.thumbsDir(true)
    for (const item of media) {
      if (!fetched.get(item.id)?.length) continue
      const path = join(dir, `${item.id}.jpg`)
      const url = thumbnailSource(item)
      if ((await exists(path)) || (url && (await downloadThumbnail(options.fetch, url, path)))) thumbs.set(item.id, path)
    }
  }

  let added = 0
  const file = await updateComments(store, account.id, (current) => {
    const before = new Map(current.media.map((item) => [item.mediaId, item]))
    // Nunca atualizada: o que já está no Instagram é o ponto de partida (lido), não uma pilha de "novos".
    const baseline = current.updatedAt === null
    const next: RedesMediaWithComments[] = media.map((item) => {
      const previous = before.get(item.id)
      const incoming = item.commentsCount ? fetched.get(item.id) : []
      // A mídia cuja leitura falhou fica com os comentários de antes.
      const merged = incoming ? mergeComments(item.id, previous?.comments ?? [], incoming, account, baseline) : { comments: previous?.comments ?? [], added: 0 }
      added += merged.added
      return {
        mediaId: item.id,
        caption: item.caption.slice(0, 4400),
        permalink: fits(item.permalink, 2000),
        mediaUrl: fits(item.mediaUrl, 4096),
        thumbnailUrl: fits(item.thumbnailUrl, 4096),
        timestamp: item.timestamp,
        // Os que a tela mostra (comentários e respostas lidos), não o `comments_count` da Meta: a lista e o número batem.
        commentsCount: merged.comments.reduce((sum, comment) => sum + 1 + comment.replies.length, 0),
        unread: countUnread(merged.comments),
        comments: merged.comments,
        thumbPath: thumbs.get(item.id) ?? previous?.thumbPath ?? null,
      }
    })
    return { version: FILE_VERSION, updatedAt: new Date(now).toISOString(), error: firstError, media: next }
  })
  return { ok: true, added, file }
}

/** O endereço que cabe no arquivo (o que passar fica de fora, em vez de recusar o arquivo inteiro). */
const fits = (value: string | null, max: number): string | null => (value !== null && value.length <= max ? value : null)

/** A imagem da miniatura: a capa do vídeo, ou a própria imagem (no carrossel, a primeira). */
function thumbnailSource(item: InstagramMedia): string | null {
  return item.mediaType === 'VIDEO' ? (item.thumbnailUrl ?? item.mediaUrl) : (item.mediaUrl ?? item.thumbnailUrl)
}

/** Abrir a mídia na tela: todos os comentários e respostas dela ficam lidos. */
export function markRead(store: RedesStore, accountId: string, mediaId: string): Promise<CommentsFile> {
  return updateComments(store, accountId, (file) => {
    const target = file.media.find((item) => item.mediaId === mediaId)
    if (!target || countUnread(target.comments) === 0) return null
    const readAll = (comment: RedesComment): RedesComment => ({ ...comment, read: true, replies: comment.replies.map(readAll) })
    return { ...file, media: file.media.map((item) => (item.mediaId === mediaId ? { ...item, comments: item.comments.map(readAll) } : item)) }
  })
}

/** Onde um comentário está: a mídia e o comentário de cima (ele mesmo, se não for resposta). */
export function findComment(file: CommentsFile, commentId: string): { media: RedesMediaWithComments; comment: RedesComment; top: RedesComment } | null {
  for (const media of file.media) {
    for (const top of media.comments) {
      if (top.id === commentId) return { media, comment: top, top }
      const reply = top.replies.find((item) => item.id === commentId)
      if (reply) return { media, comment: reply, top }
    }
  }
  return null
}

/** Muda (ou tira, com `null`) um comentário ou resposta de uma mídia; a contagem acompanha o que saiu ou entrou. */
export function changeComment(file: CommentsFile, commentId: string, change: (comment: RedesComment) => RedesComment | null): CommentsFile {
  return {
    ...file,
    media: file.media.map((media) => {
      let removed = 0
      const comments = media.comments.flatMap((top) => {
        if (top.id === commentId) {
          const next = change(top)
          if (!next) removed += 1 + top.replies.length
          return next ? [next] : []
        }
        const replies = top.replies.flatMap((reply) => {
          if (reply.id !== commentId) return [reply]
          const next = change(reply)
          if (!next) removed += 1
          return next ? [next] : []
        })
        return [replies.length === top.replies.length && replies.every((reply, index) => reply === top.replies[index]) ? top : { ...top, replies }]
      })
      return removed || comments.some((comment, index) => comment !== media.comments[index]) ? { ...media, comments, commentsCount: Math.max(0, media.commentsCount - removed) } : media
    }),
  }
}

/** A resposta recém-mandada entra embaixo do comentário de cima, já lida. */
export function addReply(file: CommentsFile, topId: string, reply: RedesComment): CommentsFile {
  return {
    ...file,
    media: file.media.map((media) =>
      media.comments.some((top) => top.id === topId)
        ? { ...media, commentsCount: media.commentsCount + 1, comments: media.comments.map((top) => (top.id === topId ? { ...top, replies: [...top.replies.filter((item) => item.id !== reply.id), reply].sort(byTime) } : top)) }
        : media,
    ),
  }
}

/** As miniaturas das mídias do arquivo (para apagar com a conta). */
export function thumbPaths(file: CommentsFile): string[] {
  return file.media.flatMap((item) => (item.thumbPath ? [item.thumbPath] : []))
}
