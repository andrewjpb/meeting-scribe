import { ChartNoAxesColumn, Info, MessageCircle, Plus, Send, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { INSTAGRAM_ANCHOR, isRedesSection, redesPath, settingsPath, type RedesSection, type SettingsNavigationState } from '@shared/routes'
import { Button } from '../../design/Button'
import { EmptyState } from '../../design/EmptyState'
import { Icon } from '../../design/Icon'
import { Note, NOTE_ACTION_CLASS } from '../../design/Note'
import { PageHeader } from '../../design/PageHeader'
import { INSTAGRAM_TOKEN_INPUT } from '../settings/InstagramSection'
import { InstagramGlyph } from './InstagramGlyph'
import { PublicationEditor } from './PublicationEditor'
import { PublicationsList } from './PublicationsList'
import { quotaLine, REDES_SECTION_LABELS } from './redesFormat'
import { useRedes } from './redesStore'

/** As seções que os contratos 73 a 75 preenchem: por enquanto, o estado vazio com o que vai aparecer ali. */
const COMING: Readonly<Record<Exclude<RedesSection, 'publicacoes'>, { icon: LucideIcon; text: string }>> = {
  comentarios: { icon: MessageCircle, text: 'Os comentários das suas publicações vão aparecer aqui, agrupados por publicação, para responder sem sair do app.' },
  mensagens: { icon: Send, text: 'As mensagens diretas do Instagram vão aparecer aqui, com a resposta no mesmo lugar.' },
  metricas: { icon: ChartNoAxesColumn, text: 'O alcance, as visualizações e as interações da conta e de cada publicação vão aparecer aqui.' },
}

const PAGE_TOP = 'px-[var(--page-x)] pt-[var(--page-top)] pb-4'

/** "Conectar conta": Configurações › Contas, rolada até a seção Instagram, com o foco no campo do token. */
function useConnectAccount(): () => void {
  const navigate = useNavigate()
  return () => {
    const state: SettingsNavigationState = { focus: INSTAGRAM_TOKEN_INPUT }
    void navigate(settingsPath('contas', INSTAGRAM_ANCHOR), { state })
  }
}

/**
 * Tela Redes (contrato 72, R4 e R8): `/redes/<conta>/<secao>`. Sem conta conectada, o estado vazio com "Conectar conta"
 * (artboard 08); sem conta na rota (ou uma que saiu), a primeira conta; seção fora da lista, Publicações. O título é
 * "@conta · Seção"; em Publicações, a cota da Meta na linha de apoio, "Nova publicação" à direita, a fila e o editor em
 * painel à direita dela (artboards 03, 04 e 04b).
 */
export function RedesScreen() {
  const { conta, secao } = useParams()
  const state = useRedes((store) => store.state)
  const loadFailed = useRedes((store) => store.loadFailed)
  const accounts = state?.accounts ?? []
  const account = accounts.find((item) => item.id === conta) ?? null

  if (!state) {
    return loadFailed ? (
      <div className={PAGE_TOP}>
        <Note id="redes-load-failed" icon={TriangleAlert} role="alert">
          Não foi possível ler as contas das redes.
        </Note>
      </div>
    ) : null
  }
  if (!accounts.length) return <NoAccount />
  if (!account) return <Navigate replace to={redesPath(accounts[0]?.id ?? '')} />
  if (!isRedesSection(secao)) return <Navigate replace to={redesPath(account.id)} />
  return <AccountSection key={account.id} accountId={account.id} username={account.username} section={secao} />
}

function NoAccount() {
  const connect = useConnectAccount()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PAGE_TOP}>
        <PageHeader title="Redes" titleAttrs={{ 'data-redes-title': '' }} />
      </div>
      <div data-redes-empty className="flex flex-1 flex-col items-center px-[var(--page-x)]">
        <div className="grow-[3]" />
        <EmptyState
          illustration={<NoAccountIllustration />}
          title="Nenhuma conta conectada"
          action={
            <Button icon={Plus} action="redes-empty-connect" data={{ 'data-redes-empty-connect': '' }} onClick={connect}>
              Conectar conta
            </Button>
          }
        >
          Conecte um Instagram profissional em Configurações › Contas.
        </EmptyState>
        <div className="grow-[7]" />
      </div>
    </div>
  )
}

/** O glifo do Instagram ligado por um traço a um quadrado tracejado com "+": a conta que falta (artboard 08). */
function NoAccountIllustration() {
  return (
    <div aria-hidden="true" className="flex items-center">
      <span className="h-px w-10 bg-line-strong" />
      <span className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised text-text-muted">
        <InstagramGlyph size={24} />
      </span>
      <span className="h-0.5 w-8 bg-accent" />
      <span className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-dashed border-line-strong text-accent">
        <Icon icon={Plus} />
      </span>
      <span className="h-px w-10 bg-line-strong" />
    </div>
  )
}

function AccountSection({ accountId, username, section }: { accountId: string; username: string; section: RedesSection }) {
  const publications = useRedes((store) => store.publications[accountId])
  const quota = useRedes((store) => store.quota[accountId])
  const editor = useRedes((store) => (store.editor?.accountId === accountId ? store.editor : null))
  const openEditor = useRedes((store) => store.openEditor)
  const notice = useRedes((store) => (store.notice?.accountId === accountId ? store.notice.text : null))
  const title = `@${username} · ${REDES_SECTION_LABELS[section]}`
  // O editor que saiu com mudança (outra seção, outra rota): o aviso de que virou rascunho, em qualquer seção da conta.
  const noticeBar = notice && (
    <div data-redes-notice className="px-[var(--page-x)] pb-3">
      <Note
        id="redes-editor-left"
        icon={Info}
        role="status"
        action={
          <button type="button" className={`${NOTE_ACTION_CLASS} text-13`} onClick={() => useRedes.getState().setNotice(null)}>
            Fechar
          </button>
        }
      >
        {notice}
      </Note>
    </div>
  )

  useEffect(() => {
    if (section !== 'publicacoes') return
    void useRedes.getState().loadPublications(accountId)
    void useRedes.getState().loadQuota(accountId)
  }, [accountId, section])

  if (section !== 'publicacoes') {
    const coming = COMING[section]
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className={PAGE_TOP}>
          <PageHeader title={title} titleAttrs={{ 'data-redes-title': '' }} />
        </div>
        {noticeBar}
        <div data-redes-coming={section} className="flex flex-1 flex-col items-center border-t border-line px-[var(--page-x)]">
          <div className="grow-[3]" />
          <EmptyState
            illustration={
              <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-[var(--radius-panel)] border border-line-strong bg-bg-raised text-text-muted">
                <Icon icon={coming.icon} />
              </span>
            }
            title="Em preparação"
          >
            {coming.text}
          </EmptyState>
          <div className="grow-[7]" />
        </div>
      </div>
    )
  }

  const list = publications ?? []
  const editing = editor && editor.id !== 'novo' ? (list.find((item) => item.id === editor.id) ?? null) : null
  // A publicação que saiu da fila (apagada em outra janela) fecha o editor dela.
  const open = editor !== null && (editor.id === 'novo' || editing !== null)
  const close = (): void => {
    openEditor(null)
    document.querySelector<HTMLElement>('[data-redes-new]')?.focus({ preventScroll: true })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={PAGE_TOP}>
        <PageHeader
          title={title}
          titleAttrs={{ 'data-redes-title': '' }}
          description={<span data-redes-quota>{quotaLine(quota)}</span>}
          actions={
            <Button icon={Plus} action="redes-new" data={{ 'data-redes-new': '' }} onClick={() => openEditor({ accountId, id: 'novo' })}>
              Nova publicação
            </Button>
          }
        />
      </div>
      {noticeBar}
      <div className="flex min-h-0 flex-1 border-t border-line">
        <section aria-label="Fila de publicações" data-redes-list className="flex min-w-0 flex-1 flex-col">
          <PublicationsList publications={list} editingId={open && editing ? editing.id : null} onEdit={(id) => openEditor({ accountId, id })} />
        </section>
        {open && editor && <PublicationEditor key={`${editor.id}:${editor.revision}`} accountId={accountId} publication={editing} notice={editor.notice ?? null} revision={editor.revision} onClose={close} />}
      </div>
    </div>
  )
}
