// Nome do agente do perfil escolhido nas Configurações (contrato 17, CA11): "Claude".
import { AGENT_PROFILE_LABELS } from '@shared/settings-defaults'
import { useSettings } from './settingsStore'

export function useAgentLabel(): string {
  return AGENT_PROFILE_LABELS[useSettings((state) => state.settings.agentProfile)]
}
