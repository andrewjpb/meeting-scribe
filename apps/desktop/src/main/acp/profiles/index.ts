// Perfis de agente registrados (contrato 17, CA11). Só o Claude por enquanto; outro agente entra aqui.
import type { AgentProfileId } from '../../../shared/settings-defaults'
import { claudeProfile } from './claude'
import type { AgentProfile } from './types'

export const AGENT_PROFILE_LIST: Readonly<Record<AgentProfileId, AgentProfile>> = { claude: claudeProfile }

export function agentProfile(id: AgentProfileId): AgentProfile {
  return AGENT_PROFILE_LIST[id]
}

export type { AcpLocalMcp, AcpMcpServer, AcpPurpose, AcpSessionRequest, AgentProfile, KnownToolCall, StepTool, UsageReading } from './types'
