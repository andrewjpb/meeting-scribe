// Canais da tela Início (contrato 134, D10). Os dois pedidos não levam nada: o esquema zod `.strict()` só aceita
// `undefined` ou `{}`, e o resto é recusado sem chamar o serviço. Os dois são recusados com o app bloqueado
// (`WHEN_LOCKED`, aplicado pelo `handle`); o `scribe:inicio-changed` sai do `index.ts` só desbloqueado.
import { z } from 'zod'
import { handle } from '../ipc'
import type { InicioService } from './service'

/** Pedido sem campo nenhum. */
export const INICIO_PEDIDO = z.object({}).strict().optional()

export function registerInicioIpc({ appOrigin, inicio }: { appOrigin: string; inicio: Pick<InicioService, 'view' | 'macAccess'> }): void {
  /** O pedido chega como o renderer mandou (o tipo diz `undefined`, mas a janela pode mandar qualquer coisa). */
  const canal = (channel: 'scribe:inicio-get' | 'scribe:inicio-mac-acesso', run: () => ReturnType<InicioService['view']>): void => {
    const handler = (_event: unknown, request?: unknown): ReturnType<InicioService['view']> => {
      if (!INICIO_PEDIDO.safeParse(request).success) return Promise.reject(new Error(`${channel}: pedido fora do formato`))
      return run()
    }
    handle(channel, appOrigin, handler as never)
  }
  canal('scribe:inicio-get', () => inicio.view())
  canal('scribe:inicio-mac-acesso', () => inicio.macAccess())
}
