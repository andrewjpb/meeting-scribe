// Contrato 71 (CA5, CA7, CA9): a máquina de estados de uma tentativa de publicar, com o Instagram falso em memória:
// imagem, carrossel (com item já criado), Reels (com o upload e a retomada pelo contêiner guardado), ERROR, EXPIRED,
// retomada com `creationId`, contêiner morto na retomada, `PUBLISHED` com e sem o id da mídia e o tempo esgotado.
import { describe, expect, it } from 'vitest'
import type { Publication, PublicationMedia } from '../src/shared/redes'
import { createFakeInstagram, SMOKE_IG_TOKEN, SMOKE_IG_USER_ID, type FakeInstagram } from '../src/main/redes/fake-instagram'
import { createInstagramClient, type InstagramClient } from '../src/main/redes/instagram-client'
import { publishOnce, PUBLISH_MESSAGES, reelUploadUri, type PublishOnceOptions } from '../src/main/redes/publisher'

const T0 = Date.parse('2026-11-20T12:00:00.000Z')
let mediaSeq = 0

function media(kind: 'imagem' | 'video', patch: Partial<PublicationMedia> = {}): PublicationMedia {
  mediaSeq++
  const id = `00000000-0000-4000-8000-${String(mediaSeq).padStart(12, '0')}`
  return {
    id,
    kind,
    fileName: kind === 'imagem' ? `foto-${mediaSeq}.jpg` : `video-${mediaSeq}.mp4`,
    mimeType: kind === 'imagem' ? 'image/jpeg' : 'video/mp4',
    bytes: 1000,
    width: 1080,
    height: 1350,
    durationSeconds: kind === 'video' ? 10 : null,
    altText: '',
    localPath: `/tmp/${id}`,
    s3Key: kind === 'imagem' ? `instagram/${SMOKE_IG_USER_ID}/p/${id}.jpg` : null,
    containerId: null,
    ...patch,
  }
}

function publication(type: Publication['type'], items: PublicationMedia[], patch: Partial<Publication> = {}): Publication {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    accountId: SMOKE_IG_USER_ID,
    type,
    media: items,
    caption: 'Legenda #lap',
    scheduledAt: null,
    state: 'publicando',
    error: null,
    attempts: 1,
    creationId: null,
    publishedMediaId: null,
    permalink: null,
    publishedAt: null,
    createdAt: new Date(T0).toISOString(),
    updatedAt: new Date(T0).toISOString(),
    ...patch,
  }
}

interface Harness {
  fake: FakeInstagram
  progress: Publication[]
  uploads: { uri: string; mediaId: string }[]
  sleeps: number
  run(pub: Publication, overrides?: Partial<PublishOnceOptions>): ReturnType<typeof publishOnce>
}

function harness(): Harness {
  const fake = createFakeInstagram({ now: () => T0 })
  const client = createInstagramClient(fake.fetch)
  const h: Harness = {
    fake,
    progress: [],
    uploads: [],
    sleeps: 0,
    run: (pub, overrides = {}) =>
      publishOnce({
        client,
        token: SMOKE_IG_TOKEN,
        igUserId: SMOKE_IG_USER_ID,
        publication: pub,
        mediaUrl: (item) => (item.s3Key ? `https://midia.example/${item.s3Key}` : null),
        uploadReel: async (uri, item) => {
          h.uploads.push({ uri, mediaId: item.id })
          const sent = await client.uploadResumable(SMOKE_IG_TOKEN, uri, new Uint8Array(item.bytes))
          if (!sent.ok) throw new Error(sent.error)
        },
        now: () => T0,
        sleep: () => {
          h.sleeps++
          return Promise.resolve()
        },
        onProgress: (step) => {
          h.progress.push(step)
          return Promise.resolve()
        },
        ...overrides,
      }),
  }
  return h
}

const mediaPosts = (fake: FakeInstagram): number => fake.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/media')).length
const publishPosts = (fake: FakeInstagram): number => fake.calls.filter((call) => call.path.endsWith('/media_publish')).length

describe('publishOnce (contrato 71)', () => {
  it('imagem: contêiner, status até FINISHED, media_publish, permalink; o creationId gravado antes de publicar', async () => {
    const h = harness()
    const image = media('imagem', { altText: '  Foto da equipe ' })
    const { publication: done, steps } = await h.run(publication('imagem', [image]))
    expect(steps).toEqual(['container', 'status:IN_PROGRESS', 'status:IN_PROGRESS', 'status:FINISHED', 'publish', 'info'])
    expect(done).toMatchObject({ state: 'publicada', error: null })
    expect(done.permalink).toMatch(/^https:\/\/www\.instagram\.com\/p\//)
    expect(done.publishedMediaId).toBe(h.fake.published()[0]?.mediaId)
    expect(done.publishedAt).toBe(new Date(T0).toISOString())
    expect(h.sleeps).toBe(2)
    const [container] = h.fake.containers()
    expect(container).toMatchObject({ kind: 'imagem', imageUrl: `https://midia.example/${image.s3Key}`, altText: 'Foto da equipe', captionChars: 'Legenda #lap'.length })
    // O passo gravado com o `creationId` vem antes do que tem o id publicado.
    const withCreation = h.progress.findIndex((item) => item.creationId === container?.id && !item.publishedMediaId)
    const withMedia = h.progress.findIndex((item) => item.publishedMediaId !== null)
    expect(withCreation).toBeGreaterThanOrEqual(0)
    expect(withMedia).toBeGreaterThan(withCreation)
    // Token sempre no cabeçalho.
    expect(h.fake.calls.every((call) => call.bearer && !call.tokenInQuery)).toBe(true)
  })

  it('carrossel: um item por imagem, depois o pai com os filhos; o item já criado não se repete', async () => {
    const h = harness()
    const items = [media('imagem'), media('imagem'), media('imagem')]
    const { publication: done } = await h.run(publication('carrossel', items))
    expect(done.state).toBe('publicada')
    const containers = h.fake.containers()
    expect(containers.map((item) => item.kind)).toEqual(['item', 'item', 'item', 'carrossel'])
    expect(containers[3]?.children).toEqual(containers.slice(0, 3).map((item) => item.id))
    expect(done.media.map((item) => item.containerId)).toEqual(containers.slice(0, 3).map((item) => item.id))
    expect(done.creationId).toBe(containers[3]?.id)

    // A tentativa que parou depois do primeiro item (o segundo falhou): a próxima cria só os dois que faltam, e o pai.
    const again = harness()
    const real = createInstagramClient(again.fake.fetch)
    let created = 0
    const flaky: InstagramClient = {
      ...real,
      createContainer: (token, ig, body) => (++created === 2 ? Promise.resolve({ ok: false, error: 'Não foi possível falar com o Instagram', code: null, subcode: null }) : real.createContainer(token, ig, body)),
    }
    const stopped = await again.run(publication('carrossel', [media('imagem'), media('imagem'), media('imagem')]), { client: flaky })
    expect(stopped.publication).toMatchObject({ state: 'erro', creationId: null })
    expect(stopped.publication.media.map((item) => item.containerId !== null)).toEqual([true, false, false])
    const before = mediaPosts(again.fake)
    const { publication: resumed } = await again.run({ ...stopped.publication, state: 'publicando', error: null })
    expect(mediaPosts(again.fake) - before).toBe(3)
    expect(resumed.state).toBe('publicada')
    expect(again.fake.containers().at(-1)?.children).toEqual(resumed.media.map((item) => item.containerId))
  })

  it('Reels: contêiner retomável, upload na `uri` com o tamanho, depois o status e a publicação', async () => {
    const h = harness()
    const video = media('video', { bytes: 4321 })
    const { publication: done, steps } = await h.run(publication('reels', [video]))
    expect(done.state).toBe('publicada')
    expect(steps.slice(0, 2)).toEqual(['container', 'upload'])
    const [container] = h.fake.containers()
    expect(container?.kind).toBe('reels')
    expect(h.uploads).toEqual([{ uri: reelUploadUri(container?.id ?? ''), mediaId: video.id }])
    expect(h.fake.uploads).toEqual([{ containerId: container?.id, offset: '0', fileSize: '4321', bodyBytes: 4321, oauth: true }])
    expect(done.creationId).toBe(container?.id)
  })

  it('Reels com o upload falhando: o contêiner fica na mídia e a nova tentativa só refaz o upload', async () => {
    const h = harness()
    const video = media('video', { bytes: 100 })
    const failed = await h.run(publication('reels', [video]), { uploadReel: () => Promise.reject(new Error('Não foi possível falar com o Instagram')) })
    expect(failed.publication).toMatchObject({ state: 'erro', error: 'Não foi possível falar com o Instagram', creationId: null })
    const containerId = failed.publication.media[0]?.containerId
    expect(containerId).toBe(h.fake.containers()[0]?.id)
    const posts = mediaPosts(h.fake)
    const { publication: done } = await h.run({ ...failed.publication, state: 'publicando', error: null })
    expect(mediaPosts(h.fake)).toBe(posts)
    expect(h.uploads[0]?.uri).toBe(reelUploadUri(containerId ?? ''))
    expect(done).toMatchObject({ state: 'publicada', creationId: containerId })
  })

  it('media_publish com falha transitória: erro, creationId mantido; a nova tentativa usa o mesmo contêiner FINISHED', async () => {
    const h = harness()
    h.fake.failPublishNext()
    const failed = await h.run(publication('imagem', [media('imagem')]))
    expect(failed.publication).toMatchObject({ state: 'erro', error: 'Limite de chamadas do Instagram; tente mais tarde' })
    expect(failed.publication.creationId).toBe(h.fake.containers()[0]?.id)
    const posts = mediaPosts(h.fake)
    const { publication: done, steps } = await h.run({ ...failed.publication, state: 'publicando', error: null })
    expect(steps).toEqual(['status:FINISHED', 'publish', 'info'])
    expect(mediaPosts(h.fake)).toBe(posts)
    expect(publishPosts(h.fake)).toBe(2)
    expect(h.fake.published()).toHaveLength(1)
    expect(done).toMatchObject({ state: 'publicada', creationId: failed.publication.creationId })
  })

  it('contêiner em ERROR (permanente, como na Meta): erro traduzido; a nova tentativa descarta e cria outro uma vez', async () => {
    const h = harness()
    h.fake.failNext(36003)
    const failed = await h.run(publication('imagem', [media('imagem')]))
    expect(failed.publication).toMatchObject({ state: 'erro', error: 'Proporção fora de 4:5 a 1,91:1' })
    const dead = failed.publication.creationId
    expect(dead).toBe(h.fake.containers()[0]?.id)
    const { publication: done, steps } = await h.run({ ...failed.publication, state: 'publicando', error: null })
    expect(steps.slice(0, 2)).toEqual(['status:ERROR', 'container'])
    expect(done.state).toBe('publicada')
    expect(done.creationId).not.toBe(dead)
    expect(h.fake.containers()).toHaveLength(2)
    expect(h.fake.published()).toEqual([{ mediaId: done.publishedMediaId, creationId: done.creationId }])
  })

  it('ERROR com subcódigo no texto e EXPIRED', async () => {
    const h = harness()
    h.fake.failNext(2207026)
    expect((await h.run(publication('imagem', [media('imagem')]))).publication.error).toBe('Formato de vídeo não aceito')
    h.fake.expireNext()
    expect((await h.run(publication('imagem', [media('imagem')]))).publication).toMatchObject({ state: 'erro', error: PUBLISH_MESSAGES.expired })
  })

  it('retomada com o contêiner morto: troca por um novo uma vez (nunca publicado), e publica uma vez só', async () => {
    const h = harness()
    const first = await h.run(publication('imagem', [media('imagem')]), { client: { ...createInstagramClient(h.fake.fetch), publishContainer: () => Promise.resolve({ ok: false, error: 'Não foi possível falar com o Instagram', code: null, subcode: null }) } as InstagramClient })
    expect(first.publication).toMatchObject({ state: 'erro', error: 'Não foi possível falar com o Instagram' })
    const dead = first.publication.creationId
    h.fake.expireNext()
    const { publication: done, steps } = await h.run({ ...first.publication, state: 'publicando', error: null })
    expect(steps[0]).toBe('status:EXPIRED')
    expect(done.state).toBe('publicada')
    expect(done.creationId).not.toBe(dead)
    expect(h.fake.containers()).toHaveLength(2)
    expect(h.fake.published()).toEqual([{ mediaId: done.publishedMediaId, creationId: done.creationId }])
  })

  it('retomada já publicada: com o id gravado vai direto ao permalink; PUBLISHED sem o id não grava o id do contêiner', async () => {
    const h = harness()
    const done = (await h.run(publication('imagem', [media('imagem')]))).publication
    const publishes = publishPosts(h.fake)
    const kept = await h.run({ ...done, state: 'publicando', permalink: null })
    expect(kept.steps).toEqual(['info'])
    expect(kept.publication).toMatchObject({ state: 'publicada', publishedMediaId: done.publishedMediaId, permalink: done.permalink })
    // A resposta do `media_publish` se perdeu: o contêiner devolve o próprio id, que não é o da mídia.
    const lost = await h.run({ ...done, state: 'publicando', publishedMediaId: null, permalink: null })
    expect(lost.steps).toEqual(['status:PUBLISHED', 'lookup'])
    expect(lost.publication).toMatchObject({ state: 'publicada', publishedMediaId: null, permalink: null, creationId: done.creationId })
    expect(publishPosts(h.fake)).toBe(publishes)
  })

  it('carrossel: o item guardado que venceu é recriado na nova tentativa; o pai que falha limpa os itens', async () => {
    const h = harness()
    const real = createInstagramClient(h.fake.fetch)
    let created = 0
    const flaky: InstagramClient = {
      ...real,
      createContainer: (token, ig, body) => (++created === 2 ? Promise.resolve({ ok: false, error: 'Não foi possível falar com o Instagram', code: null, subcode: null }) : real.createContainer(token, ig, body)),
    }
    const stopped = await h.run(publication('carrossel', [media('imagem'), media('imagem')]), { client: flaky })
    const kept = stopped.publication.media[0]?.containerId
    expect(kept).not.toBeNull()
    h.fake.expireNext()
    const posts = mediaPosts(h.fake)
    const { publication: done, steps } = await h.run({ ...stopped.publication, state: 'publicando', error: null })
    expect(steps[0]).toBe('reuse:EXPIRED')
    expect(mediaPosts(h.fake) - posts).toBe(3)
    expect(done.state).toBe('publicada')
    expect(done.media[0]?.containerId).not.toBe(kept)

    // O pai recusado: os itens saem da publicação, e a próxima tentativa os recria em vez de travar num item morto.
    const parentFails: InstagramClient = { ...real, createContainer: (token, ig, body) => (body['media_type'] === 'CAROUSEL' ? Promise.resolve({ ok: false, error: 'Instagram respondeu com erro 100', code: 100, subcode: null }) : real.createContainer(token, ig, body)) }
    const refused = await h.run(publication('carrossel', [media('imagem'), media('imagem')]), { client: parentFails })
    expect(refused.publication).toMatchObject({ state: 'erro', error: 'Instagram respondeu com erro 100' })
    expect(refused.publication.media.map((item) => item.containerId)).toEqual([null, null])
  })

  it('Reels: o contêiner de um upload que falhou e depois venceu é recriado', async () => {
    const h = harness()
    const failed = await h.run(publication('reels', [media('video', { bytes: 200 })]), { uploadReel: () => Promise.reject(new Error('Não foi possível falar com o Instagram')) })
    const dead = failed.publication.media[0]?.containerId
    expect(dead).not.toBeNull()
    h.fake.expireNext()
    const { publication: done, steps } = await h.run({ ...failed.publication, state: 'publicando', error: null })
    expect(steps.slice(0, 3)).toEqual(['reuse:EXPIRED', 'container', 'upload'])
    expect(done.state).toBe('publicada')
    expect(done.creationId).not.toBe(dead)
    expect(h.uploads.at(-1)?.uri).toBe(reelUploadUri(done.creationId ?? ''))
  })

  it('o contêiner que não termina em 5 min, a imagem sem URL e o token recusado viram erro sem lançar', async () => {
    const h = harness()
    const stuck: InstagramClient = { ...createInstagramClient(h.fake.fetch), containerStatus: () => Promise.resolve({ ok: true, statusCode: 'IN_PROGRESS', status: 'In Progress' }) }
    const timedOut = await h.run(publication('imagem', [media('imagem')]), { client: stuck })
    expect(timedOut.publication).toMatchObject({ state: 'erro', error: PUBLISH_MESSAGES.timeout })
    expect(timedOut.steps.filter((step) => step === 'status:IN_PROGRESS')).toHaveLength(60)
    expect((await h.run(publication('imagem', [media('imagem', { s3Key: null })]))).publication).toMatchObject({ state: 'erro', error: PUBLISH_MESSAGES.noImageUrl })
    expect((await h.run(publication('imagem', [media('imagem')]), { token: 'IGAAoutro' })).publication).toMatchObject({ state: 'erro', error: 'Token recusado pelo Instagram' })
  })
})
