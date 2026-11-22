// Tarefas (contrato 121): a lista única de tarefas ligadas a reunião, funil, e-mail, WhatsApp e Assistente, num
// arquivo só, `userData/tarefas.json`. Os tipos ficam aqui; o esquema zod que valida o arquivo está em
// `tarefas-schema.ts` (o renderer usa só os tipos e não carrega o zod), a lógica pura em `tarefas-logic.ts` e as
// sugestões em `tarefas-sugestoes.ts`. Quem grava é `main/tarefas/store.ts`.

export const TAREFAS_FILE = 'tarefas.json'
export const TAREFAS_VERSION = 1
export const TAREFAS_MAX = 5_000
export const TAREFA_TITULO_MAX = 200
export const TAREFA_DETALHE_MAX = 2_000
/** Eventos por tarefa; passando disso, sai o mais antigo. */
export const TAREFA_HISTORICO_MAX = 50
export const TAREFAS_IGNORADOS_MAX = 2_000
/** Cópias diárias `tarefas.json.bak-<AAAA-MM-DD>` mantidas. */
export const TAREFAS_BACKUPS_MAX = 7
/** Sugestões devolvidas de uma vez (R26). */
export const SUGESTOES_MAX = 100
/** Reuniões e conversas que entram nas sugestões, pela data (R26). */
export const SUGESTOES_DIAS = 30
/** Feitas e canceladas que a visão "Feitas" mostra, pelo `feitaEm` (R2). */
export const FEITAS_DIAS = 90
/** Linhas das quatro seções do `TAREFAS.md` (R27). */
export const TAREFAS_MD_MAX = 200

export type TarefaStatus = 'aberta' | 'feita' | 'cancelada'

export type ResponsavelTarefa = { tipo: 'eu' } | { tipo: 'contato'; contatoId: string } | { tipo: 'nome'; nome: string }

export type OrigemTarefa =
  /** `texto` = a tarefa do resumo, para casar a linha da tabela com a tarefa (R22). */
  | { tipo: 'reuniao'; meetingId: string; texto: string }
  | { tipo: 'funil'; oportunidadeId: string }
  | { tipo: 'email'; accountId: string; id: string; assunto: string }
  | { tipo: 'whatsapp'; chatId: string; texto?: string }
  | { tipo: 'assistente' }
  | { tipo: 'automacao'; agentId: string }
  | { tipo: 'manual' }
  | { tipo: 'migracao'; de: 'proximo-passo' | 'lembrete' }

/** E-mail ligado à tarefa; `mailbox` é a pasta do servidor quando ele não está na INBOX do app (`null` no caso comum). */
export interface EmailDaTarefa {
  accountId: string
  id: string
  assunto: string
  mailbox: string | null
}

export interface VinculosTarefa {
  oportunidadeId: string | null
  contatoIds: string[]
  empresaId: string | null
  meetingId: string | null
  email: EmailDaTarefa | null
  whatsappChatId: string | null
}

export type EventoTarefaTipo = 'criada' | 'prazo' | 'lembrete' | 'feita' | 'reaberta' | 'cancelada' | 'vinculo' | 'responsavel'

export interface EventoTarefa {
  tipo: EventoTarefaTipo
  em: number
  detalhe?: string
}

export interface Tarefa {
  /** uuid. */
  id: string
  /** 1..200, aparado. */
  titulo: string
  /** 0..2000. */
  detalhe: string
  status: TarefaStatus
  importante: boolean
  /** `AAAA-MM-DD`. */
  prazo: string | null
  /** Epoch ms do aviso; `null` = sem aviso. */
  lembreteEm: number | null
  lembreteDisparadoEm: number | null
  responsavel: ResponsavelTarefa
  origem: OrigemTarefa
  vinculos: VinculosTarefa
  /** Até 50; o mais antigo é descartado. */
  historico: EventoTarefa[]
  criadaEm: number
  atualizadaEm: number
  /** Momento do fechamento, feita ou cancelada (D-10); `null` enquanto aberta. */
  feitaEm: number | null
}

/** Sugestão que a pessoa ignorou (R26); `chave` = `${origem}:${ref}:${slug(texto)}`. */
export interface SugestaoIgnorada {
  chave: string
  em: number
}

export interface TarefasArquivo {
  version: typeof TAREFAS_VERSION
  tarefas: Tarefa[]
  ignorados: SugestaoIgnorada[]
  /** Quando a migração do próximo passo e dos lembretes rodou (R35); `null` = ainda não. */
  migradoEm: number | null
  /** Último aviso diário "Hoje" (R32). */
  ultimoAvisoHojeEm: number | null
}

/** O que o store grava ao criar: tudo já resolvido (lembrete calculado, vínculos da oportunidade somados). */
export interface TarefaNova {
  titulo: string
  detalhe: string
  prazo: string | null
  lembreteEm: number | null
  importante: boolean
  responsavel: ResponsavelTarefa
  origem: OrigemTarefa
  vinculos: VinculosTarefa
}

/** Edição parcial: só o que vier muda. E-mail e conversa ligados não são editáveis. */
export interface TarefaPatch {
  titulo?: string | undefined
  detalhe?: string | undefined
  prazo?: string | null | undefined
  lembreteEm?: number | null | undefined
  importante?: boolean | undefined
  responsavel?: ResponsavelTarefa | undefined
  vinculos?:
    | {
        oportunidadeId?: string | null | undefined
        contatoIds?: string[] | undefined
        empresaId?: string | null | undefined
        meetingId?: string | null | undefined
      }
    | undefined
}

/**
 * O que a tela e o Assistente mandam ao serviço: como `TarefaNova`, mas só `titulo` e `origem` obrigatórios e o
 * lembrete pedido em vez de calculado (`'padrao'`: do prazo e da hora das Configurações; `'nenhum'`; ou epoch ms).
 */
export interface TarefaInput {
  titulo: string
  origem: OrigemTarefa
  detalhe?: string | undefined
  prazo?: string | null | undefined
  lembrete?: 'padrao' | 'nenhum' | number | undefined
  importante?: boolean | undefined
  responsavel?: ResponsavelTarefa | undefined
  vinculos?: Partial<VinculosTarefa> | undefined
}

/**
 * `limite`: passaria de um dos limites; `nao-encontrado`: id que não existe; `invalido`: campo fora do formato;
 * `fechada`: feita ↔ cancelada sem passar por Reabrir (D-10).
 */
export type TarefasErro = 'limite' | 'nao-encontrado' | 'invalido' | 'fechada'

export type TarefasResult<T> = { ok: true; value: T; state: TarefasArquivo } | { ok: false; erro: TarefasErro }

/** Texto de cada erro do store, para a tela mostrar como veio. */
export const TAREFAS_ERRO_TEXTO: Record<TarefasErro, string> = {
  limite: 'A lista chegou ao limite de tarefas.',
  'nao-encontrado': 'Essa tarefa não existe mais. A lista foi atualizada.',
  invalido: 'Algum campo está fora do formato. Confira e tente de novo.',
  fechada: 'Reabra a tarefa antes de mudar o estado dela.',
}

/** Candidata da aba Sugestões (R26), calculada sob demanda e nunca gravada. */
export interface SugestaoTarefa {
  chave: string
  texto: string
  origem: { tipo: 'reuniao'; meetingId: string; titulo: string } | { tipo: 'analise'; meetingId: string; titulo: string } | { tipo: 'whatsapp'; chatId: string; nome: string }
  /** Início da reunião ou última mensagem da conversa. */
  em: number
  prazo: string | null
  /** Quem a fonte aponta, como veio (o resumo diz "Você"). */
  responsavelTexto: string | null
}
