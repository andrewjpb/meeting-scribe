// Rotas do renderer. O main só conhece o id; o caminho é detalhe do roteador em memória.
export type RouteId = 'reunioes' | 'perguntar' | 'gravacao' | 'detalhe' | 'configuracoes'

export const ROUTE_PATHS: Record<RouteId, string> = {
  reunioes: '/',
  /** Chat sobre as reuniões (contrato 15). */
  perguntar: '/perguntar',
  gravacao: '/gravacao',
  /** Padrão do roteador; o caminho concreto sai de `meetingPath(id)`. */
  detalhe: '/reunioes/:id',
  configuracoes: '/configuracoes',
}

export function meetingPath(id: string): string {
  return `/reunioes/${encodeURIComponent(id)}`
}

export function isRouteId(value: unknown): value is RouteId {
  return typeof value === 'string' && Object.hasOwn(ROUTE_PATHS, value)
}
