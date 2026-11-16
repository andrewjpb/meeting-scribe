// Agente do Claude pelo ACP (contrato 17): o que a tela sabe do adaptador. O pacote do app não leva o
// adaptador (o Claude Agent SDK é proprietário): ele é baixado do registro do npm na primeira vez, só com o
// clique da pessoa, para `userData/acp/<versão>/`.

/**
 * `missing`: não instalado; `installing`: baixando e conferindo (`progress` de 0 a 100); `installed`: pronto;
 * `error`: a última instalação falhou (`error` diz por quê). `bundled`: em desenvolvimento, o adaptador do
 * `node_modules` do app (não se instala nem se remove).
 */
export type AcpAgentState = 'missing' | 'installing' | 'installed' | 'error' | 'bundled'

export interface AcpAgentStatus {
  state: AcpAgentState
  /** Nome do agente na tela, do perfil (contrato 17, CA11): "Claude". */
  label: string
  /** Versão do adaptador que o app usa. */
  version: string
  /** Só em `installing`. */
  progress: number
  /** Bytes a baixar (soma dos pacotes), para "Instalar (≈4 MB)". */
  downloadBytes: number
  /** Só em `error`: frase curta para a tela. */
  error?: string | undefined
}

/** O agente pode rodar agora? */
export const acpReady = (status: Pick<AcpAgentStatus, 'state'>): boolean => status.state === 'installed' || status.state === 'bundled'

/** "≈4 MB": tamanho do download arredondado. */
export function downloadSizeLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `≈${mb >= 10 ? Math.round(mb) : Math.max(1, Math.round(mb * 10) / 10).toLocaleString('pt-BR')} MB`
}
