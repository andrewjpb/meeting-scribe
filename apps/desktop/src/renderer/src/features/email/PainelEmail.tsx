import { Check, FolderInput, Info, Mail, RefreshCw, Reply, TriangleAlert } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { itemKey, type EmailDashboardAttentionRow, type EmailDashboardMoveGroup, type EmailDashboardReplyRow, type EmailDashboardView } from '@shared/email-dashboard'
import { emailPath, settingsPath, type EmailNavigationState } from '@shared/routes'
import { ActionButton } from '../../design/ActionButton'
import { Button } from '../../design/Button'
import { Icon } from '../../design/Icon'
import { Note } from '../../design/Note'
import { INICIO_CARTAO_CABECALHO_CLASS, INICIO_CARTAO_CLASS, INICIO_CARTAO_TITULO_CLASS } from '../inicio/inicioFormat'
import { useEmail } from './emailStore'
import { emailTimeLabel } from './format'
import { OrganizeBanner } from './OrganizePanel'
import { PAINEL_RESPOSTAS_VISIVEIS, painelSubtitulo, textoConta, textoEmails, textoMovidos, textoMovidosDetalhe } from './painelFormat'
import { usePainel } from './painelStore'

/** O link em texto do Painel ("Ver resposta", "Mostrar mais N"): 12/500 em --accent, sem contorno. */
const LINK_CLASS = 'no-drag inline-flex shrink-0 items-center rounded-[var(--radius-control)] text-12 font-medium text-accent transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:text-title'

/** Cartão vazio (D9): linha de 32 com o `Check` em --text-faint, no padrão "Nada para hoje" do Início. */
function Vazio({ id, children }: { id: string; children: string }) {
  return (
    <p data-email-painel-vazio={id} className="flex h-8 items-center gap-2 text-13 text-text-muted">
      <Icon icon={Check} size={14} className="shrink-0 text-text-faint" />
      {children}
    </p>
  )
}

/** Cabeçalho de cartão: título e, à direita, a contagem em 12 --text-muted. */
function Cabecalho({ titulo, contagem }: { titulo: string; contagem: string | null }) {
  return (
    <header className={INICIO_CARTAO_CABECALHO_CLASS}>
      <h2 className={`min-w-0 flex-1 truncate ${INICIO_CARTAO_TITULO_CLASS}`}>{titulo}</h2>
      {contagem && <span className="shrink-0 text-12 text-text-muted tabular">{contagem}</span>}
    </header>
  )
}

interface LinhaProps {
  row: EmailDashboardAttentionRow
  conta: string
  /** O quadrado de 6 px (importância 4 ou 5, com a análise ligada). */
  marca: boolean
  motivo: string
  onOpen: (row: EmailDashboardAttentionRow) => void
  /** No lugar da hora (os botões da organização), fora do botão da linha. */
  acoes?: ReactNode
}

/**
 * A linha de mensagem dos três cartões (D4): 44 px, calha de 12 com o quadrado em --accent, remetente e "· conta" com a
 * hora à direita, e o assunto com "· motivo". O clique abre a mensagem na Caixa de Entrada.
 */
function Linha({ row, conta, marca, motivo, onOpen, acoes }: LinhaProps) {
  return (
    <div data-email-painel-linha={row.messageKey} className="flex h-11 min-w-0 items-center gap-2">
      <button type="button" data-action="email-painel-abrir" onClick={() => onOpen(row)} className="no-drag flex h-full min-w-0 flex-1 items-center rounded-[var(--radius-control)] text-left hover:bg-bg-sunken">
        <span aria-hidden="true" className="flex w-3 shrink-0 justify-start">
          {marca && <span data-email-painel-marca className="size-1.5 bg-accent" />}
        </span>
        {marca && <span className="sr-only">Importante</span>}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-13 leading-5">
              <span className="font-medium text-title">{row.from || '(sem remetente)'}</span>
              {conta && <span className="text-12 text-text-muted"> · {conta}</span>}
            </span>
            {!acoes && <span className="shrink-0 text-12 text-text-muted tabular">{emailTimeLabel(row.date)}</span>}
          </span>
          <span className="truncate text-12 leading-4">
            <span className="text-text">{row.subject || '(sem assunto)'}</span>
            {motivo && <span data-email-painel-motivo className="text-text-muted"> · {motivo}</span>}
          </span>
        </span>
      </button>
      {acoes && <span className="flex shrink-0 items-center gap-1.5">{acoes}</span>}
    </div>
  )
}

function Contas({ view }: { view: EmailDashboardView }) {
  return (
    <ul data-email-painel-contas aria-label="Contas" className="flex shrink-0 flex-col border-t border-line-strong">
      {view.accounts.map((conta) => (
        <li key={conta.accountId} data-email-painel-conta={conta.accountId} className="flex h-7 items-center gap-2 border-b border-line text-13">
          <Icon icon={Mail} size={14} className="shrink-0 text-text-muted" />
          <span className="min-w-0 flex-1 truncate font-medium text-title">{conta.name}</span>
          <span className="shrink-0 text-12 text-text-muted tabular">{textoConta(conta)}</span>
        </li>
      ))}
    </ul>
  )
}

function Atencao({ view, nomes, onOpen }: { view: EmailDashboardView; nomes: Map<string, string>; onOpen: LinhaProps['onOpen'] }) {
  const n = view.attention.length
  return (
    <section data-email-painel-cartao="atencao" aria-label="Precisam de atenção" className={`${INICIO_CARTAO_CLASS} min-h-0`}>
      <Cabecalho titulo="Precisam de atenção" contagem={n === 0 ? null : view.enabled ? textoEmails(n) : `${n} não ${n === 1 ? 'lido pendente' : 'lidos pendentes'}`} />
      {n === 0 ? (
        <Vazio id="atencao">Nada precisa de atenção</Vazio>
      ) : (
        <ul className="-mr-1 flex min-h-0 flex-col overflow-y-auto pr-1">
          {view.attention.map((row) => (
            <li key={itemKey(row.accountId, row.messageKey)} className="border-b border-line last:border-b-0">
              <Linha row={row} conta={nomes.get(row.accountId) ?? ''} marca={view.enabled && row.importance >= 4} motivo={view.enabled ? row.reason : ''} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function BlocoResposta({ row, conta, onOpen }: { row: EmailDashboardReplyRow; conta: string; onOpen: LinhaProps['onOpen'] }) {
  const navigate = useNavigate()
  const key = itemKey(row.accountId, row.messageKey)
  const aberto = usePainel((state) => state.expanded.has(key))
  const abrirNoComposer = (): void => usePainel.getState().openReply(row, navigate)
  return (
    <li data-email-painel-resposta={row.messageKey} data-email-painel-resposta-aberta={row.opened ? 'true' : undefined} className="flex flex-col border-b border-line pb-1 last:border-b-0">
      <Linha row={row} conta={conta} marca={row.importance >= 4} motivo={row.reason} onOpen={onOpen} />
      <button
        type="button"
        data-action="email-painel-resposta-texto"
        title="Abrir no Composer"
        onClick={abrirNoComposer}
        className={`no-drag ml-3 border-l-2 border-line-strong pl-2.5 text-left text-13 whitespace-pre-wrap text-text hover:text-title ${aberto ? '' : 'line-clamp-2'}`}
      >
        {row.reply}
      </button>
      <div className="flex h-7 items-center gap-1.5 pl-3">
        <button type="button" data-action="email-painel-ver-resposta" aria-expanded={aberto} onClick={() => usePainel.getState().toggleExpanded(key)} className={`${LINK_CLASS} mr-auto`}>
          {aberto ? 'Ver menos' : 'Ver resposta'}
        </button>
        {row.opened ? (
          <button type="button" data-action="email-painel-aberta" title="Abrir no Composer de novo" onClick={abrirNoComposer} className="no-drag inline-flex h-7 shrink-0 items-center gap-1 rounded-[var(--radius-control)] px-1.5 text-12 text-text-muted hover:text-title">
            <Icon icon={Check} size={14} />
            Aberta
          </button>
        ) : (
          <ActionButton action="email-painel-composer" icon={Reply} label="Abrir no Composer" onClick={abrirNoComposer} />
        )}
        <ActionButton action="email-painel-ignorar-resposta" label="Ignorar" onClick={() => void usePainel.getState().ignore(row.accountId, row.messageKey, 'reply')} />
      </div>
    </li>
  )
}

function Respostas({ view, nomes, onOpen }: { view: EmailDashboardView; nomes: Map<string, string>; onOpen: LinhaProps['onOpen'] }) {
  const todas = usePainel((state) => state.showAllReplies)
  const n = view.replies.length
  const visiveis = todas ? view.replies : view.replies.slice(0, PAINEL_RESPOSTAS_VISIVEIS)
  const resto = n - visiveis.length
  return (
    <section data-email-painel-cartao="respostas" aria-label="Respostas sugeridas" className={INICIO_CARTAO_CLASS}>
      <Cabecalho titulo="Respostas sugeridas" contagem={n === 0 ? null : textoEmails(n)} />
      {n === 0 ? (
        <Vazio id="respostas">Nenhuma resposta sugerida</Vazio>
      ) : (
        <>
          <ul className="flex flex-col">
            {visiveis.map((row) => (
              <BlocoResposta key={itemKey(row.accountId, row.messageKey)} row={row} conta={nomes.get(row.accountId) ?? ''} onOpen={onOpen} />
            ))}
          </ul>
          {resto > 0 && (
            <div className="flex h-8 items-center border-t border-line">
              <button type="button" data-action="email-painel-mostrar-mais" onClick={() => usePainel.getState().setShowAllReplies(true)} className={`${LINK_CLASS} text-13`}>
                Mostrar mais {resto}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Grupo({ group, conta, onOpen }: { group: EmailDashboardMoveGroup; conta: string; onOpen: LinhaProps['onOpen'] }) {
  const mover = (keys: string[]): void => void usePainel.getState().applyMove(group.accountId, group.folder, keys)
  return (
    <li data-email-painel-grupo={group.folder} data-email-painel-grupo-conta={group.accountId} className="flex flex-col">
      <div className="flex h-8 items-center gap-2 border-b border-line-strong">
        <p className="min-w-0 flex-1 truncate text-13">
          <span className="font-semibold text-title">{group.folderName === 'Arquivar' ? 'Arquivar' : `Mover para ${group.folderName}`}</span>
          {conta && <span className="text-12 text-text-muted"> · {conta}</span>}
        </p>
        <ActionButton action="email-painel-mover-todos" icon={FolderInput} label={`Mover todos (${group.rows.length})`} onClick={() => mover(group.rows.map((row) => row.messageKey))} />
      </div>
      <ul className="flex flex-col">
        {group.rows.map((row) => (
          <li key={row.messageKey} className="border-b border-line last:border-b-0">
            <Linha
              row={row}
              conta={conta}
              marca={row.importance >= 4}
              motivo={row.moveReason}
              onOpen={onOpen}
              acoes={
                <>
                  <ActionButton action="email-painel-mover" label="Mover" onClick={() => mover([row.messageKey])} />
                  <ActionButton action="email-painel-ignorar-mover" label="Ignorar" onClick={() => void usePainel.getState().ignore(row.accountId, row.messageKey, 'move')} />
                </>
              }
            />
          </li>
        ))}
      </ul>
    </li>
  )
}

function Organizacao({ view, nomes, onOpen }: { view: EmailDashboardView; nomes: Map<string, string>; onOpen: LinhaProps['onOpen'] }) {
  const n = view.moves.reduce((soma, group) => soma + group.rows.length, 0)
  return (
    <section data-email-painel-cartao="organizacao" aria-label="Sugestões de organização" className={INICIO_CARTAO_CLASS}>
      <Cabecalho titulo="Sugestões de organização" contagem={n === 0 ? null : textoEmails(n)} />
      {n === 0 ? (
        <Vazio id="organizacao">Caixa de Entrada em ordem</Vazio>
      ) : (
        <ul className="flex flex-col gap-2">
          {view.moves.map((group) => (
            <Grupo key={itemKey(group.accountId, group.folder)} group={group} conta={nomes.get(group.accountId) ?? ''} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </section>
  )
}

/** O banner do Desfazer (D11): a faixa do `OrganizeBanner` com o texto do Painel, entre o cabeçalho e as colunas. */
function BannerPainel({ nomes }: { nomes: Map<string, string> }) {
  const batch = usePainel((state) => state.lastBatch)
  const dismissed = useEmail((state) => (batch ? state.bannerDismissed.includes(batch.batchId) : false))
  const result = useEmail((state) => (batch ? (state.bannerResults[batch.batchId] ?? null) : null))
  if (!batch || dismissed) return null
  const banner = { batchId: batch.batchId, path: 'INBOX', title: textoMovidos(batch.moved, batch.folderName), detail: textoMovidosDetalhe(batch.at, nomes.get(batch.accountId) ?? ''), retry: false, result }
  return <OrganizeBanner key={batch.batchId} banner={banner} where="a Caixa de Entrada" className="mt-3" onUndo={() => usePainel.getState().undoLast()} onClose={() => usePainel.getState().clearBatch()} />
}

/**
 * Painel de e-mail (contrato 157, R10 a R22, mockup D1 a D11): o topo do Email. Cabeçalho com "Analisar agora"; o
 * banner do Desfazer do último lote movido; em duas colunas a partir de 900 px de janela, as contas e Precisam de
 * atenção (380 px) e, à direita, Respostas sugeridas e Sugestões de organização (ou a nota da análise desligada).
 * O Painel só sugere: abrir no Composer preenche o rascunho, mover espera o clique, e nada sai sem a pessoa.
 */
export function PainelEmail() {
  const navigate = useNavigate()
  const view = usePainel((state) => state.view)
  const error = usePainel((state) => state.error)

  useEffect(() => {
    const painel = usePainel.getState()
    void painel.load()
    return painel.subscribe()
  }, [])

  const nomes = new Map((view?.accounts ?? []).map((conta) => [conta.accountId, conta.name]))
  const enabled = view?.enabled ?? false
  const running = view?.running ?? false
  // R14: o mesmo estado do cartão `emails` do chat; a Caixa de Entrada abre com a mensagem.
  const abrir = (row: EmailDashboardAttentionRow): void => {
    const state: EmailNavigationState = { messageId: row.messageKey }
    void navigate(emailPath(row.accountId, 'inbox'), { state })
  }

  return (
    <div data-email-painel data-email-painel-ia={view ? (enabled ? 'ligada' : 'desligada') : undefined} className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-[var(--page-x)] pt-[var(--page-top)]">
        <header className="flex items-end justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="truncate text-20 font-bold tracking-[-0.3px] text-title">Painel</h1>
            <p data-email-painel-subtitulo className="truncate text-13 text-text-muted">
              {view ? painelSubtitulo(view) : ' '}
            </p>
          </div>
          <Button action="email-painel-analisar" variant="secondary" icon={RefreshCw} disabled={!view || !enabled || running} onClick={() => void usePainel.getState().run()}>
            {running ? 'Analisando…' : 'Analisar agora'}
          </Button>
        </header>
        {error && (
          <Note id="email-painel-error" icon={TriangleAlert} role="alert" className="mt-3">
            {error}
          </Note>
        )}
        <BannerPainel nomes={nomes} />
      </div>
      {view && (
        <div className="flex min-h-0 flex-1 gap-6 px-[var(--page-x)] pt-4 pb-5 max-[899px]:flex-col max-[899px]:overflow-y-auto">
          <div className="flex min-h-0 w-[380px] shrink-0 flex-col gap-4 max-[899px]:w-full">
            <Contas view={view} />
            <Atencao view={view} nomes={nomes} onOpen={abrir} />
          </div>
          <div data-email-painel-direita className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto max-[899px]:flex-none max-[899px]:overflow-visible">
            {enabled ? (
              <>
                <Respostas view={view} nomes={nomes} onOpen={abrir} />
                <Organizacao view={view} nomes={nomes} onOpen={abrir} />
              </>
            ) : (
              <Note
                id="email-painel-ia-desligada"
                icon={Info}
                role="status"
              >
                Análise por IA desligada. Ligue em{' '}
                <Link to={settingsPath('email')} draggable={false} data-action="email-painel-configuracoes" className="no-drag text-accent underline decoration-1 underline-offset-3 hover:text-title">
                  Configurações › Email
                </Link>{' '}
                para ver respostas e sugestões de organização.
              </Note>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
