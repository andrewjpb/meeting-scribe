// Textos do Painel de e-mail (contrato 157, D2, D3, D11, D13), em pt-BR e no fuso local. Sem DOM: testado em
// test/renderer/painel-email.test.tsx. Nenhum texto de e-mail passa por aqui além do que a tela mostra.
import type { EmailDashboardAccountSummary, EmailDashboardLastRun, EmailDashboardModel, EmailDashboardView } from '@shared/email-dashboard'
import { horaMinuto } from '../inicio/inicioFormat'

const plural = (n: number, singular: string, varios: string): string => `${n} ${n === 1 ? singular : varios}`

export const PAINEL_MODELO_ROTULO: Readonly<Record<EmailDashboardModel, string>> = { haiku: 'Haiku', sonnet: 'Sonnet' }

/** "38 e-mails", "1 e-mail". */
export const textoEmails = (n: number): string => plural(n, 'e-mail', 'e-mails')

/**
 * O subtítulo do cabeçalho (D2): "Analisado às 09:12 · 38 e-mails · Haiku" ou "Ainda não analisado"; com a análise
 * desligada (D10), mais " · análise por IA desligada".
 */
export function painelSubtitulo(view: Pick<EmailDashboardView, 'enabled' | 'lastRun'> | null): string {
  const run = view?.lastRun ?? null
  const base = run ? `Analisado às ${horaMinuto(run.at)} · ${textoEmails(run.analyzed)} · ${PAINEL_MODELO_ROTULO[run.model]}` : 'Ainda não analisado'
  return view && !view.enabled ? `${base} · análise por IA desligada` : base
}

/** "US$ 0,02". */
export function textoCusto(usd: number): string {
  return `US$ ${usd.toFixed(2).replace('.', ',')}`
}

/** A "Última análise" das Configurações (D13): "Às 09:12 · 38 e-mails · US$ 0,02" (sem o custo quando não veio) ou "Nunca". */
export function textoUltimaAnalise(run: EmailDashboardLastRun | null): string {
  if (!run) return 'Nunca'
  return [`Às ${horaMinuto(run.at)}`, textoEmails(run.analyzed), ...(run.costUsd !== null ? [textoCusto(run.costUsd)] : [])].join(' · ')
}

/** A linha de uma conta (D3): "5 não lidos · 3 pendentes", e " · POP3" na conta POP3. */
export function textoConta(conta: Pick<EmailDashboardAccountSummary, 'unread' | 'pending' | 'pop3'>): string {
  return `${plural(conta.unread, 'não lido', 'não lidos')} · ${plural(conta.pending, 'pendente', 'pendentes')}${conta.pop3 ? ' · POP3' : ''}`
}

/** O título do banner do Desfazer (D11): "4 e-mails movidos para Newsletters"; o grupo "Arquivar" vira "o Arquivo". */
export function textoMovidos(moved: number, folderName: string): string {
  const destino = folderName === 'Arquivar' ? 'o Arquivo' : folderName
  return `${moved === 1 ? '1 e-mail movido' : `${moved} e-mails movidos`} para ${destino}`
}

/** O apoio do banner: "Pelo Painel, às 09:20 · LAP". */
export function textoMovidosDetalhe(at: number, conta: string): string {
  return conta ? `Pelo Painel, às ${horaMinuto(at)} · ${conta}` : `Pelo Painel, às ${horaMinuto(at)}`
}

/**
 * Quantas respostas o cartão mostra (D6): as 3 primeiras e "Mostrar mais N", que abre o resto em linha.
 */
export const PAINEL_RESPOSTAS_VISIVEIS = 3

/** Os textos fixos das falhas (nenhum conteúdo de e-mail). */
export const PAINEL_ERRO_CARREGAR = 'Não foi possível carregar o Painel'
export const PAINEL_ERRO_MOVER = 'Não foi possível mover'
