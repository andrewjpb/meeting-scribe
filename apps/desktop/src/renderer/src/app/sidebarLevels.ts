// Barra lateral em pilha (contratos 65 e 66): de qual nível é cada rota, o deslize entre um nível e outro e o último email
// aberto na sessão. Sem DOM: testado em test/renderer/sidebar-stack.test.ts. O nome não é `sidebarStack.ts` porque, no
// disco do Mac (sem distinção de maiúsculas), `./SidebarStack` resolveria para ele e não para o componente.
import { matchPath } from 'react-router'
import { EMAIL_ROOT_PATH, ROUTE_PATHS } from '@shared/routes'

/** Seções com nível próprio na barra lateral (contrato 66: Configurações, com as abas). */
export const SIDEBAR_SECTIONS = ['email', 'configuracoes'] as const
export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number]
export type SidebarLevel = 'root' | SidebarSection
export type SidebarTransition = 'push' | 'pop' | null

/** Duração do deslize: igual a `--duration-slow` de tokens.css. */
export const SIDEBAR_SLIDE_MS = 180
/** Reserva para tirar o nível que sai quando o `animationend` não chega (com movimento reduzido nunca chega). */
export const SIDEBAR_SLIDE_FALLBACK_MS = SIDEBAR_SLIDE_MS + 80

// Os padrões de shared/routes.ts direto no `matchPath`: o `routeIdOf` de routes.tsx importa as telas, e este arquivo
// fica puro para o teste.
const EMAIL_SECTION_PATTERN = `${EMAIL_ROOT_PATH}/*`
const EMAIL_FOLDER_PATTERN = `${EMAIL_ROOT_PATH}/:conta/:pasta`
const SETTINGS_SECTION_PATTERN = `${ROUTE_PATHS.configuracoes}/*`

export function isSidebarSection(id: string): id is SidebarSection {
  return (SIDEBAR_SECTIONS as readonly string[]).includes(id)
}

/**
 * A seção da rota: `email` em `/email` e `/email/*`, `configuracoes` em `/configuracoes` e `/configuracoes/*`; as outras
 * rotas não têm nível próprio.
 */
export function sectionOf(pathname: string): SidebarSection | null {
  if (matchPath(EMAIL_SECTION_PATTERN, pathname)) return 'email'
  return matchPath(SETTINGS_SECTION_PATTERN, pathname) ? 'configuracoes' : null
}

/**
 * O item marcado na raiz: o da seção da rota (o mesmo padrão do nível, para `/email/...` marcar "Email" em qualquer
 * profundidade) ou, fora das seções, o da rota (`routeIdOf` de routes.tsx, passado por quem chama).
 */
export function activeNavId<T extends string>(pathname: string, routeId: T | null): SidebarSection | T | null {
  return sectionOf(pathname) ?? routeId
}

/**
 * O nível mostrado sai da rota, menos quando o cabeçalho-voltar levou à raiz nesta mesma navegação (`poppedKey` é o
 * `location.key` de quando ele foi acionado). Qualquer navegação seguinte tem outro `key` e desfaz o "voltar".
 */
export function levelFor(pathname: string, poppedKey: string | null, locationKey: string): SidebarLevel {
  return poppedKey === locationKey ? 'root' : (sectionOf(pathname) ?? 'root')
}

/** Como o nível troca: nada na primeira pintura nem sem troca; entra numa seção deslizando da direita; volta à raiz pela esquerda. */
export function transitionOf(previous: SidebarLevel | null, next: SidebarLevel): SidebarTransition {
  if (previous === null || previous === next) return null
  return next === 'root' ? 'pop' : 'push'
}

// Vale para esta janela enquanto o app está aberto, como a aba lembrada de Configurações (`settingsTabs.ts`).
let rememberedEmailPath: string | null = null

/** Guarda a pasta aberta (`/email/<conta>/<pasta>`); outras rotas, e `/email` sozinho, não trocam o lembrado. */
export function rememberEmailPath(pathname: string): void {
  if (matchPath(EMAIL_FOLDER_PATTERN, pathname)) rememberedEmailPath = pathname
}

/** Destino do item "Email": a última pasta aberta, se a conta dela ainda existe; senão `/email`. */
export function lastEmailPath(accountIds: readonly string[]): string {
  if (!rememberedEmailPath) return EMAIL_ROOT_PATH
  const conta = matchPath(EMAIL_FOLDER_PATTERN, rememberedEmailPath)?.params.conta
  return conta !== undefined && accountIds.includes(conta) ? rememberedEmailPath : EMAIL_ROOT_PATH
}

/** Só para os testes. */
export function resetSidebarMemory(): void {
  rememberedEmailPath = null
}
