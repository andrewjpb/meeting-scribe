// Redes sociais (feature redes-instagram, contrato 69): o que o renderer e o main trocam sobre as contas e o
// armazenamento de mídia. A primeira rede é o Instagram, conectado por token colado (gerado no painel da Meta), não por
// OAuth: a troca do código exige o `client_secret`, que a Meta manda não guardar no dispositivo. O token e a chave
// secreta do armazenamento só existem em claro no main e ficam cifrados no cofre (`accounts/instagram.bin`,
// `accounts/media-host.bin`); nenhum canal os devolve (`MediaHostStatus.secretSet` é só um booleano).
import { z } from 'zod'

export const REDES = ['instagram'] as const
export type RedeId = (typeof REDES)[number]

/** `expirada`: o token venceu ou a renovação foi recusada (pede um token novo); `erro`: a última renovação falhou por outro motivo. */
export const REDES_ACCOUNT_STATES = ['conectando', 'conectada', 'expirada', 'erro'] as const
export type RedesAccountState = (typeof REDES_ACCOUNT_STATES)[number]

export const REDES_ACCOUNT_TYPES = ['business', 'creator', 'desconhecido'] as const
export type RedesAccountType = (typeof REDES_ACCOUNT_TYPES)[number]

/** O token gerado pelo painel vale 60 dias; cada renovação dá mais 60. */
export const INSTAGRAM_TOKEN_TTL_DAYS = 60
/** O serviço renova o token que tem 7 dias ou mais (ao abrir o app e uma vez por dia). */
export const INSTAGRAM_REFRESH_AFTER_DAYS = 7
/** A Meta só renova token com mais de 24 h. */
export const INSTAGRAM_REFRESH_MIN_AGE_HOURS = 24

/** `user_id` da conta profissional: só dígitos (vira nome de arquivo em `userData/redes/`). */
export const REDES_ACCOUNT_ID_PATTERN = /^\d{1,32}$/
/** Token colado: o do Instagram começa com `IGAA`; aqui só o tamanho e a ausência de espaço. */
export const REDES_TOKEN_MAX = 4096
export const REDES_TEXT_MAX = 2000

/** A conta como o renderer vê: o perfil em cache, a validade do token e o estado; nunca o token. */
export interface RedesAccount {
  /** `user_id` da conta profissional. */
  id: string
  rede: RedeId
  username: string
  name: string | null
  accountType: RedesAccountType
  pictureUrl: string | null
  followers: number | null
  mediaCount: number | null
  /** ISO. */
  tokenExpiresAt: string
  /** ISO: a última vez que o token foi validado ou renovado. */
  refreshedAt: string
  /** ISO. */
  connectedAt: string
  state: RedesAccountState
  /** Mensagem curta em pt-BR para a tela; `null` sem erro. */
  error: string | null
}

/** Armazenamento S3 compatível (Cloudflare R2 e qualquer S3) para as imagens que o Instagram busca por URL pública. */
export interface MediaHostConfig {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  publicBaseUrl: string
  pathStyle: boolean
}

export interface MediaHostStatus {
  configured: boolean
  config: MediaHostConfig | null
  /** A chave secreta está no cofre (nunca o valor dela). */
  secretSet: boolean
  /** ISO em `at`. */
  lastTest: { ok: boolean; detail: string; at: string } | null
}

export interface RedesState {
  accounts: RedesAccount[]
  mediaHost: MediaHostStatus
}

export type RedesConnectResult = { ok: true; account: RedesAccount } | { ok: false; error: string }
/** "Salvar" do armazenamento: recusado (configuração inválida, cofre indisponível) com a razão e o estado de antes. */
export type MediaHostSaveResult = { ok: true; status: MediaHostStatus } | { ok: false; error: string; status: MediaHostStatus }

export const EMPTY_MEDIA_HOST_STATUS: Readonly<MediaHostStatus> = Object.freeze({ configured: false, config: null, secretSet: false, lastTest: null })

const isoDate = z.iso.datetime({ offset: true })
const shortText = z.string().max(REDES_TEXT_MAX)

export const redesAccountSchema = z
  .object({
    id: z.string().regex(REDES_ACCOUNT_ID_PATTERN),
    rede: z.enum(REDES),
    username: z.string().min(1).max(100),
    name: shortText.nullable(),
    accountType: z.enum(REDES_ACCOUNT_TYPES),
    pictureUrl: shortText.nullable(),
    followers: z.number().int().nonnegative().nullable(),
    mediaCount: z.number().int().nonnegative().nullable(),
    tokenExpiresAt: isoDate,
    refreshedAt: isoDate,
    connectedAt: isoDate,
    state: z.enum(REDES_ACCOUNT_STATES),
    error: shortText.nullable(),
  })
  .strict()

export const mediaHostConfigSchema = z
  .object({
    endpoint: z.string().trim().min(1).max(REDES_TEXT_MAX),
    region: z.string().trim().min(1).max(100),
    bucket: z.string().trim().min(1).max(255),
    accessKeyId: z.string().trim().min(1).max(256),
    publicBaseUrl: z.string().trim().min(1).max(REDES_TEXT_MAX),
    pathStyle: z.boolean(),
  })
  .strict()

export const mediaHostTestSchema = z.object({ ok: z.boolean(), detail: shortText, at: isoDate }).strict()

export const mediaHostStatusSchema = z
  .object({ configured: z.boolean(), config: mediaHostConfigSchema.nullable(), secretSet: z.boolean(), lastTest: mediaHostTestSchema.nullable() })
  .strict()

export const redesStateSchema = z.object({ accounts: z.array(redesAccountSchema), mediaHost: mediaHostStatusSchema }).strict()

/** O token colado: sem espaço nem quebra (a tela já corta as pontas). */
export const redesTokenSchema = z.string().trim().min(1).max(REDES_TOKEN_MAX).regex(/^\S+$/)

// ── Publicações (contrato 71, R4 da spec redes-instagram) ─────────────────────────────────────────────────────────────
// A fila local de cada conta: rascunho → agendada → publicando → publicada (ou erro). As mídias são arquivos locais
// copiados para `userData/redes/midia/<id>/` ao salvar; a imagem sobe para o armazenamento S3 só na hora de publicar (o
// Instagram busca por URL pública) e o vídeo vai pelo upload retomável da Meta. "Publicar agora" e "Agendar" só com o
// token de clique do preload, como o "Enviar" do email.

/** `publicando`: o serviço está subindo a mídia, criando o contêiner ou publicando (retoma ao abrir o app). */
export const PUBLICATION_STATES = ['rascunho', 'agendada', 'publicando', 'publicada', 'erro'] as const
export type PublicationState = (typeof PUBLICATION_STATES)[number]

/** Inferido pelas mídias: 1 imagem, 2 a 10 imagens, 1 vídeo. */
export const PUBLICATION_TYPES = ['imagem', 'carrossel', 'reels'] as const
export type PublicationType = (typeof PUBLICATION_TYPES)[number]

export const PUBLICATION_MEDIA_KINDS = ['imagem', 'video'] as const
export type PublicationMediaKind = (typeof PUBLICATION_MEDIA_KINDS)[number]
export const PUBLICATION_MIME_TYPES = ['image/jpeg', 'video/mp4', 'video/quicktime'] as const
export type PublicationMimeType = (typeof PUBLICATION_MIME_TYPES)[number]

export interface PublicationMedia {
  id: string
  kind: PublicationMediaKind
  /** O nome do arquivo escolhido (o texto alternativo da tela é por nome). */
  fileName: string
  mimeType: PublicationMimeType
  bytes: number
  width: number
  height: number
  durationSeconds: number | null
  altText: string
  /** A cópia em `userData/redes/midia/<publicação>/<mídia>.<ext>` (o original pode sumir). */
  localPath: string
  /** A chave no armazenamento enquanto a imagem está lá (apagada depois de publicada, ou 48 h depois de erro). */
  s3Key: string | null
  /** O contêiner do item de carrossel, ou o do Reels antes do upload terminar (nunca é criado duas vezes). */
  containerId: string | null
}

export interface Publication {
  id: string
  accountId: string
  type: PublicationType
  media: PublicationMedia[]
  caption: string
  /** ISO: a hora marcada (no rascunho, só a planejada). */
  scheduledAt: string | null
  state: PublicationState
  /** Mensagem curta em pt-BR (o erro da Meta traduzido, ou o aviso da cota). */
  error: string | null
  attempts: number
  /** O contêiner que vai a `media_publish`; gravado antes de publicar (idempotência). */
  creationId: string | null
  publishedMediaId: string | null
  permalink: string | null
  /** ISO. */
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

/** `content_publishing_limit`: publicações nas últimas 24 h e o teto (hoje 50). */
export interface PublicationQuota {
  used: number
  total: number
  /** ISO. */
  checkedAt: string
}

/** Um arquivo escolhido no diálogo, já conferido pelas regras da Meta (nada é salvo ainda). */
export interface MediaCandidate {
  path: string
  fileName: string
  ok: boolean
  kind: PublicationMediaKind | null
  mimeType: string | null
  bytes: number
  width: number | null
  height: number | null
  durationSeconds: number | null
  /** Em pt-BR, para a tela; vazio quando `ok`. */
  problems: string[]
}

export const CAPTION_MAX = 2200
export const CAPTION_HASHTAGS_MAX = 30
export const CAPTION_MENTIONS_MAX = 20
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 10
const MIB = 1024 * 1024
export const IMAGE_MAX_BYTES = 8 * MIB
export const IMAGE_MIN_WIDTH = 320
/** 4:5. */
export const IMAGE_RATIO_MIN = 0.8
export const IMAGE_RATIO_MAX = 1.91
export const VIDEO_MAX_BYTES = 300 * MIB
export const VIDEO_MIN_SECONDS = 3
export const VIDEO_MAX_SECONDS = 900
/** O status do contêiner é consultado a cada 5 s, por até 5 min. */
export const CONTAINER_POLL_MS = 5000
export const CONTAINER_POLL_MAX_MS = 300_000
/** O agendador confere a fila a cada 30 s. */
export const PUBLISH_TICK_MS = 30_000
/** Cota esgotada: a publicação é adiada 1 h. */
export const QUOTA_POSTPONE_MS = 3_600_000
/** A imagem de uma publicação com erro sai do armazenamento 48 h depois. */
export const MEDIA_CLEANUP_AFTER_ERROR_MS = 48 * 3_600_000
/** Texto alternativo por imagem. */
export const ALT_TEXT_MAX = 1000

export const QUOTA_POSTPONED_MESSAGE = 'Cota de publicações das últimas 24 h esgotada; adiada por 1 hora'
export const MEDIA_HOST_REQUIRED_MESSAGE = 'Configure o armazenamento de mídia em Configurações › Contas'
/** "Publicar agora" ou "Agendar" sem o clique da pessoa: mora em `ipc.ts`, que o preload importa sem levar o zod junto. */
export { REDES_CLICK_MESSAGE } from './ipc'

export interface CaptionStats {
  /** Caracteres como a pessoa conta (pontos de código, um emoji simples é 1). */
  chars: number
  hashtags: number
  mentions: number
  problems: string[]
}

const HASHTAG = /(^|[^\p{L}\p{N}_&])#[\p{L}\p{N}_]+/gu
const MENTION = /(^|[^\p{L}\p{N}_.@])@[A-Za-z0-9._]+/gu
const thousands = (value: number): string => value.toLocaleString('pt-BR')

/** O contador da legenda e o que passa dos limites da Meta (2.200 caracteres, 30 hashtags, 20 @). */
export function captionStats(caption: string): CaptionStats {
  const chars = [...caption].length
  const hashtags = caption.match(HASHTAG)?.length ?? 0
  const mentions = caption.match(MENTION)?.length ?? 0
  const problems: string[] = []
  if (chars > CAPTION_MAX) problems.push(`Legenda acima de ${thousands(CAPTION_MAX)} caracteres`)
  if (hashtags > CAPTION_HASHTAGS_MAX) problems.push(`Mais de ${CAPTION_HASHTAGS_MAX} hashtags na legenda`)
  if (mentions > CAPTION_MENTIONS_MAX) problems.push(`Mais de ${CAPTION_MENTIONS_MAX} menções (@) na legenda`)
  return { chars, hashtags, mentions, problems }
}

/** 1 imagem → imagem; 2 a 10 imagens → carrossel; 1 vídeo → Reels. O resto é recusado com a razão. */
export function inferPublicationType(media: readonly { kind: PublicationMediaKind }[]): PublicationType | { error: string } {
  const videos = media.filter((item) => item.kind === 'video').length
  const images = media.length - videos
  if (media.length === 0) return { error: 'Escolha ao menos uma imagem ou um vídeo' }
  if (videos > 0 && images > 0) return { error: 'Vídeo não entra em carrossel: publique o vídeo sozinho' }
  if (videos > 1) return { error: 'Só um vídeo por publicação' }
  if (videos === 1) return 'reels'
  if (images > CAROUSEL_MAX) return { error: `Carrossel aceita no máximo ${CAROUSEL_MAX} imagens` }
  return images === 1 ? 'imagem' : 'carrossel'
}

/** O que `savePublication` recebe da tela: a ordem final das mídias (as já salvas pelo `localPath`). */
export interface PublicationSaveInput {
  id?: string
  accountId: string
  caption: string
  mediaPaths: string[]
  /** Texto alternativo por nome de arquivo (só imagens). */
  altTexts: Record<string, string>
  scheduledAt: string | null
}

export type PublicationSaveResult = { ok: true; publication: Publication } | { ok: false; problems: string[] }
export type PublicationActionResult = { ok: true; publication: Publication } | { ok: false; error: string }
export type PublicationQuotaResult = { ok: true; quota: PublicationQuota } | { ok: false; error: string }

/** O evento `scribe:redes-publications` e a resposta do canal de mesmo nome: a fila inteira de uma conta. */
export interface RedesPublicationsPayload {
  accountId: string
  publications: Publication[]
  /** A última cota lida (cache de 5 min), ou `null` se ainda não leu. */
  quota: PublicationQuota | null
}

export const PUBLICATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Ids da Meta (contêiner, mídia): só dígitos. */
const metaId = z.string().regex(/^\d{1,40}$/)

export const publicationMediaSchema = z
  .object({
    id: z.string().regex(PUBLICATION_ID_PATTERN),
    kind: z.enum(PUBLICATION_MEDIA_KINDS),
    fileName: z.string().min(1).max(500),
    mimeType: z.enum(PUBLICATION_MIME_TYPES),
    bytes: z.number().int().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    durationSeconds: z.number().nonnegative().nullable(),
    altText: z.string().max(ALT_TEXT_MAX),
    localPath: z.string().min(1).max(4096),
    s3Key: z.string().max(1024).nullable(),
    containerId: metaId.nullable(),
  })
  .strict()

export const publicationSchema = z
  .object({
    id: z.string().regex(PUBLICATION_ID_PATTERN),
    accountId: z.string().regex(REDES_ACCOUNT_ID_PATTERN),
    type: z.enum(PUBLICATION_TYPES),
    media: z.array(publicationMediaSchema).min(1).max(CAROUSEL_MAX),
    // Até 2.200 pontos de código: no máximo o dobro em unidades UTF-16.
    caption: z.string().max(CAPTION_MAX * 2),
    scheduledAt: isoDate.nullable(),
    state: z.enum(PUBLICATION_STATES),
    error: shortText.nullable(),
    attempts: z.number().int().nonnegative(),
    creationId: metaId.nullable(),
    publishedMediaId: metaId.nullable(),
    permalink: shortText.nullable(),
    publishedAt: isoDate.nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()

export const publicationQuotaSchema = z.object({ used: z.number().int().nonnegative(), total: z.number().int().nonnegative(), checkedAt: isoDate }).strict()
