// Funil de vendas (contrato 107): contatos, empresas, oportunidades e etapas num arquivo só,
// `userData/funil.json`. Os tipos ficam aqui; o esquema zod que valida o arquivo está em `funil-schema.ts` (o
// renderer usa só os tipos e não carrega o zod) e a lógica pura em `funil-logic.ts`. Quem grava é
// `main/funil/store.ts`.

export const FUNIL_FILE = 'funil.json'
export const FUNIL_VERSION = 1
/** Cópias diárias `funil.json.bak-<AAAA-MM-DD>` mantidas (R1). */
export const FUNIL_BACKUPS_MAX = 7
export const FUNIL_CONTATOS_MAX = 10_000
export const FUNIL_EMPRESAS_MAX = 2_000
export const FUNIL_OPORTUNIDADES_MAX = 5_000
export const FUNIL_EVENTOS_MAX = 50_000
/** Nome do contato, da empresa e título da oportunidade. */
export const FUNIL_NOME_MAX = 200
/** E-mails por contato (e domínios por empresa). */
export const FUNIL_EMAILS_MAX = 10
export const FUNIL_TELEFONES_MAX = 10
export const FUNIL_NOTAS_MAX = 20_000
export const FUNIL_ETAPA_NOME_MAX = 60
/** E-mails ligados a uma oportunidade (e os outros vínculos dela: contatos, reuniões e conversas). */
export const FUNIL_OPORTUNIDADE_EMAILS_MAX = 200
export const FUNIL_DIAS_ESFRIAR_PADRAO = 7

/** Domínios de e-mail pessoal: não ligam o contato a empresa nenhuma (R5). */
export const PROVEDORES_PESSOAIS: readonly string[] = [
  'gmail.com',
  'googlemail.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'yahoo.com.br',
  'icloud.com',
  'me.com',
  'uol.com.br',
  'bol.com.br',
  'terra.com.br',
  'protonmail.com',
  'proton.me',
  'globo.com',
  'ig.com.br',
]

export type ContatoOrigem = 'manual' | 'importacao' | 'reuniao' | 'email' | 'whatsapp' | 'agenda' | 'assistente'
export type OportunidadeOrigem = 'manual' | 'reuniao' | 'assistente'
export type EtapaTipo = 'aberta' | 'ganho' | 'perdido'
export type EventoFunilTipo = 'criada' | 'etapa' | 'valor' | 'proximo-passo' | 'nota' | 'vinculo' | 'ganho' | 'perdido' | 'reaberta'

export interface Contato {
  id: string
  nome: string
  /** Normalizados (`trim` e minúsculas). */
  emails: string[]
  /** E.164 quando possível (`+5511…`). */
  telefones: string[]
  empresaId: string | null
  cargo: string | null
  notas: string
  /** `5511…@s.whatsapp.net` quando ligado. */
  whatsappChatId: string | null
  origem: ContatoOrigem
  criadoEm: number
  atualizadoEm: number
  arquivado: boolean
}

export interface Empresa {
  id: string
  nome: string
  /** Em minúsculas, sem `@` (`acme.com.br`). */
  dominios: string[]
  site: string | null
  notas: string
  criadoEm: number
  atualizadoEm: number
}

export interface Etapa {
  id: string
  nome: string
  tipo: EtapaTipo
  ordem: number
}

/** E-mail ligado à oportunidade: o `id` é o UID na conta; o resumo fica porque o cache de e-mail só guarda 200 por pasta. */
export interface OportunidadeEmail {
  accountId: string
  id: string
  assunto: string
  de: string
  data: number
}

export interface ProximoPasso {
  texto: string
  /** `AAAA-MM-DD`. */
  data: string | null
}

export interface Oportunidade {
  id: string
  titulo: string
  empresaId: string | null
  contatoIds: string[]
  etapaId: string
  /** Posição dentro da coluna (0 é o topo). */
  ordem: number
  /** Centavos de BRL, inteiro `>= 0`. */
  valor: number | null
  /** `AAAA-MM-DD`. */
  previsao: string | null
  proximoPasso: ProximoPasso | null
  /** Fica o id mesmo de reunião apagada (a linha do tempo mostra "Reunião apagada"). */
  meetingIds: string[]
  whatsappChatIds: string[]
  emails: OportunidadeEmail[]
  origem: OportunidadeOrigem
  motivoPerda: string | null
  criadoEm: number
  atualizadoEm: number
  /** Última mudança de etapa. */
  movidoEm: number
  fechadoEm: number | null
  arquivado: boolean
}

/** Histórico do funil; e-mails e reuniões não entram (são derivados). `de`/`para` são nomes de etapa. */
export interface EventoFunil {
  id: string
  oportunidadeId: string
  at: number
  tipo: EventoFunilTipo
  texto: string
  de?: string
  para?: string
}

/** Sugestão dispensada: `email:<addr>`, `tel:<e164>`, `wa:<chatId>` ou `reuniao:<meetingId>`. */
export interface Ignorado {
  chave: string
  at: number
}

/** O arquivo `funil.json` inteiro. */
export interface FunilState {
  version: typeof FUNIL_VERSION
  contatos: Contato[]
  empresas: Empresa[]
  oportunidades: Oportunidade[]
  etapas: Etapa[]
  eventos: EventoFunil[]
  ignorados: Ignorado[]
  /** Último aviso de oportunidades esfriadas. */
  ultimoAvisoEm: number | null
}

/** Sem `id` cria; com `id` edita. Campo ausente na edição fica como está. */
export interface ContatoInput {
  id?: string | undefined
  nome: string
  emails: string[]
  telefones: string[]
  empresaId?: string | null | undefined
  /** Acha a empresa pelo nome sem acento e sem caixa ou cria (D20). */
  empresaNome?: string | null | undefined
  cargo?: string | null | undefined
  notas?: string | undefined
  whatsappChatId?: string | null | undefined
}

export interface EmpresaInput {
  id?: string | undefined
  nome: string
  dominios: string[]
  site?: string | null | undefined
  notas?: string | undefined
}

export interface OportunidadeInput {
  id?: string | undefined
  titulo: string
  empresaId?: string | null | undefined
  empresaNome?: string | null | undefined
  contatoIds?: string[] | undefined
  etapaId?: string | undefined
  valor?: number | null | undefined
  previsao?: string | null | undefined
  proximoPasso?: ProximoPasso | null | undefined
  meetingIds?: string[] | undefined
  whatsappChatIds?: string[] | undefined
  emails?: Oportunidade['emails'] | undefined
  origem?: OportunidadeOrigem | undefined
  motivoPerda?: string | null | undefined
}

export interface EtapaInput {
  id?: string | undefined
  nome: string
  tipo: EtapaTipo
}

/**
 * `limite`: passaria de um dos limites; `etapa-fixa`: Ganho e Perdido não saem nem mudam de tipo; `etapa-em-uso`:
 * etapa com oportunidade; `empresa-em-uso`: empresa com contato ou oportunidade; `duplicado`: e-mail ou telefone de
 * outro contato na edição; `nao-fechada`: arquivar oportunidade aberta; `invalido`: campo fora do formato.
 */
export type FunilErro = 'limite' | 'etapa-fixa' | 'etapa-em-uso' | 'empresa-em-uso' | 'nao-encontrado' | 'duplicado' | 'nao-fechada' | 'invalido'

export type FunilResult<T> = { ok: true; value: T; state: FunilState } | { ok: false; erro: FunilErro }
