// Senha do app (contrato 22, CA1): só o hash scrypt com sal aleatório de 16 bytes. Os parâmetros ficam no
// registro, para uma troca futura deles não invalidar a senha já criada. A comparação é em tempo constante.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { z } from 'zod'

export interface ScryptParams {
  /** Custo (potência de 2). */
  N: number
  r: number
  p: number
  keyLength: number
}

/**
 * Parâmetros da recomendação da OWASP para scrypt (N = 2^16, r = 8, p = 2): 64 MiB por cálculo, na casa de
 * 0,2 s num Mac atual. Fortes o bastante para o `lock.json` copiado não ser quebrado por tentativa.
 */
export const SCRYPT_PARAMS: Readonly<ScryptParams> = Object.freeze({ N: 2 ** 16, r: 8, p: 2, keyLength: 32 })
const SALT_BYTES = 16

export const passwordRecordSchema = z.object({
  algorithm: z.literal('scrypt'),
  N: z
    .number()
    .int()
    .min(2 ** 10)
    .max(2 ** 20)
    .refine((value) => (value & (value - 1)) === 0),
  r: z.number().int().min(1).max(32),
  p: z.number().int().min(1).max(16),
  keyLength: z.number().int().min(16).max(64),
  salt: z.base64(),
  hash: z.base64(),
})

export type PasswordRecord = z.infer<typeof passwordRecordSchema>

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  // `maxmem` padrão (32 MiB) não cabe 128 · N · r; o dobro do necessário dá folga.
  const options: ScryptOptions = { N: params.N, r: params.r, p: params.p, maxmem: 256 * params.N * params.r }
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, params.keyLength, options, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

export async function hashPassword(password: string, params: ScryptParams = SCRYPT_PARAMS): Promise<PasswordRecord> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await derive(password, salt, params)
  return { algorithm: 'scrypt', N: params.N, r: params.r, p: params.p, keyLength: params.keyLength, salt: salt.toString('base64'), hash: hash.toString('base64') }
}

export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
  const expected = Buffer.from(record.hash, 'base64')
  if (expected.length !== record.keyLength) return false
  const actual = await derive(password, Buffer.from(record.salt, 'base64'), record)
  return timingSafeEqual(actual, expected)
}
