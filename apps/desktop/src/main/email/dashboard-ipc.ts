// Canais do Painel de e-mail (contrato 156). Os pedidos são validados aqui com zod (`.strict()`: strings não vazias,
// `messageKeys` de 1 a 500, `kind` só `reply` ou `move`); fora do formato, recusado sem chamar o serviço. Os cinco são
// recusados com o app bloqueado (`WHEN_LOCKED`, aplicado pelo `handle`), como o resto do email. O "Mover" só existe aqui,
// atrás do clique da tela: nenhuma passada, tarefa ou Assistente chega no `applyMove`.
import { z } from 'zod'
import { EMAIL_MOVE_MAX } from '../../shared/email'
import type { InvokeChannel } from '../../shared/ipc'
import { handle } from '../ipc'
import type { EmailDashboardService } from './dashboard'

const texto = z.string().min(1).max(1024)
const vazio = z.object({}).strict().optional()
export const DASHBOARD_IGNORE_REQUEST = z.object({ accountId: texto, messageKey: texto, kind: z.enum(['reply', 'move']) }).strict()
export const DASHBOARD_OPENED_REQUEST = z.object({ accountId: texto, messageKey: texto }).strict()
export const DASHBOARD_MOVE_REQUEST = z.object({ accountId: texto, folder: texto, messageKeys: z.array(texto).min(1).max(EMAIL_MOVE_MAX) }).strict()

type Dashboard = Pick<EmailDashboardService, 'view' | 'run' | 'ignore' | 'markOpened' | 'applyMove'>

export function registerEmailDashboardIpc({ appOrigin, dashboard }: { appOrigin: string; dashboard: Dashboard }): void {
  /** O pedido chega como o renderer mandou (o tipo diz o formato, mas a janela pode mandar qualquer coisa). */
  const canal = <S extends z.ZodType, R>(channel: Extract<InvokeChannel, `scribe:email-dashboard-${string}`>, schema: S, run: (request: z.infer<S>) => Promise<R>): void => {
    const handler = (_event: unknown, request?: unknown): Promise<R> => {
      const parsed = schema.safeParse(request)
      if (!parsed.success) return Promise.reject(new Error(`${channel}: pedido fora do formato`))
      return run(parsed.data)
    }
    handle(channel, appOrigin, handler as never)
  }
  canal('scribe:email-dashboard-get', vazio, () => dashboard.view())
  canal('scribe:email-dashboard-run', vazio, () => dashboard.run('manual'))
  canal('scribe:email-dashboard-ignore', DASHBOARD_IGNORE_REQUEST, (request) => dashboard.ignore(request.accountId, request.messageKey, request.kind))
  canal('scribe:email-dashboard-opened', DASHBOARD_OPENED_REQUEST, (request) => dashboard.markOpened(request.accountId, request.messageKey))
  canal('scribe:email-dashboard-apply-move', DASHBOARD_MOVE_REQUEST, (request) => dashboard.applyMove(request.accountId, request.folder, request.messageKeys))
}
