// Onde está o adaptador ACP (contrato 17). O pacote não leva o adaptador (o Claude Agent SDK é
// proprietário): no app instalado ele vem de `userData/acp/<versão>/`, baixado com o clique da pessoa
// (`install.ts`). Em desenvolvimento, o do `node_modules` do app, sempre pronto.
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { AcpAgentStatus } from '../../shared/acp'
import type { AcpInstaller } from './install'
import type { AgentProfile } from './profiles'

/** Script do agente do perfil no `node_modules` do app (desenvolvimento). */
export function bundledAdapterEntry(profile: AgentProfile, appPath: string): string {
  const require = createRequire(join(appPath, 'package.json'))
  const root = dirname(require.resolve(`${profile.bundledPackage}/package.json`))
  // `entry` começa pelo nome do pacote dentro de `node_modules`.
  return join(root, ...profile.install.entry.slice(profile.bundledPackage.split('/').length))
}

/** O agente como o resto do app o vê: estado, instalar, remover e o script para rodar. */
export interface AcpAgentService {
  status(): AcpAgentStatus
  install(): Promise<AcpAgentStatus>
  remove(): Promise<AcpAgentStatus>
  /** Script do adaptador; `null` se não instalado. */
  entry(): string | null
  /** Pode rodar agora (instalado ou de desenvolvimento)? */
  available(): boolean
}

/** Desenvolvimento: o adaptador do `node_modules`, sem instalar nem remover. */
export function bundledAgent(profile: AgentProfile, entry: string): AcpAgentService {
  const status = (): AcpAgentStatus => ({ state: 'bundled', label: profile.label, version: profile.install.version, progress: 100, downloadBytes: 0 })
  return { status, install: () => Promise.resolve(status()), remove: () => Promise.resolve(status()), entry: () => entry, available: () => true }
}

/**
 * App instalado: o adaptador de `userData/acp`. `run` troca o script instalado pelo que roda de fato (o smoke
 * instala os pacotes do registro falso e roda o agente falso).
 */
export function installedAgent(installer: AcpInstaller, run: (installed: string) => string = (installed) => installed): AcpAgentService {
  return {
    status: () => installer.status(),
    install: () => installer.install(),
    remove: () => installer.remove(),
    entry: () => {
      const installed = installer.entry()
      return installed ? run(installed) : null
    },
    available: () => installer.entry() !== null,
  }
}
