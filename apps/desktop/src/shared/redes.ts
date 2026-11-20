// Redes sociais (feature redes-instagram, contrato 69): o que o renderer e o main trocam sobre as contas e o
// armazenamento de mídia. A primeira rede é o Instagram, conectado por token colado (gerado no painel da Meta), não por
// OAuth: a troca do código exige o `client_secret`, que a Meta manda não guardar no dispositivo. O token e a chave
// secreta do armazenamento só existem em claro no main e ficam cifrados no cofre (`accounts/instagram.bin`,
// `accounts/media-host.bin`); nenhum canal os devolve (`MediaHostStatus.secretSet` é só um booleano).
import { z } from 'zod'
import { ALT_TEXT_MAX, CAPTION_MAX, CAROUSEL_MAX } from './redes-rules'

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

// Contrato 72: os limites da legenda e do carrossel e as duas regras puras moram em `redes-rules.ts`, que a tela importa
// sem levar o zod junto (o zod testa `new Function` ao montar os esquemas, e a CSP do renderer recusa e registra).
export { ALT_TEXT_MAX, CAPTION_HASHTAGS_MAX, CAPTION_MAX, CAPTION_MENTIONS_MAX, CAROUSEL_MAX, CAROUSEL_MIN, captionStats, inferPublicationType, type CaptionStats } from './redes-rules'
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

export const QUOTA_POSTPONED_MESSAGE = 'Cota de publicações das últimas 24 h esgotada; adiada por 1 hora'
export const MEDIA_HOST_REQUIRED_MESSAGE = 'Configure o armazenamento de mídia em Configurações › Contas'
/** "Publicar agora" ou "Agendar" sem o clique da pessoa: mora em `ipc.ts`, que o preload importa sem levar o zod junto. */
export { REDES_CLICK_MESSAGE } from './ipc'

/** O que `savePublication` recebe da tela: a ordem final das mídias (as já salvas pelo `localPath`). */
export interface PublicationSaveInput {
  id?: string
  accountId: string
  caption: string
  mediaPaths: string[]
  /** Texto alternativo por caminho (o `localPath` da cópia salva ou o do arquivo novo; só imagens). Contrato 72. */
  altTexts: Record<string, string>
  scheduledAt: string | null
}

export type PublicationSaveResult = { ok: true; publication: Publication } | { ok: false; problems: string[] }
/**
 * Contrato 72: o "Publicar agora" e o "Agendar" com a edição junto (`save`) devolvem, na recusa, os problemas da edição
 * (`problems`) ou a publicação já salva (`saved`) quando só o publicar/agendar não passou.
 */
export type PublicationActionResult = { ok: true; publication: Publication } | { ok: false; error: string; problems?: string[]; saved?: Publication }
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

// 75: métricas
// ── Métricas (contrato 75, R7 da spec redes-instagram) ─────────────────────────────────────────────────────────────────
// A conta (seguidores agora e os números do período) e as 25 publicações mais recentes, só números, sem gráfico. O main
// guarda o que leu em `instagram-<id>.metrics.json` (cache de 1 h por período e por mídia); a métrica que a Meta recusa
// vira `null` ("—" na tela), não erro.

/** Os períodos da conta, em dias. */
export const METRIC_PERIODS = [7, 28, 90] as const
export type MetricPeriod = (typeof METRIC_PERIODS)[number]
/** Os números lidos valem 1 h (a Meta entrega com até 48 h de atraso; ler mais vezes não traz nada novo). */
export const METRICS_CACHE_MS = 3_600_000
/** As publicações mais recentes da tabela. */
export const METRICS_MEDIA_LIMIT = 25

/** Os números da conta num período; cada um `null` quando a Meta não entregou (recusou a métrica, ou não há dado). */
export interface AccountInsights {
  period: MetricPeriod
  /** ISO: o começo e o fim do período consultado. */
  since: string
  until: string
  /** Agora, não no período. */
  followers: number | null
  reach: number | null
  views: number | null
  accountsEngaged: number | null
  totalInteractions: number | null
  likes: number | null
  comments: number | null
  saves: number | null
  shares: number | null
  followsAndUnfollows: { follows: number; unfollows: number } | null
  profileLinksTaps: number | null
  /** ISO. */
  fetchedAt: string
}

/** Os números de uma publicação desde que saiu (`lifetime`). */
export interface MediaInsights {
  mediaId: string
  caption: string
  permalink: string | null
  /** ISO. */
  timestamp: string
  /** `IMAGE`, `VIDEO` (Reels), `CAROUSEL_ALBUM`; o que a Meta disser. */
  mediaType: string
  views: number | null
  reach: number | null
  likes: number | null
  comments: number | null
  saved: number | null
  shares: number | null
  totalInteractions: number | null
  /** A miniatura baixada para `userData/redes/thumbs/<mediaId>.jpg` (a tela pede a data URL por `scribe:redes-media-thumb`). */
  thumbPath: string | null
  /** ISO. */
  fetchedAt: string
}

/** A resposta de `scribe:redes-metrics` e o evento de mesmo nome: a conta nos três períodos (o não lido, `null`) e as mídias. */
export interface RedesMetricsState {
  accountId: string
  account: Record<MetricPeriod, AccountInsights | null>
  media: MediaInsights[]
  /** Em pt-BR, para a `Note`; `null` sem erro. */
  error: string | null
  /** ISO da última leitura que deu certo (`null`: nunca). */
  updatedAt: string | null
}
// fim 75

// 74: mensagens
// ── Mensagens (contrato 74, R6 da spec redes-instagram) ───────────────────────────────────────────────────────────────
// As conversas da caixa de mensagens diretas do Instagram e a resposta pela tela. O main lê `/me/conversations` a cada
// `redesPollMinutes` e só as mensagens das conversas com `updated_time` novo, guardando tudo em
// `instagram-<id>.messages.json`. O texto do contato é de terceiros: a tela mostra como texto, nunca como marcação.
// "Enviar" só com o token de clique do preload (`redesMessageSend`), como o email.
export { MESSAGE_TEXT_MAX_BYTES, MESSAGE_WINDOW_MS, messageBytes, outsideMessageWindow } from './redes-rules'

export const MESSAGE_ATTACHMENT_KINDS = ['imagem', 'video', 'audio', 'arquivo', 'outro'] as const
export type RedesMessageAttachmentKind = (typeof MESSAGE_ATTACHMENT_KINDS)[number]
export const MESSAGES_ACCESS_STATES = ['ok', 'denied', 'unknown'] as const
export type RedesMessagesAccess = (typeof MESSAGES_ACCESS_STATES)[number]

export interface RedesConversation {
  id: string
  /** O IGSID do contato (o `recipient.id` da resposta). */
  participantId: string
  /** O nome do contato quando a Meta manda; senão o @. */
  participantName: string
  participantUsername: string
  /** ISO: o `updated_time` da conversa. */
  updatedAt: string
  /** A última mensagem em uma linha (ou o tipo do anexo), `null` sem mensagem lida ainda. */
  lastMessage: string | null
  /** A última mensagem é do contato e a conversa ainda não foi aberta depois dela. */
  unread: boolean
  /** ISO: a última mensagem do contato (a janela de 24 h conta daqui). */
  lastInboundAt: string | null
  /** As mensagens antigas que o Instagram não detalha (só as 20 mais recentes vêm com texto e hora). */
  olderCount: number
  accessDenied?: never
}

export interface RedesMessageAttachment {
  kind: RedesMessageAttachmentKind
  /** Só `https://`; abre no navegador. */
  url: string | null
}

export interface RedesMessage {
  id: string
  conversationId: string
  fromId: string
  fromMe: boolean
  text: string | null
  attachments: RedesMessageAttachment[]
  /** ISO. */
  createdAt: string
}

export interface RedesMessagesState {
  conversations: RedesConversation[]
  /** Por conversa, da mais antiga para a mais nova. */
  messages: Record<string, RedesMessage[]>
  /** `denied`: a Meta recusou o acesso às mensagens (permissão ou Standard Access); `unknown`: ainda não leu. */
  access: RedesMessagesAccess
  /** O resumo em pt-BR da recusa, `null` sem recusa. */
  accessError: string | null
  /** Conversas não lidas (o número do nível Redes). */
  unread: number
  /** ISO da última leitura que deu certo. */
  updatedAt: string | null
}

/** O evento `scribe:redes-messages` e a resposta dos canais de mensagens: o estado inteiro de uma conta. */
export interface RedesMessagesPayload extends RedesMessagesState {
  accountId: string
  /** A última leitura falhou por outro motivo (rede, limite): a tela mostra e mantém o que já tinha. */
  error: string | null
}

export type RedesMessageSendResult = { ok: true; message: RedesMessage; payload: RedesMessagesPayload } | { ok: false; error: string }

export const EMPTY_MESSAGES_STATE: Readonly<RedesMessagesState> = Object.freeze({ conversations: [], messages: {}, access: 'unknown', accessError: null, unread: 0, updatedAt: null })
export const MESSAGE_WINDOW_REFUSED_MESSAGE = 'O Instagram recusou: fora da janela de 24 h'
export const MESSAGE_TOO_LONG_MESSAGE = 'Mensagem acima de 1000 bytes'
// fim 74

// 73: comentários
// ── Comentários (contrato 73, R5 e CA10 da spec redes-instagram) ──────────────────────────────────────────────────────
// Os comentários das 25 mídias mais recentes da conta, lidos a cada `redesPollMinutes` e ao abrir a seção, guardados em
// `instagram-<id>.comments.json` com o `read` de cada um (o novo chega `false`; abrir a mídia na tela marca). As respostas
// ficam aninhadas no comentário (o Instagram só tem um nível). O texto, o @ e a legenda são de terceiros: a tela mostra
// como texto, nunca como marcação. A miniatura é baixada pelo main para `userData/redes/thumbs/<mediaId>.jpg` (a CSP não
// deixa a tela pedir imagem fora do app) e vai à tela como data URL pelo `scribe:redes-media-thumb`.
export { REDES_POLL_MINUTES, REDES_POLL_MINUTES_DEFAULT, type RedesPollMinutes } from './settings-defaults'
/** As mídias mais recentes lidas a cada atualização. */
export const COMMENTS_MEDIA_LIMIT = 25
/** A resposta a um comentário: até 2.200 caracteres, como a legenda. */
export { CAPTION_MAX as COMMENT_REPLY_MAX } from './redes-rules'

export interface RedesComment {
  id: string
  mediaId: string
  /** O comentário de cima, numa resposta; `null` no comentário. */
  parentId: string | null
  text: string
  username: string
  /** O id de quem comentou (vazio quando a Meta não manda). */
  fromId: string
  /** ISO. */
  timestamp: string
  hidden: boolean
  likeCount: number
  read: boolean
  /** Em ordem cronológica; sempre vazio numa resposta. */
  replies: RedesComment[]
}

export interface RedesMediaWithComments {
  mediaId: string
  caption: string
  permalink: string | null
  mediaUrl: string | null
  thumbnailUrl: string | null
  /** ISO. */
  timestamp: string
  commentsCount: number
  /** Os comentários e as respostas ainda não lidos. */
  unread: number
  /** Em ordem cronológica. */
  comments: RedesComment[]
  /** A miniatura já baixada em `userData/redes/thumbs/<mediaId>.jpg`, ou `null`. */
  thumbPath: string | null
}

/** A resposta dos canais de comentários e o evento `scribe:redes-comments`: as mídias de uma conta e o total de não lidos. */
export interface RedesCommentsPayload {
  accountId: string
  /** Só as mídias com comentário, da mais nova para a mais antiga. */
  media: RedesMediaWithComments[]
  unread: number
  /** ISO da última atualização que deu certo (`null`: nunca). */
  updatedAt: string | null
  /** A última atualização falhou (em pt-BR); a lista fica como estava. */
  error: string | null
}

export type RedesCommentReplyResult = { ok: true; comment: RedesComment; payload: RedesCommentsPayload } | { ok: false; error: string }
export type RedesCommentActionResult = { ok: true; payload: RedesCommentsPayload } | { ok: false; error: string }

/** Até 2.200 pontos de código: no máximo o dobro em unidades UTF-16 (o que vier maior é cortado ao ler). */
export const COMMENT_TEXT_STORE_MAX = CAPTION_MAX * 2
const commentFields = {
  id: metaId,
  mediaId: metaId,
  parentId: metaId.nullable(),
  text: z.string().max(COMMENT_TEXT_STORE_MAX),
  username: z.string().max(100),
  fromId: z.string().max(40),
  timestamp: isoDate,
  hidden: z.boolean(),
  likeCount: z.number().int().nonnegative(),
  read: z.boolean(),
}
const commentReplySchema = z.object({ ...commentFields, replies: z.array(z.never()).max(0) }).strict()
export const redesCommentSchema = z.object({ ...commentFields, replies: z.array(commentReplySchema) }).strict()
export const redesMediaWithCommentsSchema = z
  .object({
    mediaId: metaId,
    caption: z.string().max(CAPTION_MAX * 2),
    permalink: shortText.nullable(),
    mediaUrl: z.string().max(4096).nullable(),
    thumbnailUrl: z.string().max(4096).nullable(),
    timestamp: isoDate,
    commentsCount: z.number().int().nonnegative(),
    unread: z.number().int().nonnegative(),
    comments: z.array(redesCommentSchema),
    thumbPath: z.string().max(4096).nullable(),
  })
  .strict()
// fim 73
