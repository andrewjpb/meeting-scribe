// Uma tentativa de publicar (contrato 71, R4 e regras de negócio da spec redes-instagram), pura sobre o cliente do
// Instagram: cria o contêiner (imagem; itens e pai do carrossel; Reels retomável com o upload do vídeo), espera o
// `FINISHED`, chama `media_publish` e lê o permalink. Nada é criado duas vezes: o item de carrossel e o Reels guardam o
// `containerId` na mídia assim que existem, e o `creationId` fica gravado (pelo `onProgress`) antes do `media_publish`;
// a retomada com `creationId` vai direto ao status, e o `PUBLISHED` (ou o `publishedMediaId` já gravado) vai direto ao
// permalink. Um contêiner que a Meta já deu como morto (`ERROR` ou `EXPIRED`) é trocado por um novo uma vez: o pai na
// retomada, e o item de carrossel ou o Reels guardados antes de serem reaproveitados (o status é conferido antes). Morto,
// ele nunca vai ser publicado, então não há como sair duplicado. Erro vira `{ state: 'erro', error }` em pt-BR, sem lançar.
import { CONTAINER_POLL_MAX_MS, CONTAINER_POLL_MS, type Publication, type PublicationMedia } from '../../shared/redes'
import { INSTAGRAM_API_VERSION, instagramErrorMessage, type ContainerBody, type InstagramClient } from './instagram-client'

export interface PublishOnceOptions {
  client: InstagramClient
  token: string
  igUserId: string
  publication: Publication
  /** A URL pública da imagem no armazenamento (`null` se não subiu). */
  mediaUrl: (media: PublicationMedia) => string | null
  /** Sobe o vídeo na `uri` do contêiner (lança com a razão em pt-BR). Quem chama lê o arquivo da mídia. */
  uploadReel: (containerUri: string, media: PublicationMedia) => Promise<void>
  now: () => number
  sleep: (ms: number) => Promise<void>
  /** Cada passo gravado (o `containerId` de um item, o `creationId`, o `publishedMediaId`), antes do seguinte. */
  onProgress?: (publication: Publication) => Promise<void>
}

export interface PublishOnceResult {
  publication: Publication
  /** O que foi feito, em ordem (para os testes): `child:<mídia>`, `container`, `upload`, `status:<código>`, `publish`, `info`. */
  steps: string[]
}

export const PUBLISH_MESSAGES = {
  noImageUrl: 'A imagem não subiu para o armazenamento',
  noUploadUri: 'O Instagram não devolveu o endereço de envio do vídeo',
  timeout: 'O Instagram não terminou de processar a mídia em 5 min',
  expired: 'Publicação expirou antes de concluir',
  containerError: 'O Instagram recusou a mídia',
  uploadFailed: 'Não foi possível enviar o vídeo ao Instagram',
} as const

const MAX_POLLS = Math.ceil(CONTAINER_POLL_MAX_MS / CONTAINER_POLL_MS)

/** O código numérico no texto do `status` (`Error: … error code 2207026`): o subcódigo (7 dígitos) ou o código. */
export function containerErrorMessage(status: string | null): string {
  const codes = [...(status ?? '').matchAll(/\b(\d{1,7})\b/g)].map((match) => Number(match[1]))
  const subcode = codes.find((code) => code >= 2_000_000)
  if (subcode !== undefined) return instagramErrorMessage({ error_subcode: subcode })
  const code = codes.find((value) => value > 0)
  return code !== undefined ? instagramErrorMessage({ code }) : PUBLISH_MESSAGES.containerError
}

/** A `uri` do upload retomável de um contêiner de Reels já criado (a Meta monta assim: versão e id do contêiner). */
export const reelUploadUri = (containerId: string): string => `https://rupload.facebook.com/ig-api-upload/${INSTAGRAM_API_VERSION}/${containerId}`

export async function publishOnce(options: PublishOnceOptions): Promise<PublishOnceResult> {
  const { client, token, igUserId } = options
  const steps: string[] = []
  let publication: Publication = { ...options.publication, media: options.publication.media.map((item) => ({ ...item })) }
  const iso = (): string => new Date(options.now()).toISOString()
  const progress = async (patch: Partial<Publication>): Promise<void> => {
    publication = { ...publication, ...patch, updatedAt: iso() }
    await options.onProgress?.(publication)
  }
  const setMedia = async (index: number, patch: Partial<PublicationMedia>): Promise<void> => {
    await progress({ media: publication.media.map((item, at) => (at === index ? { ...item, ...patch } : item)) })
  }
  const fail = (error: string): PublishOnceResult => ({ publication: { ...publication, state: 'erro', error, updatedAt: iso() }, steps })
  const withAlt = (body: ContainerBody, media: PublicationMedia): ContainerBody => (media.altText.trim() ? { ...body, alt_text: media.altText.trim() } : body)

  /**
   * O contêiner guardado (item de carrossel ou Reels) ainda serve? `true` vivo, `false` morto (`ERROR`/`EXPIRED`, a
   * recriar), `string` é o erro da consulta.
   */
  const reusable = async (containerId: string): Promise<boolean | string> => {
    const result = await client.containerStatus(token, containerId)
    if (!result.ok) return result.error
    steps.push(`reuse:${result.statusCode ?? '?'}`)
    return result.statusCode !== 'ERROR' && result.statusCode !== 'EXPIRED'
  }

  /** Cria o que falta (itens, pai, Reels com upload) e grava o `creationId`; `string` é o erro. */
  const create = async (): Promise<string | null> => {
    const caption = publication.caption
    if (publication.type === 'imagem') {
      const media = publication.media[0]
      const url = media ? options.mediaUrl(media) : null
      if (!media || !url) return PUBLISH_MESSAGES.noImageUrl
      const result = await client.createContainer(token, igUserId, withAlt({ image_url: url, caption }, media))
      steps.push('container')
      if (!result.ok) return result.error
      await progress({ creationId: result.id })
      return null
    }
    if (publication.type === 'carrossel') {
      for (const [index, media] of publication.media.entries()) {
        // O item que já tem contêiner (de uma tentativa anterior) não se repete, se ainda está vivo.
        if (media.containerId) {
          const alive = await reusable(media.containerId)
          if (typeof alive === 'string') return alive
          if (alive) continue
          await setMedia(index, { containerId: null })
        }
        const url = options.mediaUrl(media)
        if (!url) return PUBLISH_MESSAGES.noImageUrl
        const result = await client.createContainer(token, igUserId, withAlt({ image_url: url, is_carousel_item: true }, media))
        steps.push(`child:${media.id}`)
        if (!result.ok) return result.error
        await setMedia(index, { containerId: result.id })
      }
      const ids = publication.media.map((media) => media.containerId ?? '')
      const result = await client.createContainer(token, igUserId, { media_type: 'CAROUSEL', children: ids.join(','), caption })
      steps.push('container')
      if (!result.ok) {
        // Um item pode ter morrido no caminho: a próxima tentativa recria os itens em vez de travar neles.
        await progress({ media: publication.media.map((item) => ({ ...item, containerId: null })) })
        return result.error
      }
      await progress({ creationId: result.id })
      return null
    }
    // Reels: o contêiner primeiro (guardado na mídia), depois o vídeo; só com o upload feito ele vira o `creationId`.
    const media = publication.media[0]
    if (!media) return PUBLISH_MESSAGES.uploadFailed
    // O contêiner de um upload que falhou é reaproveitado só se ainda está vivo.
    if (media.containerId) {
      const alive = await reusable(media.containerId)
      if (typeof alive === 'string') return alive
      if (!alive) await setMedia(0, { containerId: null })
    }
    const current = publication.media[0] ?? media
    let uri = current.containerId ? reelUploadUri(current.containerId) : null
    if (!current.containerId) {
      const result = await client.createContainer(token, igUserId, { media_type: 'REELS', upload_type: 'resumable', caption })
      steps.push('container')
      if (!result.ok) return result.error
      if (!result.uri) return PUBLISH_MESSAGES.noUploadUri
      uri = result.uri
      await setMedia(0, { containerId: result.id })
    }
    const containerId = publication.media[0]?.containerId
    if (!uri || !containerId) return PUBLISH_MESSAGES.noUploadUri
    try {
      await options.uploadReel(uri, publication.media[0] ?? media)
    } catch (error) {
      return error instanceof Error && error.message ? error.message : PUBLISH_MESSAGES.uploadFailed
    }
    steps.push('upload')
    await progress({ creationId: containerId })
    return null
  }

  /** O contêiner morto sai da publicação (e os itens do carrossel com ele), para a recriação. */
  const discardContainer = async (): Promise<void> => {
    await progress({ creationId: null, media: publication.media.map((item) => ({ ...item, containerId: null })) })
  }

  /** Espera o `FINISHED` (ou já `PUBLISHED`); `string` é o erro. */
  const waitFinished = async (creationId: string): Promise<{ code: 'FINISHED' | 'PUBLISHED' } | { dead: string } | string> => {
    for (let poll = 0; poll < MAX_POLLS; poll++) {
      const result = await client.containerStatus(token, creationId)
      if (!result.ok) return result.error
      steps.push(`status:${result.statusCode ?? '?'}`)
      if (result.statusCode === 'FINISHED' || result.statusCode === 'PUBLISHED') return { code: result.statusCode }
      if (result.statusCode === 'ERROR') return { dead: containerErrorMessage(result.status) }
      if (result.statusCode === 'EXPIRED') return { dead: PUBLISH_MESSAGES.expired }
      if (poll < MAX_POLLS - 1) await options.sleep(CONTAINER_POLL_MS)
    }
    return PUBLISH_MESSAGES.timeout
  }

  /** 6: o permalink e a hora real. Já publicada: se a leitura falhar (ou sem o id), fica sem o link e com a hora daqui. */
  const finish = async (mediaId: string | null): Promise<Publication> => {
    let permalink: string | null = null
    let publishedAt = iso()
    if (mediaId) {
      const info = await client.mediaInfo(token, mediaId, ['permalink', 'timestamp'])
      steps.push('info')
      if (info.ok) {
        const link = info.data['permalink']
        if (typeof link === 'string' && /^https:\/\//.test(link)) permalink = link
        const timestamp = info.data['timestamp']
        const parsed = typeof timestamp === 'string' ? Date.parse(timestamp) : Number.NaN
        if (Number.isFinite(parsed)) publishedAt = new Date(parsed).toISOString()
      }
    }
    return { ...publication, state: 'publicada', error: null, publishedMediaId: mediaId, permalink, publishedAt, updatedAt: iso() }
  }

  // Já publicada (o `media_publish` respondeu e o id ficou gravado): só falta o permalink.
  if (publication.publishedMediaId) return { publication: await finish(publication.publishedMediaId), steps }

  // 1–3: o contêiner (ou a retomada, com o que já existe).
  let resumed = publication.creationId !== null
  if (!resumed) {
    const error = await create()
    if (error) return fail(error)
  }

  // 4: o status, com uma recriação se o contêiner da retomada já morreu.
  let finished: 'FINISHED' | 'PUBLISHED' | null = null
  while (finished === null) {
    const creationId = publication.creationId
    if (!creationId) return fail(PUBLISH_MESSAGES.containerError)
    const status = await waitFinished(creationId)
    if (typeof status === 'string') return fail(status)
    if ('dead' in status) {
      if (!resumed) return fail(status.dead)
      resumed = false
      await discardContainer()
      const error = await create()
      if (error) return fail(error)
      continue
    }
    finished = status.code
  }

  // 5: `media_publish` (só com o `FINISHED`; o `PUBLISHED` já foi).
  let mediaId = publication.publishedMediaId
  if (finished === 'FINISHED' && !mediaId) {
    const creationId = publication.creationId ?? ''
    const result = await client.publishContainer(token, igUserId, creationId)
    steps.push('publish')
    if (!result.ok) return fail(result.error)
    mediaId = result.id
    await progress({ publishedMediaId: mediaId })
  }
  if (!mediaId && publication.creationId) {
    // `PUBLISHED` sem o id guardado (a resposta do `media_publish` se perdeu): tenta pelo próprio contêiner. Se a Meta
    // devolve o id do contêiner (e não o da mídia), fica publicada sem o id nem o permalink: nunca o id errado.
    const found = await client.mediaInfo(token, publication.creationId, ['id'])
    steps.push('lookup')
    const id = found.ok ? found.data['id'] : undefined
    if (id !== undefined && /^\d{1,40}$/.test(String(id)) && String(id) !== publication.creationId) {
      mediaId = String(id)
      await progress({ publishedMediaId: mediaId })
    }
  }
  return { publication: await finish(mediaId), steps }
}
