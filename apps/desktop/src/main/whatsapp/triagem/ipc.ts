// Canais da triagem do WhatsApp (contrato 161). Todos recusados com o app bloqueado (`WHEN_LOCKED`, aplicado pelo
// `handle`); o serviço valida o `chatId` e o pedido de cada um. Os eventos `scribe:triagem-changed` e
// `scribe:triagem-status-changed` saem do `index.ts`, só desbloqueado.
import { handle } from '../../ipc'
import type { TriagemService } from './service'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

export function createTriagemIpc({ appOrigin, triagem }: { appOrigin: string; triagem: Pick<TriagemService, 'list' | 'set' | 'runNow' | 'createFromTemplate'> }): void {
  handle('scribe:triagem-list', appOrigin, () => triagem.list())
  // O pedido chega como a janela mandou: o serviço recusa o que estiver fora do formato.
  handle('scribe:triagem-set', appOrigin, (_event, request: unknown) => (isRecord(request) ? triagem.set(request['chatId'], request['patch']) : Promise.resolve({ ok: false as const, error: 'invalid' })))
  handle('scribe:triagem-run', appOrigin, (_event, request: unknown) => triagem.runNow(isRecord(request) ? request['chatId'] : undefined))
  handle('scribe:triagem-create-from-template', appOrigin, () => triagem.createFromTemplate())
}
