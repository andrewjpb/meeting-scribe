import { useNavigate } from 'react-router'
import { ROUTE_PATHS } from '@shared/routes'
import { downloadProgressLabel } from './updatesFormat'
import { UPDATES_SECTION, useUpdates } from './updatesStore'

/**
 * Aviso discreto de versão nova na barra lateral, acima das permissões (contrato 14, CA2): quadrado de
 * 6 px no azul vibrante, "Nova versão 0.2.0" e "Atualizar", que começa o download e abre o bloco
 * "Atualizações" em Configurações, onde ficam o andamento, a instrução e "Fechar o app agora".
 */
export function UpdateNotice() {
  const available = useUpdates((store) => store.state.available)
  const download = useUpdates((store) => store.state.download)
  const start = useUpdates((store) => store.download)
  const navigate = useNavigate()
  if (!available) return null

  const progress = downloadProgressLabel(download)
  const update = (): void => {
    void start()
    void navigate(ROUTE_PATHS.configuracoes, { state: { section: UPDATES_SECTION } })
  }

  return (
    <section aria-label="Atualização" data-update-notice className="flex flex-col border-t border-side-active px-1 py-3">
      <div className="flex items-center gap-2 text-12">
        <span aria-hidden="true" className="size-1.5 shrink-0 bg-side-ok" />
        <span data-update-notice-text className="grow whitespace-nowrap">
          {progress ?? `Nova versão ${available.version}`}
        </span>
        {!progress && (
          <button
            type="button"
            data-action="update-now"
            onClick={update}
            className="no-drag h-6 rounded-[var(--radius-control)] border border-side-outline px-2 text-11 font-medium text-side-text transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)] hover:bg-side-active"
          >
            Atualizar
          </button>
        )}
      </div>
    </section>
  )
}
