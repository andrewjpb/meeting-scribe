// Contrato 73 (R5, CA10): os comentários do Instagram. A mescla preservando o `read` (o novo chega não lido, o da própria
// conta já lido), a contagem de novos, a árvore de respostas em ordem cronológica, a atualização pelo Instagram falso
// com a miniatura baixada só da CDN da Meta, marcar como lida, responder, ocultar e excluir pelo serviço, o polling no
// intervalo das Configurações (e parado com o app bloqueado). A hora relativa em pt-BR fica em
// `renderer/redes-comments-format.test.ts`.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RedesCommentsPayload } from '../src/shared/redes'
import type { SafeStorageLike } from '../src/main/secrets'
import { REDES_COMMENT_CLICK_MESSAGE } from '../src/shared/ipc'
import { createEmailClickGuard } from '../src/main/email/service'
import { countUnread, mergeComments, markRead, readComments, syncComments, thumbnailUrlAllowed } from '../src/main/redes/comments'
import { createFakeInstagram, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, SMOKE_IG_USERNAME, type FakeInstagram } from '../src/main/redes/fake-instagram'
import { createInstagramClient, type InstagramComment } from '../src/main/redes/instagram-client'
import { testMediaHost } from '../src/main/redes/media-host'
import { createRedesService, COMMENT_TOO_LONG_MESSAGE, type RedesService } from '../src/main/redes/service'
import { createRedesStore, type RedesStore } from '../src/main/redes/store'

const T0 = Date.parse('2026-11-20T12:00:00.000Z')
const MIN = 60_000
const ACCOUNT = { id: SMOKE_IG_USER_ID, username: SMOKE_IG_USERNAME }
/** Um JPEG mínimo (a miniatura só é conferida pelo começo `FF D8 FF`). */
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9])

const safeStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (plain) => Buffer.from(`enc:${[...plain].reverse().join('')}`),
  decryptString: (data) => [...data.toString().slice(4)].reverse().join(''),
}

/** A mídia mais recente com `comments_count` acima de zero no falso (o serviço só lê os comentários dessas). */
const commentedMedia = (fake: FakeInstagram): string => fake.mediaList().find((item) => item.comments_count > 0)?.id ?? ''

const remote = (id: string, at: string, patch: Partial<InstagramComment> = {}): InstagramComment => ({ id, parentId: null, text: `texto ${id}`, username: 'carol.design', fromId: '900', timestamp: at, hidden: false, likeCount: 0, replies: [], ...patch })

describe('mescla dos comentários (contrato 73)', () => {
  it('guarda o lido, o novo chega não lido e o da própria conta já lido; respostas em ordem cronológica', () => {
    const first = mergeComments('1', [], [remote('11', '2026-11-19T10:00:00.000Z'), remote('10', '2026-11-18T10:00:00.000Z', { replies: [remote('13', '2026-11-18T12:00:00.000Z', { fromId: SMOKE_IG_USER_ID, username: SMOKE_IG_USERNAME }), remote('12', '2026-11-18T11:00:00.000Z')] })], ACCOUNT)
    expect(first.comments.map((item) => item.id)).toEqual(['10', '11'])
    expect(first.comments[0]?.replies.map((item) => [item.id, item.parentId, item.read])).toEqual([
      ['12', '10', false],
      ['13', '10', true],
    ])
    // 10, 11 e 12 são novos; 13 é da conta.
    expect(first.added).toBe(3)
    expect(countUnread(first.comments)).toBe(3)

    const read = first.comments.map((item) => ({ ...item, read: true, replies: item.replies.map((reply) => ({ ...reply, read: true })) }))
    const second = mergeComments('1', read, [remote('10', '2026-11-18T10:00:00.000Z', { replies: [remote('12', '2026-11-18T11:00:00.000Z', { hidden: true })] }), remote('14', '2026-11-20T09:00:00.000Z')], ACCOUNT)
    // O 11 e o 13 foram excluídos no Instagram e saem; o 12 ficou oculto e continua lido; o 14 é o único novo.
    expect(second.comments.map((item) => [item.id, item.read])).toEqual([
      ['10', true],
      ['14', false],
    ])
    expect(second.comments[0]?.replies.map((item) => [item.id, item.read, item.hidden])).toEqual([['12', true, true]])
    expect(second.added).toBe(1)
  })

  it('uma resposta que a API manda solta, com o comentário de cima na lista, não aparece duas vezes', () => {
    const merged = mergeComments('1', [], [remote('10', '2026-11-18T10:00:00.000Z', { replies: [remote('12', '2026-11-18T11:00:00.000Z')] }), remote('12', '2026-11-18T11:00:00.000Z', { parentId: '10' })], ACCOUNT)
    expect(merged.comments.map((item) => item.id)).toEqual(['10'])
    expect(merged.added).toBe(2)
  })

  it('a miniatura só vem da CDN da Meta, por https', () => {
    expect(thumbnailUrlAllowed('https://scontent-gru2-1.cdninstagram.com/v/t51/1.jpg')).toBe(true)
    expect(thumbnailUrlAllowed('https://scontent.xx.fbcdn.net/v/1.jpg')).toBe(true)
    expect(thumbnailUrlAllowed('http://scontent.cdninstagram.com/v/1.jpg')).toBe(false)
    expect(thumbnailUrlAllowed('https://cdninstagram.com.evil.example/1.jpg')).toBe(false)
    expect(thumbnailUrlAllowed('https://user:senha@scontent.cdninstagram.com/1.jpg')).toBe(false)
    expect(thumbnailUrlAllowed('https://scontent.cdninstagram.com:8443/1.jpg')).toBe(false)
  })
})

describe('atualização pelo Instagram falso (contrato 73)', () => {
  let dir: string
  let fake: FakeInstagram
  let store: RedesStore
  let mediaId: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'redes-comentarios-'))
    fake = createFakeInstagram({ now: () => T0 })
    store = createRedesStore(join(dir, 'redes'))
    await store.writeAccount({ id: SMOKE_IG_USER_ID, rede: 'instagram', username: SMOKE_IG_USERNAME, name: null, accountType: 'business', pictureUrl: null, followers: null, mediaCount: null, tokenExpiresAt: new Date(T0 + 50 * 86_400_000).toISOString(), refreshedAt: new Date(T0).toISOString(), connectedAt: new Date(T0).toISOString(), state: 'conectada', error: null })
    mediaId = commentedMedia(fake)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('a primeira atualização da conta é o ponto de partida: o que já existia entra lido', async () => {
    fake.addComment(mediaId, { text: 'Antigo', username: 'ana', at: T0 - 3 * 3_600_000 })
    const client = createInstagramClient(fake.fetch)
    const first = await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0)
    expect(first.ok && first.added).toBe(0)
    expect(first.file.media.find((item) => item.mediaId === mediaId)?.comments.map((item) => [item.text, item.read])).toEqual([['Antigo', true]])
    fake.addComment(mediaId, { text: 'Depois', username: 'bia', at: T0 })
    const next = await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0 + MIN)
    expect(next.ok && next.added).toBe(1)
    expect(next.file.media.find((item) => item.mediaId === mediaId)?.unread).toBe(1)
  })

  it('lê as 25 mídias, agrupa os comentários, guarda em arquivo próprio e baixa a miniatura', async () => {
    const client = createInstagramClient(fake.fetch)
    // A primeira leitura marca o ponto de partida; os comentários abaixo chegam depois dela.
    await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0 - MIN)
    const top = fake.addComment(mediaId, { text: 'Ficou lindo o app! <b>Já dá para baixar?</b>', username: 'carol.design', at: T0 - 3 * 3_600_000 })
    fake.addComment(mediaId, { text: 'Já sim, Carol!', username: SMOKE_IG_USERNAME, fromId: SMOKE_IG_USER_ID, parentId: top, at: T0 - 2 * 3_600_000 })
    fake.addComment(mediaId, { text: 'Qual stack?', username: 'rafa.dev', at: T0 - 3_600_000 })
    fake.thumbJpeg = JPEG
    const result = await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0, { fetch: fake.fetch })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.added).toBe(2)
    const withComments = result.file.media.filter((item) => item.comments.length)
    expect(withComments.map((item) => item.mediaId)).toEqual([mediaId])
    const media = withComments[0]
    expect(media?.commentsCount).toBe(3)
    expect(media?.unread).toBe(2)
    // O texto de terceiros fica como veio, como texto (a tela nunca interpreta marcação).
    expect(media?.comments[0]?.text).toBe('Ficou lindo o app! <b>Já dá para baixar?</b>')
    expect(media?.comments[0]?.replies[0]?.read).toBe(true)
    expect(media?.thumbPath).toBe(join(dir, 'redes', 'thumbs', `${mediaId}.jpg`))
    expect(new Uint8Array(readFileSync(media?.thumbPath ?? ''))).toEqual(JPEG)
    expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.comments.json`))).toBe(true)
    // Só 25 mídias e só a URL da CDN (nada fora da lista).
    expect(result.file.media).toHaveLength(25)
    expect(fake.calls.every((call) => call.host === 'graph.instagram.com' || call.host === 'scontent.cdninstagram.com')).toBe(true)
    // A gravação da fila (o arquivo da conta) não apaga os comentários.
    await store.writePublications(SMOKE_IG_USER_ID, [])
    expect((await readComments(store, SMOKE_IG_USER_ID)).media.find((item) => item.mediaId === mediaId)?.comments).toHaveLength(2)
  })

  it('marcar como lida zera a mídia; o comentário novo na próxima leitura chega não lido e o lido fica', async () => {
    fake.addComment(mediaId, { text: 'Primeiro', username: 'ana', at: T0 - MIN })
    const client = createInstagramClient(fake.fetch)
    await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0)
    const read = await markRead(store, SMOKE_IG_USER_ID, mediaId)
    expect(read.media.find((item) => item.mediaId === mediaId)?.unread).toBe(0)
    fake.addComment(mediaId, { text: 'Segundo', username: 'bia', at: T0 })
    const next = await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0 + MIN)
    expect(next.ok && next.added).toBe(1)
    const media = next.file.media.find((item) => item.mediaId === mediaId)
    expect(media?.comments.map((item) => [item.text, item.read])).toEqual([
      ['Primeiro', true],
      ['Segundo', false],
    ])
  })

  it('a falha da API fica no arquivo, sem apagar o que já estava', async () => {
    fake.addComment(mediaId, { text: 'Fica', username: 'ana', at: T0 - MIN })
    const client = createInstagramClient(fake.fetch)
    await syncComments(client, SMOKE_IG_TOKEN, ACCOUNT, store, T0)
    const failed = await syncComments(client, 'token-recusado', ACCOUNT, store, T0 + MIN)
    expect(failed.ok).toBe(false)
    expect(failed.file.error).toBe('Token recusado pelo Instagram')
    expect(failed.file.media.find((item) => item.mediaId === mediaId)?.comments).toHaveLength(1)
  })
})

describe('comentários no serviço das redes (contrato 73)', () => {
  let dir: string
  let fake: FakeInstagram
  let service: RedesService
  let locked: boolean
  let minutes: number
  let events: RedesCommentsPayload[]
  let mediaId: string

  /** A janela que clicou: o guarda de clique registra o token dela (o que o preload manda antes do pedido). */
  const WINDOW = 7
  let click: () => string = () => ''
  const make = (): RedesService => {
    const guard = createEmailClickGuard(() => T0)
    click = () => {
      const token = crypto.randomUUID()
      guard.register(WINDOW, token)
      return token
    }
    return createRedesService({
      userData: dir,
      safeStorage,
      fetch: fake.fetch,
      onState: () => undefined,
      now: () => T0,
      testMediaHost,
      isLocked: () => locked,
      clickGuard: guard,
      onComments: (payload) => events.push(payload),
      pollMinutes: () => Promise.resolve(minutes),
    })
  }
  const mediaReads = (): number => fake.calls.filter((call) => call.method === 'GET' && call.path.endsWith(`/${SMOKE_IG_USER_ID}/media`)).length

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'redes-comentarios-servico-'))
    fake = createFakeInstagram({ now: () => T0 })
    locked = false
    minutes = 5
    events = []
    mediaId = commentedMedia(fake)
  })
  afterEach(() => {
    service?.dispose()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  const connect = async (): Promise<void> => {
    service = make()
    await service.init()
    const connected = await service.connect({ token: SMOKE_IG_TOKEN })
    expect(connected.ok).toBe(true)
  }

  it('responder cria a resposta aninhada; ocultar alterna; excluir tira (a resposta de uma resposta vai ao de cima)', async () => {
    await connect()
    await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    const top = fake.addComment(mediaId, { text: 'Vai ter versão para Windows?', username: 'lu.santos', at: T0 - MIN })
    const answer = fake.addComment(mediaId, { text: 'Também quero', username: 'pedro', parentId: top, at: T0 - MIN / 2 })
    const refreshed = await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    expect(refreshed.unread).toBe(2)
    expect(events.at(-1)?.unread).toBe(2)

    // Sem o token de clique (ou com o de outra janela), nada sai.
    const replyRequest = { accountId: SMOKE_IG_USER_ID, commentId: answer, message: 'Sem clique' }
    expect(await service.replyComment(WINDOW, replyRequest)).toEqual({ ok: false, error: REDES_COMMENT_CLICK_MESSAGE })
    expect(await service.replyComment(WINDOW + 1, { ...replyRequest, clickToken: click() })).toEqual({ ok: false, error: REDES_COMMENT_CLICK_MESSAGE })
    expect(await service.deleteComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: answer, clickToken: 'inventado' })).toEqual({ ok: false, error: REDES_COMMENT_CLICK_MESSAGE })
    expect(fake.calls.filter((call) => call.method !== 'GET' && call.path.includes(answer)).length).toBe(0)

    const replied = await service.replyComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: answer, message: '  Ainda não, Pedro  ', clickToken: click() })
    expect(replied.ok).toBe(true)
    if (!replied.ok) return
    expect(replied.comment).toMatchObject({ parentId: top, text: 'Ainda não, Pedro', username: SMOKE_IG_USERNAME, read: true })
    expect(fake.commentsOf(mediaId)[0]?.replies.map((item) => item.text)).toEqual(['Também quero', 'Ainda não, Pedro'])
    expect(replied.payload.media[0]?.comments[0]?.replies.map((item) => item.id)).toEqual([answer, replied.comment.id])
    expect(replied.payload.media[0]?.commentsCount).toBe(3)
    expect((await service.replyComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: top, message: 'x'.repeat(2201), clickToken: click() })).ok).toBe(false)
    expect(await service.replyComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: top, message: 'é'.repeat(2201), clickToken: click() })).toEqual({ ok: false, error: COMMENT_TOO_LONG_MESSAGE })

    const hidden = await service.hideComment({ accountId: SMOKE_IG_USER_ID, commentId: top, hide: true })
    expect(hidden.ok && hidden.payload.media[0]?.comments[0]?.hidden).toBe(true)
    expect(fake.commentsOf(mediaId)[0]?.hidden).toBe(true)
    const shown = await service.hideComment({ accountId: SMOKE_IG_USER_ID, commentId: top, hide: false })
    expect(shown.ok && shown.payload.media[0]?.comments[0]?.hidden).toBe(false)

    const removed = await service.deleteComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: answer, clickToken: click() })
    expect(removed.ok && removed.payload.media[0]?.comments[0]?.replies.map((item) => item.text)).toEqual(['Ainda não, Pedro'])
    expect(removed.ok && removed.payload.media[0]?.commentsCount).toBe(2)
    const gone = await service.deleteComment(WINDOW, { accountId: SMOKE_IG_USER_ID, commentId: top, clickToken: click() })
    expect(gone.ok && gone.payload.media).toEqual([])

    // O erro da Meta volta em pt-BR para a nota da tela.
    const other = fake.addComment(mediaId, { text: 'Outro', username: 'ana', at: T0 })
    await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    fake.failCommentNext(4)
    expect(await service.hideComment({ accountId: SMOKE_IG_USER_ID, commentId: other, hide: true })).toEqual({ ok: false, error: 'Limite de chamadas do Instagram; tente mais tarde' })
  })

  it('abrir a mídia zera os não lidos dela; o "Remover" apaga o arquivo e as miniaturas', async () => {
    await connect()
    await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    fake.thumbJpeg = JPEG
    fake.addComment(mediaId, { text: 'Oi', username: 'ana', at: T0 - MIN })
    const first = await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    expect(first.unread).toBe(1)
    const thumb = first.media[0]?.thumbPath ?? ''
    expect(existsSync(thumb)).toBe(true)
    expect(await service.thumbnail({ path: thumb })).toBeNull() // sem o `nativeImage` injetado, nenhuma; o caminho é aceito
    const read = await service.markCommentsRead({ accountId: SMOKE_IG_USER_ID, mediaId })
    expect(read.unread).toBe(0)
    expect((await service.commentsState({ accountId: SMOKE_IG_USER_ID })).unread).toBe(0)
    await service.remove({ accountId: SMOKE_IG_USER_ID })
    expect(existsSync(join(dir, 'redes', `instagram-${SMOKE_IG_USER_ID}.comments.json`))).toBe(false)
    expect(existsSync(thumb)).toBe(false)
  })

  it('a miniatura de `thumbs/` vai à tela pelo canal do 72; fora dela, nada', async () => {
    service = createRedesService({ userData: dir, safeStorage, fetch: fake.fetch, onState: () => undefined, now: () => T0, testMediaHost, thumbnail: (path) => Promise.resolve(`data:image/jpeg;base64,${path.length}`) })
    expect(await service.thumbnail({ path: join(dir, 'redes', 'thumbs', `${mediaId}.jpg`) })).toMatch(/^data:image\/jpeg/)
    expect(await service.thumbnail({ path: join(dir, 'redes', 'thumbs', '..', 'outro.jpg') })).toBeNull()
    expect(await service.thumbnail({ path: join(dir, 'redes', 'thumbs', 'x.png') })).toBeNull()
  })

  it('o polling lê a cada redesPollMinutes e para com o app bloqueado', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    minutes = 15
    await connect()
    await service.refreshComments({ accountId: SMOKE_IG_USER_ID })
    fake.addComment(mediaId, { text: 'Oi', username: 'ana', at: T0 - MIN })
    const start = mediaReads()
    await vi.advanceTimersByTimeAsync(14 * MIN)
    expect(mediaReads()).toBe(start)
    await vi.advanceTimersByTimeAsync(2 * MIN)
    expect(mediaReads()).toBe(start + 1)
    await vi.waitFor(() => expect(events.at(-1)?.unread).toBe(1))
    locked = true
    await vi.advanceTimersByTimeAsync(31 * MIN)
    expect(mediaReads()).toBe(start + 1)
    locked = false
    await vi.advanceTimersByTimeAsync(15 * MIN)
    expect(mediaReads()).toBe(start + 2)
  })
})
