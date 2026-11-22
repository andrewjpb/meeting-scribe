// Canais das tarefas (contrato 122, D4, R37). Cada pedido passa por um esquema zod `.strict()` antes do serviço: fora
// do formato devolve `invalido` sem tocar no store. Exceção ao gravar vira `falhou` com o texto de sempre. Todos os
// canais são recusados com o app bloqueado (`WHEN_LOCKED`, aplicado pelo `handle`, R36).
import { z } from 'zod'
import type { InvokeChannels } from '../../shared/ipc'
import { TAREFAS_ERRO_TEXTO, TAREFAS_FALHOU_TEXTO, TAREFAS_LEITURA_FALHOU_TEXTO, type TarefasActionResult, type TarefasFalha, type TarefasResumoResult } from '../../shared/tarefas'
import { diaValido } from '../../shared/tarefas-logic'
import { handle } from '../ipc'
import type { TarefasService } from './service'

const id = z.string().min(1).max(200)
const curto = z.string().max(1_000)
const titulo = z.string().max(1_000)
/** O store confere os limites de verdade (título 1 a 200 e detalhe até 2000, já aparados). */
const texto = z.string().max(20_000)
const prazo = z.string().refine(diaValido, 'data inválida').nullable()
const lembrete = z.union([z.literal('padrao'), z.literal('nenhum'), z.number().finite()])

const responsavel = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('eu') }).strict(),
  z.object({ tipo: z.literal('contato'), contatoId: id }).strict(),
  z.object({ tipo: z.literal('nome'), nome: curto }).strict(),
])

const origem = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('reuniao'), meetingId: id, texto: curto }).strict(),
  z.object({ tipo: z.literal('funil'), oportunidadeId: id }).strict(),
  z.object({ tipo: z.literal('email'), accountId: id, id: curto, assunto: curto }).strict(),
  z.object({ tipo: z.literal('whatsapp'), chatId: id, texto: curto.exactOptional() }).strict(),
  z.object({ tipo: z.literal('assistente') }).strict(),
  z.object({ tipo: z.literal('automacao'), agentId: id }).strict(),
  z.object({ tipo: z.literal('manual') }).strict(),
  z.object({ tipo: z.literal('migracao'), de: z.enum(['proximo-passo', 'lembrete']) }).strict(),
])

const email = z.object({ accountId: id, id: curto, assunto: curto, mailbox: curto.nullable() }).strict()

const tarefaInput = z
  .object({
    titulo,
    origem,
    detalhe: texto.optional(),
    prazo: prazo.optional(),
    lembrete: lembrete.optional(),
    importante: z.boolean().optional(),
    responsavel: responsavel.optional(),
    vinculos: z
      .object({
        oportunidadeId: id.nullable().exactOptional(),
        contatoIds: z.array(id).max(200).exactOptional(),
        empresaId: id.nullable().exactOptional(),
        meetingId: id.nullable().exactOptional(),
        email: email.nullable().exactOptional(),
        whatsappChatId: id.nullable().exactOptional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const tarefaSalvar = z
  .object({
    id,
    titulo: titulo.optional(),
    detalhe: texto.optional(),
    prazo: prazo.optional(),
    lembrete: lembrete.optional(),
    importante: z.boolean().optional(),
    responsavel: responsavel.optional(),
    vinculos: z
      .object({
        oportunidadeId: id.nullable().optional(),
        contatoIds: z.array(id).max(200).optional(),
        empresaId: id.nullable().optional(),
        meetingId: id.nullable().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** O esquema de cada canal com pedido. */
export const TAREFAS_PEDIDOS = {
  'scribe:tarefas-criar': tarefaInput,
  'scribe:tarefas-salvar': tarefaSalvar,
  'scribe:tarefas-status': z.object({ id, status: z.enum(['aberta', 'feita', 'cancelada']) }).strict(),
  'scribe:tarefas-apagar': z.object({ id }).strict(),
  'scribe:tarefas-ignorar': z.object({ chave: z.string().max(400) }).strict(),
  'scribe:tarefas-adicionar-do-resumo': z.object({ meetingId: id, indices: z.union([z.array(z.number().int().min(0)).max(1_000), z.literal('minhas')]) }).strict(),
} as const

type Pedidos = typeof TAREFAS_PEDIDOS
// O que o esquema aceita e o pedido declarado em `shared/ipc.ts` têm que ser o mesmo.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Confere = { [C in keyof Pedidos]: Same<z.infer<Pedidos[C]>, InvokeChannels[C]['request']> }
const pedidosConferem: Confere[keyof Confere] extends true ? true : false = true
void pedidosConferem

/** Resultado do esquema: o pedido tipado ou `null` (fora do formato). */
export function parseTarefasPedido<C extends keyof Pedidos>(channel: C, request: unknown): InvokeChannels[C]['request'] | null {
  const parsed = TAREFAS_PEDIDOS[channel].safeParse(request)
  return parsed.success ? (parsed.data as InvokeChannels[C]['request']) : null
}

const INVALIDO = { ok: false, erro: 'invalido', mensagem: TAREFAS_ERRO_TEXTO.invalido } as const
const FALHOU = { ok: false, erro: 'falhou', mensagem: TAREFAS_FALHOU_TEXTO } as const
const LEITURA_FALHOU: TarefasFalha = { ok: false, erro: 'falhou', mensagem: TAREFAS_LEITURA_FALHOU_TEXTO }

export function registerTarefasIpc({ appOrigin, tarefas, log = () => undefined }: { appOrigin: string; tarefas: TarefasService; log?: (message: string) => void }): void {
  const falhou = (channel: string, error: unknown): typeof FALHOU => {
    log(`[tarefas] ${channel} falhou: ${error instanceof Error ? error.message : String(error)}`)
    return FALHOU
  }

  /** Canal de gravação: esquema, serviço e o `falhou` tipado na exceção. */
  function acao<C extends keyof Pedidos & keyof InvokeChannels, R extends TarefasActionResult | TarefasResumoResult>(channel: C, run: (request: InvokeChannels[C]['request']) => Promise<R>): void {
    const handler = async (_event: unknown, request: unknown): Promise<R | typeof INVALIDO | typeof FALHOU> => {
      const pedido = parseTarefasPedido(channel, request)
      if (pedido === null) return INVALIDO
      return run(pedido).catch((error: unknown) => falhou(channel, error))
    }
    handle(channel, appOrigin, handler as never)
  }

  handle('scribe:tarefas-get', appOrigin, () =>
    tarefas.view().catch((error: unknown) => {
      falhou('scribe:tarefas-get', error)
      return LEITURA_FALHOU
    }),
  )
  acao('scribe:tarefas-criar', (request) => tarefas.criar(request))
  acao('scribe:tarefas-salvar', (request) => tarefas.salvar(request))
  acao('scribe:tarefas-status', (request) => tarefas.status(request))
  acao('scribe:tarefas-apagar', (request) => tarefas.apagar(request))
  acao('scribe:tarefas-ignorar', (request) => tarefas.ignorar(request))
  acao('scribe:tarefas-adicionar-do-resumo', (request) => tarefas.adicionarDoResumo(request))
  // Leitura sob demanda: um domínio com falha já vale vazio no serviço; o resto também não derruba a tela.
  handle('scribe:tarefas-sugestoes', appOrigin, () =>
    tarefas.sugestoes().catch((error: unknown) => {
      falhou('scribe:tarefas-sugestoes', error)
      return []
    }),
  )
}
