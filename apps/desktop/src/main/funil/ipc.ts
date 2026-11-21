// Canais do funil de vendas (contrato 110, D4, R47). Cada pedido passa por um esquema zod `.strict()` antes do
// serviço: fora do formato devolve `invalido` sem tocar no store. Exceção ao gravar vira `falhou` com o texto de
// sempre. Todos os canais são recusados com o app bloqueado (`WHEN_LOCKED`, aplicado pelo `handle`).
// Contrato 113: os canais da proposta de IA da reunião (`scribe:funil-proposta-*`, R38 a R40).
import { z } from 'zod'
import { FUNIL_ERRO_TEXTO, FUNIL_FALHOU_TEXTO, FUNIL_LEITURA_FALHOU_TEXTO, type FunilFalha, type FunilActionResult, type FunilImportConfirmarResult } from '../../shared/funil'
import { normalizarEmail } from '../../shared/funil-logic'
import { FUNIL_PROPOSTA_CONTATOS_MAX, type FunilPropostaAplicarResult, type FunilPropostaRecusa, type FunilPropostaView } from '../../shared/funil-proposta'
import type { InvokeChannels } from '../../shared/ipc'
import type { MeetingsStore } from '../meetings/store'
import { handle } from '../ipc'
import { applyProposal, dismissProposal, duplicataDa } from './apply-proposal'
import type { FunnelExtractService } from './extract'
import type { FunilProposalStore } from './proposals'
import type { FunilService } from './service'
import type { FunilStore } from './store'

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
const porReuniao = z.object({ meetingId: id }).strict()

const EMAIL_INVALIDO_PREFIXO = 'E-mail inválido: '
/** E-mail do cartão: vazio vale como sem e-mail; preenchido tem que normalizar, senão a recusa diz qual. */
const emailDoCartao = curto.nullable().superRefine((email, ctx) => {
  if (email !== null && email.trim() !== '' && normalizarEmail(email) === null) ctx.addIssue({ code: 'custom', message: `${EMAIL_INVALIDO_PREFIXO}${email.trim()}` })
})

const propostaCampos = z
  .object({
    titulo: curto,
    empresa: curto.nullable(),
    contatos: z.array(z.object({ nome: curto, email: emailDoCartao }).strict()).max(FUNIL_PROPOSTA_CONTATOS_MAX),
    etapaId: id,
    valor: z.number().nullable(),
    previsao: z.string().max(20).nullable(),
    proximoPasso: z.object({ texto, data: z.string().max(20).nullable() }).strict().nullable(),
  })
  .strict()

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
  'scribe:funil-proposta-get': porReuniao,
  'scribe:funil-proposta-aplicar': z.object({ meetingId: id, campos: propostaCampos, vincularA: id.optional() }).strict(),
  'scribe:funil-proposta-descartar': porReuniao,
  'scribe:funil-proposta-detectar': porReuniao,
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

const PROPOSTA_INVALIDA: FunilPropostaRecusa = { ok: false, erro: 'invalido', mensagem: FUNIL_ERRO_TEXTO.invalido }
const PROPOSTA_LEITURA_FALHOU: FunilPropostaRecusa = { ok: false, erro: 'falhou', mensagem: FUNIL_LEITURA_FALHOU_TEXTO }

/** Contrato 113: o que os canais da proposta usam. Sem isto, só os 16 canais do 110 são registrados. */
export interface FunilPropostaIpcDeps {
  /** O serviço de extração do 111. */
  funnel: Pick<FunnelExtractService, 'detect' | 'running'>
  proposals: FunilProposalStore
  /** Só a leitura (a oportunidade aberta da mesma empresa, as conferências do "aplicar"). */
  store: Pick<FunilStore, 'read'>
  meetings: Pick<MeetingsStore, 'get'>
  /** O arquivo da reunião mudou: o `scribe:funil-proposta-changed`. */
  onChange: (meetingId: string) => void
}

export function registerFunilIpc({
  appOrigin,
  funil,
  proposta,
  log = () => undefined,
}: {
  appOrigin: string
  funil: FunilService
  proposta?: FunilPropostaIpcDeps
  log?: (message: string) => void
}): void {
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
  if (proposta) registerPropostaIpc(appOrigin, funil, proposta, falhou, log)
}

/** Contrato 113 (R38 a R40, R47): os quatro canais da proposta da reunião. */
function registerPropostaIpc(appOrigin: string, funil: FunilService, deps: FunilPropostaIpcDeps, falhou: (channel: string, error: unknown) => typeof FALHOU, log: (message: string) => void): void {
  const { funnel, proposals, store, onChange } = deps

  async function view(meetingId: string): Promise<FunilPropostaView> {
    const arquivo = await proposals.get(meetingId)
    const duplicata = arquivo?.proposta?.acao === 'criar' ? duplicataDa(arquivo, await store.read()) : null
    return { arquivo, detectando: funnel.running(meetingId), duplicata }
  }

  handle('scribe:funil-proposta-get', appOrigin, async (_event, request): Promise<FunilPropostaView | FunilPropostaRecusa> => {
    const pedido = parseFunilPedido('scribe:funil-proposta-get', request)
    if (pedido === null) return PROPOSTA_INVALIDA
    return view(pedido.meetingId).catch((error: unknown) => {
      falhou('scribe:funil-proposta-get', error)
      return PROPOSTA_LEITURA_FALHOU
    })
  })
  /** Um "aplicar" por reunião: o segundo clique enquanto o primeiro grava recebe a mesma resposta (como `jobs` no `extract.ts`). */
  const aplicando = new Map<string, Promise<FunilPropostaAplicarResult>>()
  async function aplicar(pedido: InvokeChannels['scribe:funil-proposta-aplicar']['request']): Promise<FunilPropostaAplicarResult> {
    try {
      const result = await applyProposal({ store, funil, proposals, meetings: deps.meetings }, pedido)
      if (result.ok) onChange(pedido.meetingId)
      return result
    } catch (error) {
      return falhou('scribe:funil-proposta-aplicar', error)
    }
  }
  handle('scribe:funil-proposta-aplicar', appOrigin, async (_event, request): Promise<FunilPropostaAplicarResult> => {
    const parsed = FUNIL_PEDIDOS['scribe:funil-proposta-aplicar'].safeParse(request)
    if (!parsed.success) {
      // E-mail inválido digitado no cartão: a recusa diz qual, antes de qualquer gravação.
      const email = parsed.error.issues.find((issue) => issue.message.startsWith(EMAIL_INVALIDO_PREFIXO))
      return email ? { ok: false, erro: 'invalido', mensagem: email.message } : INVALIDO
    }
    const pedido = parsed.data
    const atual = aplicando.get(pedido.meetingId)
    if (atual) return atual
    const run = aplicar(pedido).finally(() => {
      if (aplicando.get(pedido.meetingId) === run) aplicando.delete(pedido.meetingId)
    })
    aplicando.set(pedido.meetingId, run)
    return run
  })
  handle('scribe:funil-proposta-descartar', appOrigin, async (_event, request): Promise<{ ok: boolean }> => {
    const pedido = parseFunilPedido('scribe:funil-proposta-descartar', request)
    if (pedido === null) return { ok: false }
    try {
      const result = await dismissProposal({ proposals }, pedido.meetingId)
      if (result.ok) onChange(pedido.meetingId)
      return { ok: result.ok }
    } catch (error) {
      falhou('scribe:funil-proposta-descartar', error)
      return { ok: false }
    }
  })
  // R40: roda mesmo com `detectarNasReunioes` desligado e substitui o arquivo existente. O resultado chega pelo evento;
  // sem reunião ou sem resumo nada é gravado, e o evento sai assim mesmo para a tela sair do "Detectando…".
  handle('scribe:funil-proposta-detectar', appOrigin, async (_event, request): Promise<FunilPropostaView | FunilPropostaRecusa> => {
    const pedido = parseFunilPedido('scribe:funil-proposta-detectar', request)
    if (pedido === null) return PROPOSTA_INVALIDA
    const { meetingId } = pedido
    void funnel.detect(meetingId).then(
      (arquivo) => {
        if (arquivo === null) onChange(meetingId)
      },
      (error: unknown) => {
        log(`[funil] detecção sob demanda falhou: ${error instanceof Error ? error.message : String(error)}`)
        onChange(meetingId)
      },
    )
    try {
      return { ...(await view(meetingId)), detectando: true }
    } catch (error) {
      falhou('scribe:funil-proposta-detectar', error)
      return PROPOSTA_LEITURA_FALHOU
    }
  })
}
