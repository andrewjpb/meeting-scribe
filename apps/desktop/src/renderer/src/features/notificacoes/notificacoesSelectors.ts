// Centro de notificações (contrato 160): a lista sai dos stores que o `Shell` já sincroniza (email e WhatsApp) e das
// Configurações; a tela e o número da barra lateral usam este mesmo hook, para a regra ficar num lugar só.
import { useMemo } from 'react'
import { contarNotificacoes, montarNotificacoes, type NotificacaoItem, type NotificacoesContagem } from '@shared/notificacoes'
import type { Etiqueta } from '@shared/triagem'
import { useSettings } from '../../app/settingsStore'
import { useEmail } from '../email/emailStore'
import { useWhatsApp } from '../whatsapp/whatsappStore'

// O contrato 162 liga as etiquetas reais (`triagemStore`); até lá nenhuma conversa é urgente.
const SEM_ETIQUETAS: Readonly<Record<string, Etiqueta>> = {}

export function useNotificacoes(): { items: NotificacaoItem[]; contagem: NotificacoesContagem } {
  const chats = useWhatsApp((state) => state.chats)
  const accounts = useEmail((state) => state.accounts)
  const folders = useEmail((state) => state.folders)
  const incluirGrupos = useSettings((state) => state.settings.whatsappNotifyGroups)
  return useMemo(() => {
    // A conta aparece pelo endereço (o "· oi@lap.com.br" da linha), que não se repete entre contas.
    const contas = (accounts ?? []).map(({ account }) => ({ id: account.id, label: account.address }))
    const items = montarNotificacoes({ chats: chats ?? [], incluirGrupos, etiquetas: SEM_ETIQUETAS, contas, folders })
    return { items, contagem: contarNotificacoes(items) }
  }, [chats, accounts, folders, incluirGrupos])
}
