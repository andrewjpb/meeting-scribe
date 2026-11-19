// Contrato 47 (plugin-navegador): os nomes das ferramentas do navegador que o agente do Assistente vê, uma por
// comando da ponte (`shared/navegador.ts`). Viram passo na conversa com o mesmo nome. Sem o zod: o renderer
// importa daqui (`CHAT_STEP_TOOLS`) e não carrega os esquemas da ponte.

export const NAVEGADOR_FERRAMENTAS = ['navegador_abrir', 'navegador_abas', 'navegador_ler', 'navegador_clicar', 'navegador_digitar', 'navegador_aguardar', 'navegador_fechar'] as const
export type NavegadorFerramenta = (typeof NAVEGADOR_FERRAMENTAS)[number]

export function isNavegadorFerramenta(value: unknown): value is NavegadorFerramenta {
  return typeof value === 'string' && (NAVEGADOR_FERRAMENTAS as readonly string[]).includes(value)
}
