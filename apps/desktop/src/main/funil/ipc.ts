// Canais do funil de vendas (contrato 110, D4, R47). Cada pedido passa por um esquema zod `.strict()` antes do
// serviço: fora do formato devolve `invalido` sem tocar no store. Exceção ao gravar vira `falhou` com o texto de
// sempre. Todos os canais são recusados com o app bloqueado (`WHEN_LOCKED`, aplicado pelo `handle`).
import { z } from 'zod'
import { FUNIL_ERRO_TEXTO, FUNIL_FALHOU_TEXTO, FUNIL_LEITURA_FALHOU_TEXTO, type FunilFalha, type FunilActionResult, type FunilImportConfirmarResult } from '../../shared/funil'
import type { InvokeChannels } from '../../shared/ipc'
import { handle } from '../ipc'
import type { FunilService } from './service'

const id = z.string().min(1).max(200)
const texto = z.string().max(20_000)
const curto = z.string().max(1_000)
const lista = <T extends z.ZodType>(item: T) => z.array(item).max(10_000)

const contatoInput = z
  .object({
    id: id.optional(),
    nome: curto,
    emails: z.array(curto).max(100),
    telefones: z.array(curto).max(100),
    empresaId: id.nullable().optional(),
    empresaNome: curto.nullable().optional(),
    cargo: curto.nullable().optional(),
    notas: texto.optional(),
    whatsappChatId: id.nullable().optional(),
  })
  .strict()

const empresaInput = z
  .object({ id: id.optional(), nome: curto, dominios: z.array(curto).max(100), site: z.string().max(2_000).nullable().optional(), notas: texto.optional() })
  .strict()

const oportunidadeInput = z
  .object({
    id: id.optional(),
    titulo: curto,
    empresaId: id.nullable().optional(),
    empresaNome: curto.nullable().optional(),
    contatoIds: lista(id).optional(),
    etapaId: id.optional(),
    valor: z.number().nullable().optional(),
    previsao: z.string().max(20).nullable().optional(),
    proximoPasso: z.object({ texto, data: z.string().max(20).nullable() }).strict().nullable().optional(),
    meetingIds: lista(id).optional(),
    whatsappChatIds: lista(id).optional(),
    emails: lista(z.object({ accountId: id, id: curto, assunto: curto, de: curto, data: z.number() }).strict()).optional(),
    origem: z.enum(['manual', 'reuniao', 'assistente']).optional(),
    motivoPerda: texto.nullable().optional(),
  })
  .strict()

const etapaInput = z.object({ id: id.optional(), nome: curto, tipo: z.enum(['aberta', 'ganho', 'perdido']) }).strict()
const porId = z.object({ id }).strict()

/** O esquema de cada canal com pedido. */
export const FUNIL_PEDIDOS = {
  'scribe:funil-contato-save': z.object({ contato: contatoInput, origem: z.enum(['manual', 'importacao', 'reuniao', 'email', 'whatsapp', 'agenda', 'assistente']) }).strict(),
  'scribe:funil-contato-archive': porId,
  'scribe:funil-empresa-save': z.object({ empresa: empresaInput }).strict(),
  'scribe:funil-empresa-delete': porId,
  'scribe:funil-oportunidade-save': z.object({ oportunidade: oportunidadeInput }).strict(),
  'scribe:funil-oportunidade-move': z.object({ id, etapaId: id, ordem: z.number().int().min(0), motivoPerda: texto.nullable().optional() }).strict(),
  'scribe:funil-oportunidade-delete': porId,
  'scribe:funil-oportunidade-archive': porId,
  'scribe:funil-etapas-save': z.object({ etapas: z.array(etapaInput).max(100) }).strict(),
  'scribe:funil-evento-add': z.object({ oportunidadeId: id, texto }).strict(),
  'scribe:funil-ignorar': z.object({ chave: z.string().max(400) }).strict(),
  'scribe:funil-importar-confirmar': z
    .object({ token: z.string().max(200), mapeamento: z.array(z.enum(['nome', 'email', 'telefone', 'empresa', 'cargo', 'ignorar'])).max(1_000).optional(), simular: z.boolean().optional() })
    .strict(),
  'scribe:funil-timeline': z.object({ tipo: z.enum(['contato', 'oportunidade']), id }).strict(),
} as const

type Pedidos = typeof FUNIL_PEDIDOS
// O que o esquema aceita e o pedido declarado em `shared/ipc.ts` têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Confere = { [C in keyof Pedidos]: Same<z.infer<Pedidos[C]>, InvokeChannels[C]['request']> }
const pedidosConferem: Confere[keyof Confere] extends true ? true : false = true
void pedidosConferem

/** Resultado do esquema: o pedido tipado ou `null` (fora do formato). */
export function parseFunilPedido<C extends keyof Pedidos>(channel: C, request: unknown): InvokeChannels[C]['request'] | null {
  const parsed = FUNIL_PEDIDOS[channel].safeParse(request)
  return parsed.success ? (parsed.data as InvokeChannels[C]['request']) : null
}

const INVALIDO = { ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido } as const
const FALHOU = { ok: false, erro: 'falhou', mensagem: FUNIL_FALHOU_TEXTO } as const
const LEITURA_FALHOU: FunilFalha = { ok: false, erro: 'falhou', mensagem: FUNIL_LEITURA_FALHOU_TEXTO }

export function registerFunilIpc({ appOrigin, funil, log = () => undefined }: { appOrigin: string; funil: FunilService; log?: (message: string) => void }): void {
  const falhou = (channel: string, error: unknown): typeof FALHOU => {
    log(`[funil] ${channel} falhou: ${error instanceof Error ? error.message : String(error)}`)
    return FALHOU
  }

  /** Canal de gravação: esquema, serviço e o `falhou` tipado na exceção. */
  function acao<C extends keyof Pedidos & keyof InvokeChannels>(channel: C, run: (request: InvokeChannels[C]['request']) => Promise<FunilActionResult>): void {
    const handler = async (_event: unknown, request: unknown): Promise<FunilActionResult> => {
      const pedido = parseFunilPedido(channel, request)
      if (pedido === null) return INVALIDO
      return run(pedido).catch((error: unknown) => falhou(channel, error))
    }
    handle(channel, appOrigin, handler as never)
  }

  handle('scribe:funil-get', appOrigin, () =>
    funil.view().catch((error: unknown) => {
      falhou('scribe:funil-get', error)
      return LEITURA_FALHOU
    }),
  )
  acao('scribe:funil-contato-save', (request) => funil.contatoSave(request))
  acao('scribe:funil-contato-archive', (request) => funil.contatoArchive(request))
  acao('scribe:funil-empresa-save', (request) => funil.empresaSave(request))
  acao('scribe:funil-empresa-delete', (request) => funil.empresaDelete(request))
  acao('scribe:funil-oportunidade-save', (request) => funil.oportunidadeSave(request))
  acao('scribe:funil-oportunidade-move', (request) => funil.oportunidadeMove(request))
  acao('scribe:funil-oportunidade-delete', (request) => funil.oportunidadeDelete(request))
  acao('scribe:funil-oportunidade-archive', (request) => funil.oportunidadeArchive(request))
  acao('scribe:funil-etapas-save', (request) => funil.etapasSave(request))
  acao('scribe:funil-evento-add', (request) => funil.eventoAdd(request))
  acao('scribe:funil-ignorar', (request) => funil.ignorar(request))
  // Leitura sob demanda: um domínio com falha já vale vazio no serviço; o resto também não derruba a tela.
  handle('scribe:funil-sugestoes', appOrigin, () =>
    funil.sugestoes().catch((error: unknown) => {
      falhou('scribe:funil-sugestoes', error)
      return []
    }),
  )
  handle('scribe:funil-importar-abrir', appOrigin, () =>
    funil.importarAbrir().catch((error: unknown) => {
      falhou('scribe:funil-importar-abrir', error)
      return { ok: false, erro: 'falhou' } as const
    }),
  )
  handle('scribe:funil-importar-confirmar', appOrigin, async (_event, request): Promise<FunilImportConfirmarResult> => {
    const pedido = parseFunilPedido('scribe:funil-importar-confirmar', request)
    if (pedido === null) return INVALIDO
    return funil.importarConfirmar(pedido).catch((error: unknown) => falhou('scribe:funil-importar-confirmar', error))
  })
  handle('scribe:funil-timeline', appOrigin, async (_event, request) => {
    const pedido = parseFunilPedido('scribe:funil-timeline', request)
    if (pedido === null) return { ok: false, erro: 'invalido' } as const
    return funil.timeline(pedido).catch((error: unknown) => {
      falhou('scribe:funil-timeline', error)
      return LEITURA_FALHOU
    })
  })
}
