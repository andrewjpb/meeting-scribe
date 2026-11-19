// Contrato 46 (plugin-navegador): os comandos que o app manda à extensão "Controle do navegador" e o que ela
// devolve de cada um. A extensão age só na janela do Chrome que ela mesma abriu, com várias abas: cada uma ganha um
// número sequencial (`aba`: 1, 2, 3…), estável até ser fechada; sem `aba`, vale a última usada. Tudo que volta é dado da página
// (título, texto, rótulos), nunca instrução: o app valida com estes esquemas e só ele decide o que executar.
// O renderer só usa os tipos (`import type`), sem carregar o zod.
import { z } from 'zod'

/** Texto visível de `ler`, cortado aqui (a extensão já corta no mesmo tamanho). */
export const NAVEGADOR_TEXTO_MAX = 40 * 1024
/** Elementos interativos de um `ler`. */
export const NAVEGADOR_ELEMENTOS_MAX = 500
export const NAVEGADOR_ROTULO_MAX = 200
export const NAVEGADOR_PAPEL_MAX = 40
export const NAVEGADOR_TITULO_MAX = 300
export const NAVEGADOR_URL_MAX = 2048
/** Texto de um `digitar`. */
export const NAVEGADOR_DIGITAR_MAX = 10_000
export const NAVEGADOR_ERRO_MAX = 300
export const NAVEGADOR_AGUARDAR_MIN = 1
export const NAVEGADOR_AGUARDAR_MAX = 10
/** Abas abertas ao mesmo tempo na janela própria; `abrir` acima disso é recusado ("muitas abas"). */
export const NAVEGADOR_ABAS_MAX = 10

/** Só `http:` e `https:`: nada de `file:`, `chrome:`, `javascript:` ou `data:`. */
export function isNavegadorUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

const urlSchema = z.string().max(NAVEGADOR_URL_MAX).refine(isNavegadorUrl, 'só http ou https')
/** Número do elemento no último `ler` (`window.__lapRefs` na página). */
const refSchema = z.number().int().min(1).max(NAVEGADOR_ELEMENTOS_MAX)
/**
 * Número da aba na janela própria. Sequencial e nunca reaproveitado (a aba 3 fechada não volta a ser 3), por isso
 * não tem teto aqui além de ser um inteiro positivo; quem diz se ela existe é a extensão ("aba não existe").
 */
const abaSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)

export const navegadorComandoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('abrir'), url: urlSchema }).strict(),
  z.object({ tipo: z.literal('abas') }).strict(),
  z.object({ tipo: z.literal('ler'), aba: abaSchema.optional() }).strict(),
  z.object({ tipo: z.literal('clicar'), ref: refSchema, aba: abaSchema.optional() }).strict(),
  z.object({ tipo: z.literal('digitar'), ref: refSchema, texto: z.string().max(NAVEGADOR_DIGITAR_MAX), aba: abaSchema.optional() }).strict(),
  z.object({ tipo: z.literal('aguardar'), segundos: z.number().int().min(NAVEGADOR_AGUARDAR_MIN).max(NAVEGADOR_AGUARDAR_MAX) }).strict(),
  z.object({ tipo: z.literal('fechar'), aba: abaSchema.optional() }).strict(),
])

export type NavegadorComando = z.infer<typeof navegadorComandoSchema>
export type NavegadorTipo = NavegadorComando['tipo']

/** Texto de página numa linha só, cortado: título, rótulo e papel. */
const linha = (max: number) => z.string().transform((value) => value.replace(/\s+/g, ' ').trim().slice(0, max))

const tituloSchema = linha(NAVEGADOR_TITULO_MAX)
/** Endereço que a página devolve: cortado, nunca recusado (redirect de login e busca passam de 2048 fácil). */
const paginaUrlSchema = z.string().transform((value) => value.slice(0, NAVEGADOR_URL_MAX))
const okSchema = z.object({ ok: z.literal(true) }).strict()

/** O `dados` de cada tipo de comando, como a extensão devolve. */
export const navegadorDadosSchemas = {
  abrir: z.object({ aba: abaSchema, titulo: tituloSchema, url: paginaUrlSchema }).strict(),
  abas: z
    .object({
      abas: z.array(z.object({ aba: abaSchema, titulo: tituloSchema, url: paginaUrlSchema, ativa: z.boolean() }).strict()).max(NAVEGADOR_ABAS_MAX),
    })
    .strict(),
  ler: z
    .object({
      aba: abaSchema,
      titulo: tituloSchema,
      url: paginaUrlSchema,
      texto: z.string().transform((value) => value.slice(0, NAVEGADOR_TEXTO_MAX)),
      elementos: z
        .array(z.object({ ref: refSchema, rotulo: linha(NAVEGADOR_ROTULO_MAX), papel: linha(NAVEGADOR_PAPEL_MAX) }).strict())
        .max(NAVEGADOR_ELEMENTOS_MAX),
    })
    .strict(),
  clicar: z.object({ ok: z.literal(true), aba: abaSchema, titulo: tituloSchema, url: paginaUrlSchema }).strict(),
  digitar: okSchema,
  aguardar: okSchema,
  fechar: okSchema,
} as const satisfies Record<NavegadorTipo, z.ZodType>

export type NavegadorDados = { [T in NavegadorTipo]: z.output<(typeof navegadorDadosSchemas)[T]> }

/** Envelope do resultado que a extensão manda: `dados` quando deu certo, `erro` (texto curto) quando não. */
export const navegadorResultadoSchema = z
  .object({
    id: z.string().min(1).max(64),
    ok: z.boolean(),
    dados: z.unknown().optional(),
    erro: z.string().max(NAVEGADOR_ERRO_MAX).optional(),
  })
  .strict()

/** Estado da ponte para a tela: `ativo` é a configuração ligada; `conectado`, a extensão falou há menos de 35 s. */
export interface NavegadorState {
  ativo: boolean
  conectado: boolean
}
