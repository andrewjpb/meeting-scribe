// Lógica pura do funil (contrato 107): normalização e comparação de e-mail e telefone (R3), domínio e empresa (R5),
// etapas padrão, última interação e "esfriou" (R7), totais do cabeçalho e o `formatarBRL` usado por todas as telas e
// pelo `FUNIL.md`. Sem Node e sem Electron: roda no main, no renderer e nos testes.
import { PROVEDORES_PESSOAIS, type Empresa, type Etapa, type FunilState, type Oportunidade } from './funil'

const DIA_MS = 86_400_000

/** `trim` e minúsculas; `null` sem o formato `local@dominio.tld`. */
export function normalizarEmail(texto: string): string | null {
  const email = texto.trim().toLowerCase()
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return null
  return email
}

/**
 * E.164 quando dá (R3): só os dígitos, sem o `0` de tronco; 10 ou 11 dígitos sem `+` ganham `+55`, 12 ou 13
 * começando com `55` ganham `+`; com `+` e outro país fica `+<dígitos>`; o resto fica com os dígitos limpos. Sem
 * dígito nenhum, `null`.
 */
export function normalizarTelefone(texto: string): string | null {
  const internacional = texto.trim().startsWith('+')
  let digitos = texto.replace(/\D/g, '')
  if (!internacional && digitos.startsWith('0')) digitos = digitos.slice(1)
  if (!digitos) return null
  // Com `+` o número já traz o país: estrangeiro fica como veio, sem ganhar `+55`.
  if (internacional && !digitos.startsWith('55')) return `+${digitos}`
  if (!internacional && (digitos.length === 10 || digitos.length === 11)) return `+55${digitos}`
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return `+${digitos}`
  return digitos
}

/**
 * Forma de comparação de um telefone já normalizado: celular brasileiro sem o nono dígito
 * (`+5511987654321` -> `+551187654321`); o resto fica igual. Dois telefones são o mesmo quando as chaves batem.
 */
export function chaveTelefone(normalizado: string): string {
  const br = /^\+55(\d{2})9(\d{8})$/.exec(normalizado)
  return br ? `+55${br[1]}${br[2]}` : normalizado
}

/** Iguais depois de normalizar ou, os dois brasileiros com o mesmo DDD, iguais sem o nono dígito (R3). */
export function mesmoTelefone(a: string, b: string): boolean {
  const na = normalizarTelefone(a)
  const nb = normalizarTelefone(b)
  if (na === null || nb === null) return false
  return na === nb || chaveTelefone(na) === chaveTelefone(nb)
}

/** Tira os acentos (`Negociação` -> `Negociacao`); caixa e espaços ficam. */
export function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/** Domínio do e-mail normalizado; `null` quando não é e-mail. */
export function dominioDe(email: string): string | null {
  const normalizado = normalizarEmail(email)
  return normalizado ? normalizado.slice(normalizado.lastIndexOf('@') + 1) : null
}

export function ehProvedorPessoal(dominio: string): boolean {
  return PROVEDORES_PESSOAIS.includes(dominio.trim().toLowerCase())
}

/** Segundo nível comum antes do código do país (`com.br`, `org.br`, `co.uk`). */
const SEGUNDO_NIVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ac', 'ind', 'adv', 'art', 'eng', 'med', 'mil', 'nom', 'inf', 'tv'])

/** Nome sugerido para a empresa de um domínio: o rótulo antes do TLD, com inicial maiúscula (`mail.acme.com.br` -> `Acme`). */
export function nomeEmpresaDoDominio(dominio: string): string {
  const rotulos = dominio.trim().toLowerCase().replace(/^@/, '').split('.').filter(Boolean)
  if (rotulos.length > 1) rotulos.pop()
  const penultimo = rotulos.at(-1)
  if (rotulos.length > 1 && penultimo !== undefined && SEGUNDO_NIVEL.has(penultimo)) rotulos.pop()
  const nome = rotulos.at(-1) ?? ''
  return nome.charAt(0).toUpperCase() + nome.slice(1)
}

/** A empresa que tem o domínio do e-mail em `dominios`; provedor pessoal e e-mail inválido não ligam (R5). */
export function empresaPorDominio(empresas: readonly Empresa[], email: string): Empresa | null {
  const dominio = dominioDe(email)
  if (!dominio || ehProvedorPessoal(dominio)) return null
  return empresas.find((empresa) => empresa.dominios.includes(dominio)) ?? null
}

/** As 6 etapas de um funil novo. */
export function etapasPadrao(newId: () => string): Etapa[] {
  const etapas: { nome: string; tipo: Etapa['tipo'] }[] = [
    { nome: 'Contato', tipo: 'aberta' },
    { nome: 'Descoberta', tipo: 'aberta' },
    { nome: 'Proposta', tipo: 'aberta' },
    { nome: 'Negociação', tipo: 'aberta' },
    { nome: 'Ganho', tipo: 'ganho' },
    { nome: 'Perdido', tipo: 'perdido' },
  ]
  return etapas.map((etapa, ordem) => ({ id: newId(), ...etapa, ordem }))
}

/**
 * Última interação (R7): o maior entre `movidoEm`, `atualizadoEm`, o início das reuniões ligadas, a data dos e-mails
 * ligados (os do cache e os guardados na oportunidade) e a última mensagem dos chats ligados.
 */
export function ultimaInteracao(input: {
  oportunidade: Oportunidade
  reunioes: readonly { startedAt: string }[]
  emails: readonly { date: number }[]
  whatsapp: readonly { at: number }[]
}): number {
  const { oportunidade } = input
  const datas = [
    oportunidade.movidoEm,
    oportunidade.atualizadoEm,
    ...input.reunioes.map((reuniao) => Date.parse(reuniao.startedAt)),
    ...input.emails.map((email) => email.date),
    ...input.whatsapp.map((mensagem) => mensagem.at),
    ...oportunidade.emails.map((email) => email.data),
  ]
  return datas.reduce((maior, data) => (Number.isFinite(data) && data > maior ? data : maior), oportunidade.movidoEm)
}

/** Aberta e sem interação há mais de `dias` dias. */
export function esfriada(_oportunidade: Oportunidade, etapa: Etapa, ultima: number, dias: number, now: number): boolean {
  return etapa.tipo === 'aberta' && now - ultima > dias * DIA_MS
}

/** Próximo passo (o derivado das tarefas, contrato 124) com data antes de `hoje` (`AAAA-MM-DD` local). */
export function passoVencido(passo: { data: string | null } | null | undefined, hoje: string): boolean {
  return passo?.data != null && passo.data < hoje
}

/** Previsão antes de `hoje` (`AAAA-MM-DD` local). */
export function previsaoVencida(previsao: string | null, hoje: string): boolean {
  return previsao !== null && previsao < hoje
}

/** Dias inteiros desde a última mudança de etapa. */
export function diasNaEtapa(movidoEm: number, now: number): number {
  return Math.max(0, Math.floor((now - movidoEm) / DIA_MS))
}

/** `AAAA-MM` de um instante no fuso pedido. */
function mesNoFuso(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date(at)).slice(0, 7)
}

/**
 * Cabeçalho do kanban, em centavos: oportunidades abertas, o valor delas e o ganho no mês de `now` (pelo `fechadoEm`
 * no fuso `timeZone`). Arquivada fica fora das abertas, mas o ganho arquivado conta no mês (arquivar não apaga receita).
 */
export function totaisDoFunil(state: FunilState, now: number, timeZone: string): { abertas: number; emAberto: number; ganhoNoMes: number } {
  const tipos = new Map(state.etapas.map((etapa) => [etapa.id, etapa.tipo]))
  const mes = mesNoFuso(now, timeZone)
  let abertas = 0
  let emAberto = 0
  let ganhoNoMes = 0
  for (const oportunidade of state.oportunidades) {
    const tipo = tipos.get(oportunidade.etapaId)
    if (tipo === 'aberta' && !oportunidade.arquivado) {
      abertas++
      emAberto += oportunidade.valor ?? 0
    } else if (tipo === 'ganho' && oportunidade.fechadoEm !== null && mesNoFuso(oportunidade.fechadoEm, timeZone) === mes) {
      ganhoNoMes += oportunidade.valor ?? 0
    }
  }
  return { abertas, emAberto, ganhoNoMes }
}

const brlInteiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 })
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

/** `R$ 38.000` com centavos zerados, `R$ 1.250,50` com centavos; sem valor, um travessão. */
export function formatarBRL(centavos: number | null): string {
  if (centavos === null) return '\u2014'
  return centavos % 100 === 0 ? brlInteiro.format(centavos / 100) : brl.format(centavos / 100)
}
