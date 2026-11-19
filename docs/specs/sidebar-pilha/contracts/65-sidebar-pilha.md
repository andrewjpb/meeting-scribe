# Contrato 65: Sidebar em pilha (raiz com Email, nível Email, cabeçalho-voltar e deslize)
Feature: sidebar-pilha · Wave: 1 · Depende de: nada · Spec: `docs/specs/sidebar-pilha/spec.md` (R1 a R8 na parte do Email, N1 a N3) · Plan: `docs/specs/sidebar-pilha/plan.md` (T1 a T7, T9, T10) · Mockup: `docs/specs/sidebar-pilha/mockups/SidebarPilha.dc.html` (telas 01, 02, 04 e 05)

Este contrato transforma a coluna do meio do sidebar numa pilha de dois níveis: a **raiz** (com o item novo Email) e o **nível Email** (com as contas de email que hoje ficam soltas abaixo dos itens). A marca no topo e o rodapé ficam parados. **Configurações continua item plano, com as Tabs de hoje**: o nível Configurações é do contrato 66. Este documento é tudo o que você precisa; a spec e o plan são só referência.

**Você não commita.** Termine com o relatório; quem coordena revisa e commita.

## Pré-condições
- Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-sidebar-pilha`, branch `sidebar-pilha`, a partir da main em `7847043` (ou o que o coordenador indicar). `git status` sem mudança em `apps/`. A pasta `docs/specs/sidebar-pilha/` pode estar lá, não mexa nela.
- Ler antes (caminhos a partir de `apps/desktop/`):
  - `src/renderer/src/app/Sidebar.tsx`, `src/renderer/src/app/routes.tsx` (tabela `APP_ROUTES`, `routeIdOf`), `src/renderer/src/app/Shell.tsx` (só ler: não muda), `src/renderer/src/app/LockButton.tsx`, `src/renderer/src/features/permissions/PermissionsBlock.tsx`.
  - `src/shared/routes.ts` (`ROUTE_PATHS`, `emailPath`, `EMAIL_FOLDER_SLUGS`, `settingsPath`).
  - `src/renderer/src/features/email/EmailNav.tsx`, `emailStore.ts` (`useEmail`, `folderKey`), `format.ts` (`unreadCount`, `unreadByAccount`, `unreadBadge`, `accountLabel`), `EmailScreen.tsx` (só ler: o que `/email` faz sem conta e sem pasta; **não mexer**).
  - `src/renderer/src/features/settings/settingsTabs.ts` (o padrão `rememberedTab` / `lastSettingsTab` / `rememberSettingsTab`, que você copia para o email).
  - `src/renderer/src/design/base.css` (camadas `@layer components`, keyframes no fim do arquivo, `.route-enter`), `src/renderer/src/design/tokens.css` (`--duration-slow: 180ms`, `--ease-out`, a regra de `prefers-reduced-motion` no fim), `src/renderer/src/design/Icon.tsx`.
  - `src/main/smoke.ts`: `clickSelector`, `waitFor`, `evaluate`, `activeNav`, `routeIs`, `keyboardNavigation`, `reducedMotion` (usa `contents.debugger` com `Emulation.setEmulatedMedia`), `capture`, `openEmailFolder`, `emailChecks` (a conta do servidor IMAP falso, a conta com erro, o recolher da conta, a janela `dark`).
  - `test/renderer/settings-tabs.test.ts` (o jeito dos testes puros do renderer), `resources/assistente/guia-do-app.md` (seções "Barra lateral" e "Email").
  - O mockup, telas 01, 02, 04 e 05, aberto no navegador.

## Como é hoje (conferido em 19/11/2026)
- `Sidebar.tsx`: `<aside>` de 224 px (`--sidebar-width`) com `px-3`; faixa de 52 px; marca; `<nav aria-label="Navegação principal" className="mt-6 ...">` com um `NavLink` de 40 px por rota com `nav` (Reuniões, Assistente, Automações, WhatsApp só com o serviço instalado, Configurações), `data-nav={id}`, Reuniões com `end`; logo abaixo `<EmailNav />`; rodapé `mt-auto` com `LockButton`, `UpdateNotice`, `PermissionsBlock`.
- `EmailNav.tsx`: `<nav aria-label="Email" data-email-nav className="mt-4 flex min-h-0 flex-col gap-0.5 overflow-y-auto">`; por conta, `<button data-email-account-toggle>` de 40 px com `ChevronDown`/`ChevronRight` que grava `settings.emailCollapsed`; recolhida, o número de não lidas; aberta, `NavLink` "Caixa de Entrada" (`data-email-folder="inbox"`, número em `data-email-unread-count`) e "Enviados" (`data-email-folder="sent"`), `pl-8`. Sem conta, `return null`.
- `routes.tsx`: a rota `email` não tem `nav`. `ROUTE_PATHS.email` é o padrão `'/email/:conta?/:pasta?'`, **não serve de destino** de navegação.
- `/email` com conta abre a Caixa de Entrada da primeira (`EmailScreen` faz `Navigate replace`). Sem conta nenhuma, mostra a nota "Nenhuma conta de email ainda. Adicione uma em Configurações › Contas › Email." com o link "Abrir Contas".
- `tokens.css` zera **toda** animação e transição com `prefers-reduced-motion: reduce` (`animation: none !important`). Com isso o evento `animationend` **nunca dispara**: nada pode depender só dele.

## Superfície (caminhos a partir de `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/renderer/src/app/sidebarStack.ts` | **novo**, só funções puras e a memória de módulo (CA20) |
| `src/renderer/src/app/SidebarStack.tsx` | **novo**: a coluna em pilha, os níveis, o cabeçalho-voltar, a transição |
| `src/renderer/src/app/Sidebar.tsx` | usa o `SidebarStack` no lugar do `<nav>` + `<EmailNav />`; itens da raiz com o clique da seção, o ativo calculado e o número do Email |
| `src/renderer/src/app/routes.tsx` | rota `email` ganha `nav: { label: 'Email', icon: Mail }` e sobe para logo depois de `assistente` |
| `src/shared/routes.ts` | `export const EMAIL_ROOT_PATH = '/email'` |
| `src/renderer/src/features/email/EmailNav.tsx` | três mudanças mínimas (CA13); o resto fica igual |
| `src/renderer/src/features/email/format.ts` | `totalUnread(accounts, folders)` ao lado de `unreadByAccount` |
| `src/renderer/src/design/base.css` | keyframes e classes do deslize (CA14) |
| `src/main/smoke.ts` | helpers `showRoot`, `clickNav`, `showEmailLevel`; ajustes dos passos que quebram; passos e prints novos (CA21) |
| `test/renderer/sidebar-stack.test.ts` | **novo** (CA20) |
| `resources/assistente/guia-do-app.md` | "Barra lateral" e "Email" (CA22) |

Não mexer: `Shell.tsx`, `EmailScreen.tsx`, `ReadingPane.tsx`, qualquer arquivo de `features/settings/`, `design/Tabs.tsx`, `tokens.css`, nada em `src/main/` fora do `smoke.ts`, nada em `src/preload/`, `docs/`.

## Ganchos de DOM (fixos; o smoke e o 66 dependem deles)
- Coluna do meio: `data-sidebar-stack`; com a classe `is-sliding` só durante a transição.
- Cada nível: `<nav data-sidebar-level="root" aria-label="Navegação principal">` e `<nav data-sidebar-level="email" aria-label="Email">`. O que está saindo ganha também `data-sidebar-leaving`, `inert` e `aria-hidden="true"`.
- Cabeçalho-voltar: `<button type="button" data-sidebar-back aria-label="Email: voltar ao menu">`.
- Item da raiz: `data-nav={id}` como hoje (`email` no novo); número do Email: `<span data-nav-badge>`.
- Mantidos do `EmailNav`: `data-email-nav`, `data-email-account`, `data-email-account-toggle`, `data-email-folder`, `data-email-folder-account`, `data-email-unread-count`, `data-email-account-error`. Novo: `data-email-account-header={id}` na linha da conta única (D1).

## Funções puras (`src/renderer/src/app/sidebarStack.ts`)
```ts
export type SidebarSection = 'email'            // o 66 acrescenta 'configuracoes'
export type SidebarLevel = 'root' | SidebarSection
export type SidebarTransition = 'push' | 'pop' | null
export const SIDEBAR_SLIDE_MS = 180              // igual a --duration-slow; comentário dizendo isso
export const SIDEBAR_SLIDE_FALLBACK_MS = SIDEBAR_SLIDE_MS + 80
export function sectionOf(pathname: string): SidebarSection | null          // por routeIdOf; 'email' em /email e /email/*
export function levelFor(pathname: string, poppedKey: string | null, locationKey: string): SidebarLevel
//   poppedKey === locationKey ? 'root' : (sectionOf(pathname) ?? 'root')
export function transitionOf(previous: SidebarLevel | null, next: SidebarLevel): SidebarTransition
//   previous null (primeira pintura) ou igual → null; root→seção e seção→outra seção → 'push'; seção→root → 'pop'
export function rememberEmailPath(pathname: string): void                   // guarda só /email/<conta>/<pasta> (casa com matchPath)
export function lastEmailPath(accountIds: readonly string[]): string        // o lembrado se a conta está na lista; senão EMAIL_ROOT_PATH
export function resetSidebarMemory(): void                                  // só para os testes
```
`routeIdOf` está em `app/routes.tsx`, que importa telas: se isso atrapalhar o teste puro, use `matchPath` direto com os padrões de `shared/routes.ts` (`'/email/*'`) e deixe um comentário. A memória do email é de módulo, como o `rememberedTab` de `settingsTabs.ts`: vale enquanto a janela está aberta, não vai para settings nem para disco.

`totalUnread(accounts: readonly { account: { id: string } }[] | null, folders: Readonly<Record<string, readonly Pick<EmailMessage, 'seen' | 'folder'>[] | undefined>>): number` em `features/email/format.ts`: soma `unreadCount(folders[folderKey(id, 'inbox')])` de cada conta; `null` → 0. Se importar `folderKey` de `emailStore.ts` puxar o store para o teste, repita a chave `${id}:inbox` com um comentário apontando para `folderKey`.

## Critérios de aceite
Entre parênteses, o CA da spec que cada um cobre.

### Raiz (telas 01 e 05)
- **CA1. Itens (spec CA1, R1).** Na raiz, a ordem é Reuniões, Assistente, Email, Automações, WhatsApp (só com o serviço instalado, como hoje), Configurações; todos com 40 px de altura, ícone 16 + rótulo 13, no desenho de hoje (`text-side-muted`, ativo com `bg-side-active text-side-text`). Email usa o ícone `Mail` do `lucide-react` pelo `Icon`. A raiz fica na mesma altura do `<nav>` de hoje (o `mt-6` abaixo da marca).
- **CA2. Item ativo (R1).** `aria-current="page"` e a classe ativa saem de `routeIdOf(location.pathname) === item.id`: Reuniões só em `/` (o detalhe `/reunioes/:id` e a gravação não marcam nada, como hoje); Email em `/email` e `/email/*`; Configurações em `/configuracoes/*`. Os itens deixam de usar o `isActive` do `NavLink` (o destino do Email muda com o último destino); use `Link` com a classe e o `aria-current` calculados.
- **CA3. Número do Email (spec CA2, R1, D3).** À direita do rótulo, `<span data-nav-badge>` com `unreadBadge(totalUnread(...))` (12 px, `tabular`, `text-side-text`, peso 500) e `<span className="sr-only"> não lidas</span>`. Lido por `useEmail((s) => totalUnread(s.accounts, s.folders))`. Zero, ou contas ainda não carregadas (`accounts === null`): o span não existe. Acima de 999: "999+". Com 2 contas e 3 não lidas somadas, mostra "3" e o leitor de tela lê "3 não lidas"; marcar a última não lida como lida faz o número sumir.
- **CA4. Sem conta (spec CA3).** Sem conta de email (`accounts` vazio), o item Email aparece sem número; o clique navega para `EMAIL_ROOT_PATH` (`/email`), que mostra a nota "Nenhuma conta de email ainda" da tela, e o nível Email mostra o cabeçalho e, abaixo, só a frase "Nenhuma conta de email ainda." (12 px, `text-side-muted`, recuo de 10 px). Com `accounts === null` (carregando), nada abaixo do cabeçalho.

### Nível como estado da UI (R6)
- **CA5. Derivação.** No `Sidebar` (ou `SidebarStack`), um único estado `poppedKey: string | null`; o nível mostrado é `levelFor(location.pathname, poppedKey, location.key)`. **Sem `useEffect` de sincronização**: como o `MemoryRouter` dá um `key` novo a cada navegação (inclusive `replace`), qualquer navegação desfaz o "voltar" sozinha. Toda navegação para `/email/*` mostra o nível Email, venha de onde vier (clique, menu, `scribe:open-email`, link na tela); toda navegação para outra rota mostra a raiz.
- **CA6. Entrar vindo de outra rota (spec CA4, parte Email).** Em Reuniões, clicar Email faz `preventDefault` e `navigate(lastEmailPath(ids das contas))`: o último `/email/<conta>/<pasta>` aberto nesta sessão, ou `/email` na primeira vez (que abre a Caixa de Entrada da primeira conta). O `Sidebar` chama `rememberEmailPath(location.pathname)` a cada `location` (num `useEffect` com `[location.pathname]`); não mexa no `EmailScreen.tsx` para isso. Conta lembrada que foi removida: `/email` (N3).
- **CA7. Entrar estando na seção (spec CA5, parte Email).** Na tela de email, depois de voltar à raiz, clicar Email faz `preventDefault` e `setPoppedKey(null)`: o nível aparece **sem navegar** (rota, lista e mensagem aberta iguais).
- **CA8. Voltar não navega (spec CA6, R6, D4).** No nível Email com uma mensagem aberta, o cabeçalho-voltar faz `setPoppedKey(location.key)`: aparece a raiz; rota, lista e mensagem aberta continuam; o item Email fica com `aria-current="page"`.
- **CA9. Rota leva ao nível (spec CA7, parte Email).** De qualquer nível: o clique num aviso de email (`scribe:open-email`, tratado em `useMainNavigation.ts`, que você não muda) mostra o nível Email; `scribe:navigate` para `gravacao` ou `automacoes` mostra a raiz; ⌘, (Configurações, ainda plano neste contrato) mostra a raiz com Configurações marcada.
- **CA10. Abrir já numa seção (spec CA8).** Na primeira pintura do sidebar (`transitionOf(null, nivel)`), o nível aparece sem classe de deslize. Recarregar a janela numa rota de email mostra o nível Email direto.

### Cabeçalho-voltar e foco (R5, R8)
- **CA11. Desenho.** Primeira linha do nível, 40 px, `<button>` inteiro clicável: `ChevronLeft` 16, `Mail` 16 e "Email" em 13 peso 500 `text-side-text`; hover com `bg-side-active`; raio `--radius-control`; `no-drag`; foco visível do app (branco sobre `--side-bg`). `aria-label="Email: voltar ao menu"` (o nome visível vem na frente, decisão de 19/11/2026). Ícones com `aria-hidden` (o `Icon` já faz). Abaixo dele, 8 px até o conteúdo. O cabeçalho não rola com o conteúdo.
- **CA12. Foco (spec CA16).** Só quando o nível entra por **clique ou Enter no item Email da raiz**, o foco vai para `[data-sidebar-back]` do nível novo (uma marca `focusOnEnter` posta no clique e lida depois da troca). Acionar o cabeçalho põe o foco em `[data-nav="email"]` da raiz. Navegação vinda de fora do sidebar (aviso de email, ⌘, e outros itens de menu, link na tela) **não mexe no foco**.

### Nível Email (tela 02)
- **CA13. Conteúdo (spec CA12, R3).** O nível é `<nav data-sidebar-level="email" aria-label="Email">` com o cabeçalho e o `<EmailNav />`. No `EmailNav.tsx`, só estas três mudanças:
  1. O elemento de fora deixa de ser `<nav aria-label="Email">` e vira `<div data-email-nav>` (o `<nav>` agora é o nível), sem o `mt-4`, com `min-h-0 flex-1 overflow-y-auto`.
  2. **D1, conta única:** com `accounts.length === 1`, a linha da conta vira `<div data-email-account-header={id} title={endereço}>` com a mesma classe `ROW`, sem seta, sem `aria-expanded`, sem número na linha; as pastas aparecem sempre, ignorando `emailCollapsed`. Com 2 ou mais contas, tudo como hoje (botão `data-email-account-toggle`, recolher grava `emailCollapsed`).
  3. Nada mais: classes `ROW`/`linkClass`, `NavLink`s, ícones, `data-*` e textos ficam iguais.
  Ao montar o nível Email, a pasta aberta (`[aria-current="page"]` dentro de `[data-email-nav]`) fica à vista ajustando o `scrollTop` do `[data-email-nav]` (não use `scrollIntoView`: ele pode rolar na horizontal a coluna cortada durante o deslize). Com contas que passam da altura, só o `[data-email-nav]` rola; cabeçalho, marca e rodapé ficam.

### Deslize (R7; tela 04)
- **CA14. CSS (spec CA9).** Em `design/base.css`, dentro de um `@layer components` novo com comentário citando o contrato 65:
  - `.side-stack`: `display: grid; grid-template: 1fr / 1fr; min-height: 0;` e `.side-stack.is-sliding { overflow: hidden; }`. Cada nível em `grid-area: 1 / 1`, `min-height: 0`, coluna flex. A coluna ocupa os 224 px inteiros: margem de -12 px dos lados e 12 px de recuo por dentro (`-mx-3 px-3`), para o deslize chegar à borda do sidebar.
  - Keyframes no fim do arquivo: `side-push-in` (de `transform: translateX(100%)`), `side-push-out` (para `transform: translateX(-30%); opacity: 0`), `side-pop-in` (de `transform: translateX(-30%); opacity: 0`), `side-pop-out` (para `transform: translateX(100%)`).
  - Classes `.side-level-push-in`, `.side-level-push-out`, `.side-level-pop-in`, `.side-level-pop-out` com `animation: <keyframe> var(--duration-slow) var(--ease-out) both`.
  - Nenhuma cor, sombra, raio novo; nenhum literal de cor (gate 6). Não mexa na regra de `prefers-reduced-motion` do `tokens.css`.
- **CA15. Dois níveis só na transição (spec CA9).** `SidebarStack` guarda `{ atual, saindo: { nivel, transicao } | null }`. Quando o nível derivado muda e `transitionOf` não é `null`: o anterior vira `saindo` (com a classe `-out` da transição, `data-sidebar-leaving`, `inert`, `aria-hidden="true"`), o novo entra com a classe `-in`, e a coluna ganha `is-sliding`. O `saindo` sai do DOM no `animationend` do nível que entra (conferindo `event.target === event.currentTarget`) **ou** por um temporizador de `SIDEBAR_SLIDE_FALLBACK_MS` (260 ms), o que vier primeiro; os dois limpam o outro. **O temporizador é obrigatório**: com movimento reduzido o `tokens.css` zera a animação e o `animationend` nunca chega. Mudança de nível no meio de uma transição: o `saindo` antigo some na hora, o temporizador antigo é cancelado e a transição nova começa. Depois da transição: um nível só, sem classe de deslize, sem `is-sliding`.
- **CA16. Movimento reduzido (spec CA10).** Com `window.matchMedia('(prefers-reduced-motion: reduce)').matches` lido **no momento da troca** (não guardado na montagem, para a emulação do smoke valer), não cria o `saindo` nem põe classe: a troca é instantânea e nunca há dois níveis no DOM.
- **CA17. Partes paradas (spec CA11).** Durante a transição, a marca (`[data-brand]`) e o rodapé (`[data-action="lock-app"]` e a seção "Permissões") não mudam de posição: o mesmo `getBoundingClientRect()` antes, no meio e depois. O sidebar continua com 224 px.

### Acessibilidade e design (R8)
- **CA18. (spec CA17, parte raiz e Email).** Raiz em `<nav aria-label="Navegação principal">`, nível em `<nav aria-label="Email">`, cabeçalho com `aria-label="Email: voltar ao menu"`, item e pasta ativos com `aria-current="page"`, seta e ícones com `aria-hidden`, número com o texto "não lidas" só para leitor de tela. Tab chega ao cabeçalho, às contas e às pastas; Enter e Espaço acionam.
- **CA19. (spec CA18).** Só tokens de `tokens.css`, sem sombra, raio 4, ícones `lucide-react` pelo `Icon`, textos do mockup ("Email", "Nenhuma conta de email ainda.").

### Testes, smoke e docs
- **CA20. Testes de unidade (spec CA19, parte Email).** `test/renderer/sidebar-stack.test.ts` (Vitest; o `vitest.config` já inclui `test/**/*.test.ts`), com `resetSidebarMemory()` no `beforeEach`:
  - `sectionOf`: `/email` e `/email/a/entrada` → `'email'`; `/`, `/reunioes/x`, `/gravacao`, `/automacoes`, `/whatsapp`, `/assistente`, `/configuracoes/geral` → `null`.
  - `levelFor`: sem `poppedKey` em `/email/a/entrada` → `'email'`; com `poppedKey === locationKey` → `'root'`; com `poppedKey` de outra navegação → `'email'`; em `/` → `'root'`.
  - `transitionOf`: `(null, 'email')` e `('email', 'email')` → `null`; `('root', 'email')` → `'push'`; `('email', 'root')` → `'pop'`.
  - `lastEmailPath`: sem nada lembrado → `/email`; depois de `rememberEmailPath('/email/b/enviados')` com `['a','b']` → `/email/b/enviados`; com `['a']` → `/email`; `rememberEmailPath('/email')` e `('/reunioes')` não trocam o lembrado.
  - `totalUnread`: `null` → 0; duas contas com 2 e 1 não lidas na Caixa de Entrada → 3; mensagem não lida em `sent` não conta; conta sem lista carregada → 0.
- **CA21. Smoke (spec CA20, parte Email).** Em `src/main/smoke.ts`:
  - **Os ~60 usos de `[data-nav="..."]` continuam funcionando** (hoje: 23 cliques em `reunioes`, 10 em `assistente`, 9 em `configuracoes`, 5 em `whatsapp`, 4 em `automacoes`, e leituras de presença). Crie `showRoot(contents)`: se `[data-sidebar-level="root"]:not([data-sidebar-leaving])` não existe, clica o `[data-sidebar-back]` que não está saindo e espera a raiz. Crie `clickNav(contents, id)`: `showRoot` + clique em `[data-sidebar-level="root"]:not([data-sidebar-leaving]) [data-nav="${id}"]`. Troque **todo** `clickSelector(contents, '[data-nav="..."]')` por `clickNav`. Toda leitura de presença ou ausência de `[data-nav=...]` (o WhatsApp que some, o `sidebarFirst` do Assistente) passa a rodar depois de `showRoot`, senão a ausência passa sem conferir nada.
  - `activeNav` passa a ler `[data-nav][aria-current="page"]` (hoje lê o primeiro `[aria-current="page"]`, que no nível Email é a pasta).
  - `keyboardNavigation`: o item Email acrescenta uma parada de Tab antes de Configurações; suba o limite do laço de 6 para 8.
  - Crie `showEmailLevel(contents)`: se `[data-sidebar-level="email"]:not([data-sidebar-leaving])` não existe, `clickNav(contents, 'email')` e espera o nível. `openEmailFolder` chama `showEmailLevel` antes de esperar o link da pasta.
  - Em `emailChecks` (e nas outras funções de email: `emailAssistantChecks`, `emailTaskChecks`, `emailNotifyCheck`), toda leitura de seletor do `EmailNav` (`[data-email-nav]`, `[data-email-account]`, `[data-email-account-toggle]`, `[data-email-folder=...]`, `[data-email-unread-count]`, `[data-email-account-error]`) feita **fora da rota de email** (por exemplo, logo depois de adicionar ou remover conta em Configurações › Contas) precisa de um destes caminhos: chamar `showEmailLevel` antes, se o passo pode mudar de rota; ou trocar a leitura pela equivalente que está à mostra (`[data-email-settings-account]` na tela de Contas, `[data-nav-badge]` na raiz) sem mudar **o que** o passo confere. O `navHidden` (sem conta, nada de `[data-email-nav]`) continua valendo.
  - **D1 quebra o passo de recolher:** hoje ele recolhe a única conta (`collapsed`, `stillCollapsed` e o reabrir). Com uma conta não há seta. Mova esse trecho para o momento em que há duas contas (depois de a conta com erro aparecer, `errorInSidebar`, e antes de removê-la), conferindo o mesmo (recolher, `aria-expanded="false"`, persistir numa janela nova, abrir de novo). Com uma conta, confira `[data-email-account-header]` sem `aria-expanded` e as duas pastas à mostra.
  - Passos novos, num `Record<string, Check>` próprio (`sidebar`) ou dentro de `email`: CA1 (ordem dos `data-nav` na raiz com o serviço do WhatsApp do jeito que o smoke deixar), CA3 (o `data-nav-badge` com o mesmo número de `[data-email-unread-count]`; some depois de marcar a última como lida, se o passo de email já faz isso), CA6, CA7, CA8 (rota e `[data-email-reading] [data-email-subject]` iguais antes e depois de voltar; `[data-nav="email"]` com `aria-current`), CA9 (`scribe:open-email` mandado pelo main com a raiz à mostra leva ao nível; `scribe:navigate` `gravacao` volta à raiz), CA12 (foco no `[data-sidebar-back]` depois do clique; no `[data-nav="email"]` depois de voltar; foco inalterado depois de `scribe:open-email`), CA15 (num mesmo `evaluate`: clique, espera um `requestAnimationFrame`, lê dois `[data-sidebar-level]`, o que sai com `inert`, `aria-hidden` e a classe `-out`, e `is-sliding`; depois de 400 ms, um só e sem `is-sliding`; dois cliques seguidos, entrar e voltar, terminam com um só nível, a raiz), CA16 (com `contents.debugger` e `Emulation.setEmulatedMedia` `prefers-reduced-motion: reduce`, como o `reducedMotion` já faz: depois do clique e de um `requestAnimationFrame`, um só `[data-sidebar-level]`; desligar a emulação e soltar o debugger no `finally`), CA17 (retângulos de `[data-brand]` e `[data-action="lock-app"]` antes, no `requestAnimationFrame` do meio e depois). Se a leitura do meio falhar por tempo, tente até 3 `requestAnimationFrame`, não mais.
  - Prints com `capture(win, ctx.outDir, nome)` (gravam em `apps/desktop/out/smoke/<nome>.png`), tirados em `emailChecks` com a conta do servidor IMAP falso conectada: `sidebar-raiz-light` (em Reuniões, raiz com o número do Email) e `sidebar-email-light` (nível Email com a Caixa de Entrada aberta, de preferência no trecho com duas contas, uma aberta e a com erro); `sidebar-raiz-dark` e `sidebar-email-dark` na janela `dark` do mesmo passo (com uma conta basta: mostra o D1). Chame o `settle` antes de cada print.
- **CA22. Guia do app (spec CA21, parte Email).** `resources/assistente/guia-do-app.md`: na seção "Barra lateral", a raiz (Reuniões, Assistente, Email com o número de não lidas, Automações, WhatsApp quando instalado, Configurações), que Email abre um nível próprio com as contas e que a seta no topo volta ao menu sem sair da tela; na seção "Email", trocar "Cada conta aparece na barra lateral, abaixo dos outros itens" pelo nível Email. Configurações continua descrita como hoje (é do 66).

## Invariantes
- Nenhuma rota, canal de IPC, chave de settings ou permissão nova. `emailCollapsed` continua filtrado como hoje.
- O que cada tela mostra não muda: só o sidebar.
- `scribe:navigate`, `scribe:open-email`, `scribe:open-settings` e os outros eventos do main continuam como estão em `useMainNavigation.ts` (não editar).
- Com o app bloqueado, nada muda (o sidebar fica atrás da camada de bloqueio).
- Configurações segue item plano, com as Tabs e os atalhos de hoje.
- Nenhuma biblioteca nova (nem de animação). Nenhum atalho de teclado novo.

## Fora de escopo
- Nível Configurações, Tabs, `SettingsScreen` (contrato 66).
- `design.md`, `README.md` e o arquivamento da spec (fechamento da feature).
- Árvore de pastas do email (contrato 55, em outra branch).

## Gates
- Na raiz do worktree: `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` (roda `bash apps/desktop/scripts/gates.sh`), verde nos 8 passos: `typecheck`, `lint` (`--max-warnings 0`), `test` (Vitest), `build`, `smoke`, literais de cor fora de `tokens.css`, `check-shapes.sh` (sem sombra, raio até 6, sem pílula) e o pytest do serviço do WhatsApp. Um passo só: `pnpm --filter @meeting-scribe/desktop typecheck` (ou `lint`, `test`, `smoke`).
- `test/renderer/sidebar-stack.test.ts` existe e passa com os casos do CA20.
- Os 4 prints (`sidebar-raiz-light/dark`, `sidebar-email-light/dark`) existem em `apps/desktop/out/smoke/` e foram conferidos por você contra as telas 01, 02 e 05 do mockup antes do relatório (diga no relatório o que difere, se algo diferir).

## Como o revisor verifica
1. `git diff --stat` só com os arquivos da Superfície. `git diff -- apps/desktop/src/renderer/src/features/email/EmailNav.tsx` mostra só as três mudanças do CA13 (tag de fora, `mt-4`, D1).
2. `grep -rn "useEffect" apps/desktop/src/renderer/src/app/SidebarStack.tsx apps/desktop/src/renderer/src/app/Sidebar.tsx`: nenhum efeito que copie a rota para um estado de nível (só o `rememberEmailPath`, o temporizador e o foco).
3. `grep -n "setTimeout\|SIDEBAR_SLIDE_FALLBACK_MS" apps/desktop/src/renderer/src/app/SidebarStack.tsx`: o temporizador de reserva existe e é cancelado no `animationend` e na troca seguinte; `matchMedia` lido na troca.
4. `grep -n "side-push\|side-pop\|side-stack" apps/desktop/src/renderer/src/design/base.css`: 4 keyframes, 4 classes, `.side-stack` e `.is-sliding`, todos com `var(--duration-slow)` e `var(--ease-out)`; nenhum literal de cor.
5. `grep -c "clickSelector(contents, '\[data-nav=" apps/desktop/src/main/smoke.ts` dá 0; `clickNav` e `showRoot` existem e são usados; `activeNav` lê `[data-nav][aria-current="page"]`.
6. `pnpm --filter @meeting-scribe/desktop test` passa, com `sidebar-stack.test.ts` cobrindo cada item do CA20.
7. `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde; no relatório do smoke, os checks novos do CA21 com `ok: true` e detalhe legível.
8. Abrir os 4 PNGs em `apps/desktop/out/smoke/` e comparar com o mockup: item Email entre Assistente e Automações, número à direita, cabeçalho com seta + ícone + "Email", marca e rodapé no mesmo lugar nos dois níveis.
9. No `pnpm --filter @meeting-scribe/desktop dev` (manual): Reuniões → Email desliza da direita; voltar → a raiz volta da esquerda com fade e a tela de email continua; com "Reduzir movimento" ligado no macOS, troca sem deslize.

## Relatório final (formato)
Arquivos tocados com uma linha cada; o que cada CA virou (arquivo e função); saída resumida do `pnpm gates`; nomes dos checks novos do smoke; os 4 prints e o que difere do mockup; qualquer passo do smoke que você mudou de lugar ou de seletor e por quê; o que ficou para o 66. Não commite.
