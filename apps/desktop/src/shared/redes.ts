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
