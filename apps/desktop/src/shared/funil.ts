// Funil de vendas (contrato 107): contatos, empresas, oportunidades e etapas num arquivo só,
// `userData/funil.json`. Os tipos ficam aqui; o esquema zod que valida o arquivo está em `funil-schema.ts` (o
// renderer usa só os tipos e não carrega o zod) e a lógica pura em `funil-logic.ts`. Quem grava é
// `main/funil/store.ts`.
import type { CampoImport, CodificacaoImport, SeparadorCsv } from './funil-import'

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
export type EventoFunilTipo = 'criada' | 'etapa' | 'valor' | 'proximo-passo' | 'nota' | 'vinculo' | 'ganho' | 'perdido' | 'reaberta' | 'tarefa'

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

/** Contrato 124 (D9): o próximo passo da oportunidade, derivado da primeira tarefa aberta ligada a ela. */
export interface ProximoPassoDerivado {
  texto: string
  /** `AAAA-MM-DD`. */
  data: string | null
  tarefaId: string
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
  /** @deprecated Legado (R35): só a migração lê; nunca mais gravado. A tela usa FunilView.proximosPassos. */
  proximoPasso?: ProximoPasso | null
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
  /** Contrato 124 (R10, D10): a tarefa ligada que foi criada, concluída ou mudou de prazo (`texto` = o título). */
  tarefa?: { id: string; acao: 'criada' | 'feita' | 'prazo' }
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
  /** Último aviso de oportunidades esfriadas (contrato 115). Sem uso desde o contrato 124: o aviso "Hoje" usa `tarefas.json`. */
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

// ---------------------------------------------------------------------------------------------------------------
// Contrato 110: o que o serviço e os canais do funil devolvem ao renderer.

/** O funil como a tela usa: o arquivo e a última interação (R7) de cada oportunidade não arquivada, por id. */
export interface FunilView {
  state: FunilState
  ultimas: Record<string, number>
  /**
   * Contrato 124 (D9): o próximo passo de cada oportunidade aberta e não arquivada, derivado das tarefas
   * (`proximaDaOportunidade`); `null` sem tarefa aberta. Fechada ou arquivada não tem chave.
   */
  proximosPassos: Record<string, ProximoPassoDerivado | null>
}

/** `falhou`: exceção ao gravar (disco cheio, permissão); o resto vem do store ou da checagem do pedido. */
export type FunilActionResult = { ok: true; id: string | null; mesclado?: boolean } | { ok: false; erro: FunilErro | 'falhou'; mensagem: string }

/** Texto de cada erro do store, para a tela mostrar como veio. */
export const FUNIL_ERRO_TEXTO: Record<FunilErro, string> = {
  limite: 'O funil chegou ao limite de itens.',
  'etapa-fixa': 'Ganho e Perdido não podem ser apagadas nem mudar de tipo.',
  'etapa-em-uso': 'Mova as oportunidades desta etapa antes de apagá-la.',
  'empresa-em-uso': 'Tire os contatos e as oportunidades desta empresa antes de apagá-la.',
  'nao-encontrado': 'Esse item não existe mais. A lista foi atualizada.',
  duplicado: 'Esse e-mail ou telefone já é de outro contato.',
  'nao-fechada': 'Só oportunidade ganha ou perdida pode ser arquivada.',
  invalido: 'Algum campo está fora do formato. Confira e tente de novo.',
}
export const FUNIL_FALHOU_TEXTO = 'Não foi possível salvar. Tente de novo.'
export const FUNIL_EXPIRADO_TEXTO = 'A leitura do arquivo expirou. Abra o arquivo de novo.'
/** O pedido nem chegou ao main (o renderer devolve este texto). */
export const FUNIL_TRANSPORTE_TEXTO = 'Não foi possível falar com o app. Tente de novo.'

/** Item da linha do tempo (R29). Reunião apagada: `apagada: true`, título "Reunião apagada" e `at: null` (fim da lista). */
export type ItemLinhaDoTempo =
  | { tipo: 'reuniao'; at: number | null; meetingId: string; titulo: string; resumo: string | null; apagada: boolean }
  | { tipo: 'email'; at: number; accountId: string; messageId: string; mailbox: string | null; assunto: string; de: string; para: string; noCache: boolean }
  | { tipo: 'whatsapp'; at: number; chatId: string; nome: string; ultimaMensagem: string }
  | { tipo: 'evento'; at: number; evento: EventoFunil }
  /**
   * Contrato 124 (R18): tarefa criada ou concluída. `origem` resumida em pt-BR ("da reunião Kickoff"); apagada:
   * o título do evento, `prazo: null` e `existe: false`.
   */
  | { tipo: 'tarefa'; at: number; tarefaId: string; titulo: string; prazo: string | null; origem: string; acao: 'criada' | 'feita'; existe: boolean }

/** Leitura que falhou no main (exceção), com o texto para a tela. */
export type FunilFalha = { ok: false; erro: 'falhou'; mensagem: string }
export const FUNIL_LEITURA_FALHOU_TEXTO = 'Não foi possível ler o funil. Tente de novo.'

export type FunilTimelineResult =
  | { ok: true; itens: ItemLinhaDoTempo[]; ultimaInteracao: number | null; whatsappChatIds: string[] }
  | { ok: false; erro: 'nao-encontrado' | 'invalido' }
  | FunilFalha

/** Canais de onde vêm as sugestões de contato; a agenda não é fonte (R11). */
export type SugestaoCanal = 'reuniao' | 'email' | 'whatsapp'

/** Candidato a contato (R11, R12), agrupado pela chave (`email:<addr>`, `tel:<e164>` ou `wa:<chatId>`). */
export interface Sugestao {
  chave: string
  nome: string
  canais: SugestaoCanal[]
  interacoes: number
  ultimaEm: number
  /** O canal com mais interações (empate: reunião, e-mail, WhatsApp). */
  origem: ContatoOrigem
  email: string | null
  telefone: string | null
  whatsappChatId: string | null
}

/** "Importar…" (R13 a R15): a prévia do arquivo escolhido; o `token` identifica a leitura guardada no main. */
export type FunilImportAbrirResult =
  | {
      ok: true
      token: string
      arquivo: string
      tipo: 'csv' | 'vcard'
      separador: SeparadorCsv | null
      codificacao: CodificacaoImport
      colunas: string[]
      mapeamento: CampoImport[]
      previa: string[][]
      total: number
      validas: number
    }
  | { ok: false; erro: 'cancelado' | 'arquivo-grande' | 'linhas-demais' | 'formato' | 'falhou' }

/** Confirmar (R16) ou só contar (`simulado: true`, nada gravado). */
export type FunilImportConfirmarResult =
  | { ok: true; simulado: false; criados: number; atualizados: number; ignorados: number }
  | { ok: true; simulado: true; validas: number; ignorados: number }
  | { ok: false; erro: FunilErro | 'expirado' | 'falhou'; mensagem: string }
