import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { filtrarNotificacoes, resumoNotificacoes, type NotificacaoItem, type NotificacoesFiltro } from '@shared/notificacoes'
import { emailPath, ROUTE_PATHS, type EmailNavigationState, type WhatsAppNavigationState } from '@shared/routes'
import { EmptyState } from '../../design/EmptyState'
import { PageHeader } from '../../design/PageHeader'
import { Segmented } from '../../design/Segmented'
import { useEmail } from '../email/emailStore'
import { NotificacaoRow } from './NotificacaoRow'
import { useNotificacoes } from './notificacoesSelectors'

const FILTROS: readonly { value: NotificacoesFiltro; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
]

const VAZIO: Readonly<Record<NotificacoesFiltro, string>> = {
  todas: 'Nada por ler.',
  whatsapp: 'Nada por ler no WhatsApp.',
  email: 'Nenhum e-mail por ler.',
}

/**
 * Notificações (contrato 160, mockups 01 e 02): o que está por ler no WhatsApp e na Caixa de Entrada de todas as contas,
 * numa lista só, filtrada por Todas · WhatsApp · Email. Nenhuma assinatura nova: a lista acompanha os stores que o
 * `Shell` sincroniza. A linha abre a conversa ou a mensagem como o clique na notificação do macOS (`useMainNavigation`).
 */
export function NotificacoesScreen() {
  const { items, contagem } = useNotificacoes()
  const [filtro, setFiltro] = useState<NotificacoesFiltro>('todas')
  const navigate = useNavigate()
  const accounts = useEmail((state) => state.accounts)
  const folders = useEmail((state) => state.folders)
  // Marcando como lida; a linha sai quando o store traz o `seen` novo.
  const [marcando, setMarcando] = useState<ReadonlySet<string>>(() => new Set())

  // Contas cuja Caixa de Entrada já foi pedida nesta montagem: não pede de novo (nem em laço, se o pedido falhar).
  const pedidas = useRef<Set<string>>(new Set())

  // As contas ainda não lidas nesta sessão, e a Caixa de Entrada das conectadas que ainda não veio.
  useEffect(() => {
    if (accounts === null) {
      void useEmail.getState().load()
      return
    }
    for (const status of accounts) {
      const id = status.account.id
      if (status.state !== 'connected' || folders[`${id}:inbox`] || pedidas.current.has(id)) continue
      pedidas.current.add(id)
      void useEmail.getState().loadFolder(id, 'inbox')
    }
  }, [accounts, folders])

  const abrir = (item: NotificacaoItem): void => {
    if (item.kind === 'whatsapp') {
      void navigate(ROUTE_PATHS.whatsapp, { state: { chatId: item.chatId } satisfies WhatsAppNavigationState })
      return
    }
    void navigate(emailPath(item.accountId, 'inbox'), { state: { messageId: item.id } satisfies EmailNavigationState })
  }

  const marcarComoLida = (accountId: string, id: string): void => {
    const chave = `${accountId}:${id}`
    setMarcando((atual) => new Set(atual).add(chave))
    void useEmail
      .getState()
      .markRead(accountId, id, true)
      .finally(() =>
        setMarcando((atual) => {
          const proximo = new Set(atual)
          proximo.delete(chave)
          return proximo
        }),
      )
  }

  const lista = filtrarNotificacoes(items, filtro)
  // Mockup 02: sem nada por ler, o subtítulo diz que está tudo lido (o "Nada por ler." fica no meio da tela).
  const resumo = contagem.total === 0 ? 'Tudo lido no Email e no WhatsApp.' : resumoNotificacoes(contagem)

  return (
    <div data-notificacoes-screen className="flex min-h-0 flex-1 flex-col px-[var(--page-x)] pt-[var(--page-top)]">
      <PageHeader title="Notificações" description={<span data-notificacoes-resumo>{resumo}</span>} />
      <div className="mt-4 flex shrink-0 items-center">
        <span id="notificacoes-filtro-label" className="sr-only">
          Mostrar
        </span>
        <Segmented value={filtro} options={FILTROS} onChange={setFiltro} labelledBy="notificacoes-filtro-label" dataName="notificacoes-filtro" />
      </div>
      {lista.length > 0 ? (
        <ul data-notificacoes-lista className="mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-line pb-5">
          {lista.map((item) => {
            const chave = item.kind === 'whatsapp' ? `whatsapp:${item.chatId}` : `email:${item.accountId}:${item.id}`
            return (
              <NotificacaoRow
                key={chave}
                item={item}
                onOpen={() => abrir(item)}
                {...(item.kind === 'email' ? { onMarkRead: () => marcarComoLida(item.accountId, item.id), marking: marcando.has(`${item.accountId}:${item.id}`) } : {})}
              />
            )
          })}
        </ul>
      ) : (
        <div data-notificacoes-vazia className="flex min-h-0 flex-1 items-center justify-center pb-5">
          <EmptyState illustration={null} title={VAZIO[filtro]}>
            {null}
          </EmptyState>
        </div>
      )}
    </div>
  )
}
