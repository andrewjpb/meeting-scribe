// Formatação e filtros da tela Oportunidades (contrato 112, R21 a R25). Sem DOM: testado em
// test/renderer/funil-format.test.ts. Os cálculos do funil (totais, esfriada, BRL) vêm de `shared/funil-logic.ts`.
import type { Etapa, EtapaTipo, FunilState, Oportunidade, ProximoPasso } from '@shared/funil'
import { formatarBRL, semAcento, totaisDoFunil } from '@shared/funil-logic'

const DIA_MS = 86_400_000

/** Filtros do kanban (R23), na ordem do `Segmented`; o padrão é Abertas. */
export type FunilFiltro = 'abertas' | 'ganhas' | 'perdidas' | 'todas'
export const FUNIL_FILTROS: readonly { value: FunilFiltro; label: string }[] = [
  { value: 'abertas', label: 'Abertas' },
  { value: 'ganhas', label: 'Ganhas' },
  { value: 'perdidas', label: 'Perdidas' },
  { value: 'todas', label: 'Todas' },
]

/** Ganhas e Perdidas mostram por padrão só as fechadas nestes dias (R23). */
export const FECHADAS_RECENTES_DIAS = 90

/** Linhas do `SearchPicker` (R25). */
export const PICKER_MAX = 8

/** Os tipos de etapa que cada filtro expande. */
const TIPOS: Record<FunilFiltro, readonly EtapaTipo[]> = {
  abertas: ['aberta'],
  ganhas: ['ganho'],
  perdidas: ['perdido'],
  todas: ['aberta', 'ganho', 'perdido'],
}

/** Texto comparável: sem acento, sem caixa e sem espaço nas pontas. */
export function chaveBusca(texto: string): string {
  return semAcento(texto).toLowerCase().trim()
}

/** As etapas na ordem do quadro, cada uma expandida ou recolhida pelo filtro (R23). */
export function colunasVisiveis(etapas: readonly Etapa[], filtro: FunilFiltro): { etapa: Etapa; recolhida: boolean }[] {
  return [...etapas].sort((a, b) => a.ordem - b.ordem).map((etapa) => ({ etapa, recolhida: !TIPOS[filtro].includes(etapa.tipo) }))
}

/**
 * As oportunidades que o filtro mostra (as das etapas expandidas por ele), sem as arquivadas, achadas pela busca no
 * título, no nome da empresa e no nome de um contato, sem acento e sem caixa (R21, R23).
 */
export function filtrarOportunidades(state: FunilState, filtro: FunilFiltro, busca: string): Oportunidade[] {
  const tipos = new Map(state.etapas.map((etapa) => [etapa.id, etapa.tipo]))
  const termo = chaveBusca(busca)
  const empresas = new Map(state.empresas.map((empresa) => [empresa.id, chaveBusca(empresa.nome)]))
  const contatos = new Map(state.contatos.map((contato) => [contato.id, chaveBusca(contato.nome)]))
  return state.oportunidades.filter((oportunidade) => {
    const tipo = tipos.get(oportunidade.etapaId)
    if (oportunidade.arquivado || tipo === undefined || !TIPOS[filtro].includes(tipo)) return false
    if (!termo) return true
    const textos = [chaveBusca(oportunidade.titulo), oportunidade.empresaId ? (empresas.get(oportunidade.empresaId) ?? '') : '', ...oportunidade.contatoIds.map((id) => contatos.get(id) ?? '')]
    return textos.some((texto) => texto.includes(termo))
  })
}

/** As fechadas nos últimos 90 dias (R23); sem `fechadoEm`, fica de fora. */
export function fechadasRecentes<T extends Pick<Oportunidade, 'fechadoEm'>>(oportunidades: readonly T[], now: number): T[] {
  const desde = now - FECHADAS_RECENTES_DIAS * DIA_MS
  return oportunidades.filter((oportunidade) => oportunidade.fechadoEm !== null && oportunidade.fechadoEm >= desde)
}

/** `AAAA-MM-DD` de um instante no fuso do Mac (o "hoje" de `passoVencido` e `previsaoVencida`). */
export function diaLocal(at: number): string {
  const data = new Date(at)
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
}

/** `25/11` de `2026-11-25`. */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split('-')
  return `${d}/${mes}`
}

/** Linha de totais (R21): "5 abertas · R$ 392.500 em aberto · R$ 75.000 ganho em novembro". */
export function textoTotais(state: FunilState, now: number, timeZone: string): string {
  const totais = totaisDoFunil(state, now, timeZone)
  const mes = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone }).format(new Date(now))
  return `${totais.abertas} ${totais.abertas === 1 ? 'aberta' : 'abertas'} · ${formatarBRL(totais.emAberto)} em aberto · ${formatarBRL(totais.ganhoNoMes)} ganho em ${mes}`
}

/** O próximo passo do cartão (R23): o texto e a data curta, ou "Sem próximo passo". */
export function textoProximoPasso(proximoPasso: ProximoPasso | null): { texto: string; data: string | null } {
  if (!proximoPasso) return { texto: 'Sem próximo passo', data: null }
  return { texto: proximoPasso.texto, data: proximoPasso.data ? diaCurto(proximoPasso.data) : null }
}

/**
 * Valor digitado em reais (R25) para centavos: `1.234,56` -> `123456`, `120.000` -> `12000000`, `1500` -> `150000`;
 * com ou sem "R$". Fora do formato brasileiro (ou vazio), `null`.
 */
export function parseValor(texto: string): number | null {
  const limpo = texto.replace(/R\$/i, '').replace(/\s/g, '')
  if (!/^(\d{1,3}(\.\d{3})+|\d+)(,\d{1,2})?$/.test(limpo)) return null
  const [inteiro = '', fracao = ''] = limpo.split(',')
  const centavos = Number(inteiro.replace(/\./g, '')) * 100 + Number(fracao.padEnd(2, '0'))
  return Number.isSafeInteger(centavos) ? centavos : null
}

/**
 * A oportunidade aberta (não arquivada) da empresa, para o aviso de duplicata (R25): a da primeira etapa no quadro e,
 * na mesma etapa, a de cima. Sem empresa ou sem aberta, `null`.
 */
export function oportunidadeAbertaDaEmpresa(state: FunilState, empresaId: string | null): Oportunidade | null {
  if (!empresaId) return null
  const etapas = new Map(state.etapas.map((etapa) => [etapa.id, etapa]))
  const abertas = state.oportunidades.filter((oportunidade) => oportunidade.empresaId === empresaId && !oportunidade.arquivado && etapas.get(oportunidade.etapaId)?.tipo === 'aberta')
  abertas.sort((a, b) => (etapas.get(a.etapaId)?.ordem ?? 0) - (etapas.get(b.etapaId)?.ordem ?? 0) || a.ordem - b.ordem)
  return abertas[0] ?? null
}

/** Item do `SearchPicker`; `novo`: ainda não existe (o chip ganha o fundo `--hl`). */
export interface PickerItem {
  id: string
  nome: string
  detalhe?: string | undefined
  novo?: boolean | undefined
}

/**
 * Os resultados do `SearchPicker` (R25): os itens cujo nome (ou detalhe) contém o texto, sem acento e sem caixa, menos os
 * já escolhidos, no máximo 8; `criar` quando há texto e nenhum item com exatamente esse nome.
 */
export function resultadosPicker(itens: readonly PickerItem[], texto: string, escolhidos: readonly string[] = []): { itens: PickerItem[]; criar: boolean } {
  const termo = chaveBusca(texto)
  if (!termo) return { itens: [], criar: false }
  const achados = itens.filter((item) => !escolhidos.includes(item.id) && (chaveBusca(item.nome).includes(termo) || (item.detalhe !== undefined && chaveBusca(item.detalhe).includes(termo))))
  return { itens: achados.slice(0, PICKER_MAX), criar: !itens.some((item) => chaveBusca(item.nome) === termo) }
}
