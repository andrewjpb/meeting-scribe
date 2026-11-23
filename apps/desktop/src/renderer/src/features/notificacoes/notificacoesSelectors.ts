// Centro de notificações (contrato 160): a lista sai dos stores que o `Shell` já sincroniza (email e WhatsApp) e das
// Configurações; a tela e o número da barra lateral usam este mesmo hook, para a regra ficar num lugar só.
import { useEffect, useMemo } from 'react'
import { contarNotificacoes, montarNotificacoes, type NotificacaoItem, type NotificacoesContagem } from '@shared/notificacoes'
import { useSettings } from '../../app/settingsStore'
import { useEmail } from '../email/emailStore'
import { useTriagem } from '../whatsapp/triagemStore'
import { useWhatsApp } from '../whatsapp/whatsappStore'

export function useNotificacoes(): { items: NotificacaoItem[]; contagem: NotificacoesContagem } {
  const chats = useWhatsApp((state) => state.chats)
  const whatsappState = useWhatsApp((state) => state.status?.state ?? null)
  // As conversas não vêm no `load()` do Shell (só o status): sem isto, numa janela que nunca abriu o WhatsApp a lista e
  // o número da barra ficariam vazios. Pede uma vez, quando conectado; os eventos do store mantêm depois.
  useEffect(() => {
    if (whatsappState === 'connected' && chats === null) void useWhatsApp.getState().loadChats()
  }, [whatsappState, chats])
  const accounts = useEmail((state) => state.accounts)
  const folders = useEmail((state) => state.folders)
  // Contrato 162: as etiquetas da triagem (o chip "Urgente" da linha).
  const etiquetas = useTriagem((state) => state.etiquetas)
  const incluirGrupos = useSettings((state) => state.settings.whatsappNotifyGroups)
  return useMemo(() => {
    // A conta aparece pelo endereço (o "· oi@lap.com.br" da linha), que não se repete entre contas.
    const contas = (accounts ?? []).map(({ account }) => ({ id: account.id, label: account.address }))
    const items = montarNotificacoes({ chats: chats ?? [], incluirGrupos, etiquetas, contas, folders })
    return { items, contagem: contarNotificacoes(items) }
  }, [chats, accounts, folders, incluirGrupos, etiquetas])
}
