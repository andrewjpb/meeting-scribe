// Formatação e filtros da tela Oportunidades (contrato 112, R21 a R25), do detalhe da oportunidade (contrato 119, R27
// a R29) e das telas de Contatos e Empresas (contrato 114, R5, R16, R30 a R34). Sem DOM: testado em
// test/renderer/funil-format.test.ts. Os cálculos do funil (totais, esfriada, BRL) vêm de `shared/funil-logic.ts`.
import { EMAIL_INBOX_MAILBOX } from '@shared/email'
import type { Contato, ContatoOrigem, Empresa, Etapa, EtapaTipo, FunilState, ItemLinhaDoTempo, Oportunidade, ProximoPasso, Sugestao } from '@shared/funil'
import { diasNaEtapa, dominioDe, ehProvedorPessoal, formatarBRL, nomeEmpresaDoDominio, normalizarEmail, semAcento, totaisDoFunil } from '@shared/funil-logic'
import { emailPath, ROUTE_PATHS, type EmailNavigationState, type EmailRouteFolder, type WhatsAppNavigationState } from '@shared/routes'
import type { Tarefa } from '@shared/tarefas'

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

/** O próximo passo do cartão (R23; contrato 124: o derivado das tarefas): o texto e a data curta; sem tarefa aberta, "Sem tarefa" (contrato 125, R14). */
export function textoProximoPasso(proximoPasso: Pick<ProximoPasso, 'texto' | 'data'> | null): { texto: string; data: string | null } {
  if (!proximoPasso) return { texto: 'Sem tarefa', data: null }
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

// ---------------------------------------------------------------------------------------------------------------
// Contrato 119: o detalhe da oportunidade.

/** "Escrever e-mail" (R28, D12): o e-mail principal de cada contato, sem repetir; contato sem e-mail fica de fora. */
export function composeDe(contatos: readonly Pick<Contato, 'emails'>[]): string[] {
  const vistos = new Set<string>()
  for (const contato of contatos) {
    const principal = contato.emails.map((email) => normalizarEmail(email)).find((email) => email !== null)
    if (principal) vistos.add(principal)
  }
  return [...vistos]
}

/** Só oportunidade ganha ou perdida pode ser arquivada (R27). */
export function podeArquivar(etapa: Pick<Etapa, 'tipo'> | null | undefined): boolean {
  return etapa?.tipo === 'ganho' || etapa?.tipo === 'perdido'
}

const fusoLocal = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** Dia, mês, ano, hora e minuto de um instante no fuso pedido, com dois dígitos (o ano com quatro). */
function partes(at: number, timeZone: string): { dia: string; mes: string; ano: string; hora: string; minuto: string } {
  const lista = new Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const valor = (tipo: Intl.DateTimeFormatPartTypes): string => lista.find((parte) => parte.type === tipo)?.value ?? ''
  return { dia: valor('day'), mes: valor('month'), ano: valor('year'), hora: valor('hour'), minuto: valor('minute') }
}

/** `03/11/2026`. */
export function dataLonga(at: number, timeZone: string = fusoLocal()): string {
  const { dia, mes, ano } = partes(at, timeZone)
  return `${dia}/${mes}/${ano}`
}

/** `14/11 · 10:40`, a data de cada item da linha do tempo (R29). */
export function dataHora(at: number, timeZone: string = fusoLocal()): string {
  const { dia, mes, hora, minuto } = partes(at, timeZone)
  return `${dia}/${mes} · ${hora}:${minuto}`
}

/** `15/12/2026` de `2026-12-15`. */
export function diaLongo(dia: string): string {
  const [ano, mes, d] = dia.split('-')
  return `${d}/${mes}/${ano}`
}

/** "hoje, 15:12", "ontem, 15:12" ou, antes disso, "18/11/2026". */
export function quando(at: number, now: number, timeZone: string = fusoLocal()): string {
  const alvo = partes(at, timeZone)
  const chave = (item: { dia: string; mes: string; ano: string }): string => `${item.ano}-${item.mes}-${item.dia}`
  const hora = `${alvo.hora}:${alvo.minuto}`
  if (chave(alvo) === chave(partes(now, timeZone))) return `hoje, ${hora}`
  if (chave(alvo) === chave(partes(now - DIA_MS, timeZone))) return `ontem, ${hora}`
  return `${alvo.dia}/${alvo.mes}/${alvo.ano}`
}

/**
 * Subtítulo do detalhe (artboard 04): "Há 6 d em Proposta · criada em 03/11/2026 · última interação ontem, 15:12". Sem
 * a última interação, a última parte fica de fora.
 */
export function textoSubtitulo(oportunidade: Pick<Oportunidade, 'movidoEm' | 'criadoEm'>, etapa: Pick<Etapa, 'nome'> | null | undefined, ultima: number | null, now: number, timeZone: string = fusoLocal()): string {
  const partesTexto = [`Há ${diasNaEtapa(oportunidade.movidoEm, now)} d em ${etapa?.nome ?? 'etapa desconhecida'}`, `criada em ${dataLonga(oportunidade.criadoEm, timeZone)}`]
  if (ultima !== null) partesTexto.push(`última interação ${quando(ultima, now, timeZone)}`)
  return partesTexto.join(' · ')
}

/** Destino de uma navegação: o caminho e o `state` que vai junto. */
export interface Destino<S> {
  path: string
  state: S
}

/** "Abrir WhatsApp" (R28, D14): a primeira conversa ligada; sem conversa, nenhum destino (o botão nem aparece). */
export function whatsappDestino(chatIds: readonly string[]): Destino<WhatsAppNavigationState> | null {
  const chatId = chatIds[0]
  return chatId ? { path: ROUTE_PATHS.whatsapp, state: { chatId } } : null
}

/**
 * "Abrir e-mail" de um item da linha do tempo (R29): a pasta da conta onde a mensagem está (a Caixa de Entrada, os
 * Enviados da conta ou outra pasta) com a mensagem pedida. Fora do cache (`noCache`), nenhum destino.
 */
export function emailDestino(item: Extract<ItemLinhaDoTempo, { tipo: 'email' }>, sentMailbox: string | null): Destino<EmailNavigationState> | null {
  if (item.noCache) return null
  const mailbox = item.mailbox ?? EMAIL_INBOX_MAILBOX
  const pasta: EmailRouteFolder = mailbox.toUpperCase() === EMAIL_INBOX_MAILBOX ? 'inbox' : mailbox === sentMailbox ? 'sent' : { path: mailbox }
  return { path: emailPath(item.accountId, pasta), state: { messageId: item.messageId, mailbox } }
}

/** O valor no campo de edição (R25): `64.000` ou `1.250,50`, sem o "R$"; sem valor, vazio. */
export function valorParaEdicao(centavos: number | null): string {
  return centavos === null ? '' : formatarBRL(centavos).replace(/^R\$\s*/, '')
}

// ---------------------------------------------------------------------------------------------------------------
// Contrato 114: Contatos e Empresas.

/** O `label` da origem na linha do contato (R30). */
export const ORIGEM_ROTULO: Record<ContatoOrigem, string> = {
  reuniao: 'Reunião',
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  importacao: 'Importação',
  manual: 'Manual',
  agenda: 'Agenda',
  assistente: 'Assistente',
}

/** "desde 03/11/2026, pela reunião": a origem depois do "desde" do subtítulo da ficha (artboard 05). */
const ORIGEM_FRASE: Record<ContatoOrigem, string> = {
  reuniao: 'pela reunião',
  email: 'pelo e-mail',
  whatsapp: 'pelo WhatsApp',
  importacao: 'pela importação',
  manual: 'pelo cadastro manual',
  agenda: 'pela agenda',
  assistente: 'pelo Assistente',
}

/** Os contatos da lista (R30): sem os arquivados, os atualizados há menos tempo primeiro; no empate, pelo nome. */
export function ordenarContatos(contatos: readonly Contato[]): Contato[] {
  return contatos.filter((contato) => !contato.arquivado).sort((a, b) => b.atualizadoEm - a.atualizadoEm || a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** Só os dígitos. */
const digitos = (texto: string): string => texto.replace(/\D/g, '')

/**
 * A busca da lista de contatos (R30): nome, e-mail, telefone e nome da empresa, sem acento e sem caixa. Texto só de
 * número (com ou sem pontuação: `(11) 98765-4321`, `11987654321`) acha também pelos dígitos do telefone guardado.
 */
export function filtrarContatos(contatos: readonly Contato[], empresas: readonly Pick<Empresa, 'id' | 'nome'>[], busca: string): Contato[] {
  const termo = chaveBusca(busca)
  if (!termo) return [...contatos]
  const numero = /^[\d\s().+-]+$/.test(termo) ? digitos(termo) : ''
  const nomes = new Map(empresas.map((empresa) => [empresa.id, chaveBusca(empresa.nome)]))
  return contatos.filter((contato) => {
    const textos = [chaveBusca(contato.nome), ...contato.emails.map(chaveBusca), ...contato.telefones.map(chaveBusca), contato.empresaId ? (nomes.get(contato.empresaId) ?? '') : '']
    if (textos.some((texto) => texto.includes(termo))) return true
    return numero.length > 0 && contato.telefones.some((telefone) => digitos(telefone).includes(numero))
  })
}

/** `+5511987654321` -> `+55 11 98765-4321`; outro formato fica como está. */
export function telefoneLegivel(telefone: string): string {
  const br = /^\+55(\d{2})(\d{4,5})(\d{4})$/.exec(telefone)
  return br ? `+55 ${br[1]} ${br[2]}-${br[3]}` : telefone
}

const CANAL_ROTULO: Record<Sugestao['canais'][number], string> = { reuniao: 'Reunião', email: 'E-mail', whatsapp: 'WhatsApp' }

/** O canal principal da sugestão (o da `origem`, R12), entre os três que geram sugestão. */
export function canalDaSugestao(sugestao: Pick<Sugestao, 'origem' | 'canais'>): Sugestao['canais'][number] {
  const origem = sugestao.origem
  return origem === 'reuniao' || origem === 'email' || origem === 'whatsapp' ? origem : (sugestao.canais[0] ?? 'email')
}

/**
 * As duas linhas de texto de uma sugestão (R33, artboard 06): "e-mail ou telefone · <canal>" e "N interações · última em
 * <hoje|dd/mm>".
 */
export function textoSugestao(sugestao: Sugestao, now: number, timeZone: string = fusoLocal()): { contato: string; interacoes: string } {
  const endereco = sugestao.email ?? (sugestao.telefone ? telefoneLegivel(sugestao.telefone) : '')
  const canal = CANAL_ROTULO[canalDaSugestao(sugestao)]
  const alvo = partes(sugestao.ultimaEm, timeZone)
  const hoje = partes(now, timeZone)
  const dia = alvo.dia === hoje.dia && alvo.mes === hoje.mes && alvo.ano === hoje.ano ? 'hoje' : `${alvo.dia}/${alvo.mes}`
  return {
    contato: endereco ? `${endereco} · ${canal}` : canal,
    interacoes: `${sugestao.interacoes} ${sugestao.interacoes === 1 ? 'interação' : 'interações'} · última em ${dia}`,
  }
}

/**
 * A empresa sugerida para o contato (R5): sem empresa, o primeiro e-mail de domínio que não é de provedor pessoal e que
 * nenhuma empresa tem em `dominios`, com o nome do domínio sem o TLD. Com empresa, ou sem domínio novo, `null`.
 */
export function sugestaoDeEmpresa(contato: Pick<Contato, 'empresaId' | 'emails'>, empresas: readonly Pick<Empresa, 'dominios'>[]): { nome: string; dominio: string } | null {
  if (contato.empresaId !== null) return null
  for (const email of contato.emails) {
    const dominio = dominioDe(email)
    if (!dominio || ehProvedorPessoal(dominio)) continue
    if (empresas.some((empresa) => empresa.dominios.includes(dominio))) return null
    const nome = nomeEmpresaDoDominio(dominio)
    if (nome) return { nome, dominio }
  }
  return null
}

/** O resultado da importação (R16): "16 criados · 2 atualizados · 2 ignorados (sem e-mail nem telefone)". */
export function textoResultadoImport(resultado: { criados: number; atualizados: number; ignorados: number }): string {
  return `${resultado.criados} criados · ${resultado.atualizados} atualizados · ${resultado.ignorados} ignorados (sem e-mail nem telefone)`
}

/** A linha do arquivo na importação (artboard 07): "20 linhas · separador ; · UTF-8" ou "vCard · 3 cartões". */
export function textoArquivoImport(arquivo: { tipo: 'csv' | 'vcard'; total: number; separador: ',' | ';' | '\t' | null; codificacao: 'utf-8' | 'latin1' }): string {
  if (arquivo.tipo === 'vcard') return `vCard · ${arquivo.total} ${arquivo.total === 1 ? 'cartão' : 'cartões'}`
  const separador = arquivo.separador === '\t' ? 'tabulação' : (arquivo.separador ?? ',')
  return `${arquivo.total} ${arquivo.total === 1 ? 'linha' : 'linhas'} · separador ${separador} · ${arquivo.codificacao === 'utf-8' ? 'UTF-8' : 'Latin-1'}`
}

/**
 * Subtítulo da ficha do contato (artboard 05): "Diretora de Expansão · ABF · desde 03/11/2026, pela reunião". Sem cargo
 * ou sem empresa, a parte fica de fora.
 */
export function textoSubtituloContato(contato: Pick<Contato, 'cargo' | 'criadoEm' | 'origem'>, empresa: string | null, timeZone: string = fusoLocal()): string {
  return [contato.cargo, empresa, `desde ${dataLonga(contato.criadoEm, timeZone)}, ${ORIGEM_FRASE[contato.origem]}`].filter((parte) => parte).join(' · ')
}

/** As empresas da lista (R34), pelo nome. */
export function ordenarEmpresas<T extends Pick<Empresa, 'nome'>>(empresas: readonly T[]): T[] {
  return [...empresas].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

/** A busca da lista de empresas: nome e domínios, sem acento e sem caixa. */
export function filtrarEmpresas<T extends Pick<Empresa, 'nome' | 'dominios'>>(empresas: readonly T[], busca: string): T[] {
  const termo = chaveBusca(busca)
  if (!termo) return [...empresas]
  return empresas.filter((empresa) => chaveBusca(empresa.nome).includes(termo) || empresa.dominios.some((dominio) => dominio.includes(termo)))
}

/** Domínio digitado (`@Acme.com.br`, `acme.com.br`) em minúsculas e sem `@`; fora do formato, `null`. */
export function parseDominio(texto: string): string | null {
  const dominio = texto.trim().toLowerCase().replace(/^@/, '')
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(dominio) ? dominio : null
}

// ---------------------------------------------------------------------------------------------------------------
// Contrato 125: as tarefas no funil (a seção Tarefas da oportunidade, as fichas e o item `tarefa` da linha do tempo).

/** Por prazo (sem prazo por último), depois pela criação e pelo id: a ordem de `abertasDaOportunidade`. */
function porPrazo(a: Tarefa, b: Tarefa): number {
  if (a.prazo !== b.prazo) {
    if (a.prazo === null) return 1
    if (b.prazo === null) return -1
    return a.prazo < b.prazo ? -1 : 1
  }
  return a.criadaEm - b.criadaEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * As tarefas ligadas à oportunidade (R15): as abertas por prazo (sem prazo por último; a primeira é o próximo passo do
 * quadro) e as fechadas (feitas e canceladas), a fechada por último primeiro.
 */
export function tarefasDaOportunidade(tarefas: readonly Tarefa[], opId: string): { abertas: Tarefa[]; fechadas: Tarefa[] } {
  const ligadas = tarefas.filter((tarefa) => tarefa.vinculos.oportunidadeId === opId)
  return {
    abertas: ligadas.filter((tarefa) => tarefa.status === 'aberta').sort(porPrazo),
    fechadas: ligadas.filter((tarefa) => tarefa.status !== 'aberta').sort((a, b) => (b.feitaEm ?? 0) - (a.feitaEm ?? 0) || porPrazo(a, b)),
  }
}

/** As abertas com o contato nos vínculos (R19), por prazo. */
export function tarefasDoContato(tarefas: readonly Tarefa[], contatoId: string): Tarefa[] {
  return tarefas.filter((tarefa) => tarefa.status === 'aberta' && tarefa.vinculos.contatoIds.includes(contatoId)).sort(porPrazo)
}

/** As abertas ligadas à empresa (R19), por prazo. */
export function tarefasDaEmpresa(tarefas: readonly Tarefa[], empresaId: string): Tarefa[] {
  return tarefas.filter((tarefa) => tarefa.status === 'aberta' && tarefa.vinculos.empresaId === empresaId).sort(porPrazo)
}

/**
 * O item `tarefa` da linha do tempo (R18, artboard 08): o rótulo ("Tarefa criada" ou "Tarefa concluída") e a linha com
 * a origem resumida e o prazo ("Criada por você · até 25/11"); sem as duas, `null`.
 */
export function textoItemTarefa(item: Pick<Extract<ItemLinhaDoTempo, { tipo: 'tarefa' }>, 'acao' | 'origem' | 'prazo'>): { rotulo: string; linha: string | null } {
  const origem = item.origem.trim()
  const partesLinha = [origem ? `${origem.charAt(0).toUpperCase()}${origem.slice(1)}` : '', item.prazo ? `até ${diaCurto(item.prazo)}` : ''].filter((parte) => parte)
  return { rotulo: item.acao === 'feita' ? 'Tarefa concluída' : 'Tarefa criada', linha: partesLinha.length ? partesLinha.join(' · ') : null }
}
