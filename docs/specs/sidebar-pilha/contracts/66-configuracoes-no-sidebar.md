# Contrato 66: Configurações no sidebar (nível Configurações e a tela sem Tabs)
Feature: sidebar-pilha · Wave: 2 · Depende de: 65 · Spec: `docs/specs/sidebar-pilha/spec.md` (R2, R4, R5, R6, R8 na parte de Configurações) · Plan: `docs/specs/sidebar-pilha/plan.md` (T1, T5, T8, T9, T10) · Mockup: `docs/specs/sidebar-pilha/mockups/SidebarPilha.dc.html` (tela 03; a 03b mostra como é hoje)

O contrato 65 já fez a pilha do sidebar (raiz, nível Email, cabeçalho-voltar, deslize). Este contrato liga o **segundo nível de seção, Configurações**: as abas de Configurações saem da fileira horizontal do topo da tela e viram linhas no sidebar, e a tela fica só com o título da aba, a busca e o conteúdo. Este documento é tudo o que você precisa; a spec e o plan são só referência.

**Você não commita.** Termine com o relatório; quem coordena revisa e commita.

## Pré-condições
- Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-sidebar-pilha`, branch `sidebar-pilha`, com o contrato 65 revisado e commitado (`git log --oneline -3` mostra o commit do 65; `git status` sem mudança em `apps/`).
- Ler antes (caminhos a partir de `apps/desktop/`):
  - O que o 65 criou: `src/renderer/src/app/sidebarStack.ts` (`SidebarSection`, `sectionOf`, `levelFor`, `transitionOf`), `src/renderer/src/app/SidebarStack.tsx` (níveis, cabeçalho-voltar, transição, `focusOnEnter`), `src/renderer/src/app/Sidebar.tsx` (clique do item de seção na raiz), `test/renderer/sidebar-stack.test.ts`, e no `src/main/smoke.ts` os helpers `showRoot`, `clickNav`, `showEmailLevel`.
  - `src/renderer/src/features/settings/SettingsScreen.tsx` inteiro, `src/renderer/src/features/settings/settingsTabs.ts` (`SETTINGS_TAB_LABELS`, `lastSettingsTab`, `rememberSettingsTab`, `tabForShortcut`), `src/shared/routes.ts` (`SETTINGS_TABS`, `settingsPath`, `SETTINGS_ROUTE_PATTERN`, `SettingsNavigationState`), `src/renderer/src/design/PageHeader.tsx`, `src/renderer/src/design/Tabs.tsx` (só para saber o que sai; **não apagar**: outras telas usam), `src/renderer/src/design/Shortcut.tsx` (a dica de atalho do "Bloquear").
  - `src/main/smoke.ts`: `settingsTabIs` e `selectSettingsTab` (perto da linha 290), `layoutMetrics` (`navItemHeight`, perto da 3760), `settingsLayoutMetrics` (a conferência da fileira de abas que não se mexe ao rolar, perto da 3850, e o alinhamento do cabeçalho, perto da 3890), `settingsTabsChecks` (⌘2, ⌘8, seta →, ⌘F, "nenhuma aba marcada durante a busca", perto da 3923), `keyboardNavigation` (perto da 2872), `mcpChecks` (prints `configuracoes-conexoes-light`/`-dark`, perto das 6609 e 6812).
  - `resources/assistente/guia-do-app.md` (a frase "⌘1 a ⌘8 trocam de aba" na seção de Configurações e "⌘1 a ⌘8: as abas de Configurações" na lista de atalhos).
  - O mockup, tela 03 (e a 03b para comparar), aberto no navegador.

## Como é hoje (conferido em 19/11/2026)
- `/configuracoes/:aba?`. Sem a aba (o item do sidebar leva a `/configuracoes`; o ⌘, do menu também), o `SettingsScreen` redireciona para `lastSettingsTab()` (memória da sessão, padrão Geral). `rememberSettingsTab(tab)` roda a cada aba aberta.
- O topo da tela: `PageHeader` com o título "Configurações" (26/32) e a busca (`[data-settings-search]`, ⌘F foca); abaixo, `<Tabs ... label="Seções das configurações" id="settings">` (botões `role="tab"`, `data-tab`, ids `settings-tab-<aba>`, setas ←/→/Home/End).
- Os painéis de todas as abas ficam montados; só o da aba aberta aparece (`hidden` nos outros): `role="tabpanel"`, `id={tabPanelId('settings', aba)}`, `aria-labelledby={tabId(...)}`, `data-settings-panel={aba}`. Durante a busca, todos ficam `hidden`, a lista de resultados aparece e as Tabs ficam sem aba marcada.
- Teclado (só com a tela montada, um `keydown` em `window`): ⌘1 a ⌘8 (`tabForShortcut`, já aceita 1 a 9) navegam para a aba N e põem o foco na aba (`focusTabRef`); Esc que limpou a busca (`event.defaultPrevented` e havia texto) devolve o foco à aba aberta. Âncoras (`settingsPath('gravacao', 'transcricao')`) rolam até o bloco e `SettingsNavigationState.focus` foca um campo.
- Depois do 65: Configurações é item plano da raiz (sem nível), e `sectionOf` só conhece `email`.

## Superfície (caminhos a partir de `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/renderer/src/app/sidebarStack.ts` | `SidebarSection = 'email' \| 'configuracoes'`; `sectionOf` devolve `'configuracoes'` em `/configuracoes` e `/configuracoes/*` |
| `src/renderer/src/app/SidebarStack.tsx` | o nível Configurações (cabeçalho e linhas das abas) |
| `src/renderer/src/app/Sidebar.tsx` | o clique em Configurações na raiz segue a regra de seção (CA4, CA5) |
| `src/renderer/src/features/settings/SettingsScreen.tsx` | sai o `Tabs`; título da aba; painéis como região; foco de ⌘N e do Esc na linha do sidebar |
| `src/renderer/src/features/settings/settingsTabs.ts` | só comentários que citam "abas" no topo da tela (o código fica) |
| `src/renderer/src/design/PageHeader.tsx` | prop opcional `size?: 'page' \| 'section'` (padrão `'page'`, 26/32); `'section'` usa `text-20` (20/26, já existe na escala de `base.css`) |
| `src/main/smoke.ts` | passos de Configurações sem `[role="tab"]`; passos e prints novos (CA12) |
| `test/renderer/sidebar-stack.test.ts` | casos de `configuracoes` (CA11) |
| `resources/assistente/guia-do-app.md` | Configurações e a lista de atalhos (CA13) |

Não mexer: `design/Tabs.tsx` (continua, outras telas usam), `EmailNav.tsx`, `EmailScreen.tsx`, `Shell.tsx`, `useMainNavigation.ts`, o conteúdo de qualquer seção de Configurações (`*Section.tsx`, `SettingRow`, `settings-index.ts`), `tokens.css`, `base.css` (o deslize do 65 serve como está), nada em `src/main/` fora do `smoke.ts`, `docs/`.

## Ganchos de DOM (fixos)
- Nível: `<nav data-sidebar-level="configuracoes" aria-label="Configurações">` (com `data-sidebar-leaving`, `inert`, `aria-hidden` quando sai, como no 65).
- Cabeçalho: `<button type="button" data-sidebar-back aria-label="Configurações: voltar ao menu">`.
- Linha de aba: `data-settings-tab-link={aba}` no `NavLink`; a aba aberta com `aria-current="page"`.
- Tela: `data-settings-panel={aba}` em cada painel (já existe), `data-settings-search` (já existe), `data-settings-title` no `h1`.

## Critérios de aceite
Entre parênteses, o CA da spec que cada um cobre.

### Nível Configurações (tela 03)
- **CA1. Linhas (spec CA13, R4, D6, D7).** O nível tem o cabeçalho-voltar e uma linha por item de `SETTINGS_TABS`, na ordem, com o rótulo de `SETTINGS_TAB_LABELS` (hoje: Geral, Gravação, Claude, Arquivos, Contas, Plugins, Conexões, Sobre). A lista sai de `SETTINGS_TABS` por código, sem lista à parte: uma aba nova (a "Email" do contrato 55) aparece sozinha. Cada linha é um `NavLink` para `settingsPath(aba)`: 30 px de altura, rótulo 13 truncado, **sem ícone** (D6), recuo à esquerda de 32 px (o mesmo das pastas do email; `pl-8`) e 10 px à direita, raio `--radius-control`, `text-side-muted` com hover `text-side-text`, a ativa com `bg-side-active text-side-text` peso 500 e `aria-current="page"`. À direita, `<Shortcut keys={`⌘${n}`} />` (o mesmo componente do "⌘⇧L" do Bloquear) e `aria-keyshortcuts={`Meta+${n}`}` para as 9 primeiras (D7); da décima em diante, sem dica. Entre as linhas, 2 px (o `gap-0.5` dos itens).
- **CA2. Cabeçalho (R5, R8).** O mesmo cabeçalho-voltar do nível Email, com `Settings` 16 e "Configurações", e `aria-label="Configurações: voltar ao menu"`. Abaixo dele, 8 px até a primeira linha. Se as linhas não couberem, só elas rolam.
- **CA3. Clique numa linha (spec CA13).** Navega para `settingsPath(aba)`; o painel da aba aparece e a linha fica marcada. Não mexe no foco (o `NavLink` recebe o foco do clique, como qualquer link).

### Entrar e voltar (R6, com a mecânica do 65)
- **CA4. Entrar vindo de outra rota (spec CA4, parte Configurações).** Em Reuniões, clicar Configurações na raiz faz `preventDefault` e `navigate('/configuracoes')` (`ROUTE_PATHS.configuracoes`): o `SettingsScreen` já redireciona para a última aba vista na sessão (Geral na primeira vez) e o nível Configurações aparece com o deslize do 65. O foco vai para o `[data-sidebar-back]` (entrada por clique no sidebar).
- **CA5. Entrar estando na seção (spec CA5, parte Configurações).** Em Configurações, depois de voltar à raiz, clicar Configurações mostra o nível **sem navegar** (`setPoppedKey(null)`; rota e aba iguais).
- **CA6. Rota leva ao nível (spec CA7, parte Configurações).** De qualquer nível: ⌘, (`scribe:navigate` com `configuracoes`) e `scribe:open-settings` com uma aba mostram o nível Configurações com a aba certa marcada; do nível Email, ⌘, troca direto para o nível Configurações com o deslize de entrada (`transitionOf('email', 'configuracoes') === 'push'`), sem passar pela raiz. Nesses casos **o foco não se mexe** (decisão de 19/11/2026: só o clique no sidebar move o foco).
- **CA7. Voltar não navega (R6, D4).** Em Configurações › Conexões, o cabeçalho-voltar mostra a raiz; rota e painel continuam; `[data-nav="configuracoes"]` fica com `aria-current="page"` e recebe o foco.

### Tela sem Tabs (tela 03)
- **CA8. Cabeçalho da tela (spec CA14, D5).** O `SettingsScreen` não tem mais `Tabs` nem `role="tablist"` (tire o import de `Tabs`, `tabId`, `tabPanelId`, a constante `TABS` e o `TABS_ID`). O topo continua com o mesmo recuo e a mesma largura de coluna de hoje: à esquerda, `<h1 data-settings-title>` com `SETTINGS_TAB_LABELS[tab]` em 20/26 peso 700 `text-title` (`PageHeader` com `size="section"`); à direita, a busca, igual a hoje. Com a busca preenchida, o título é "Configurações". A faixa de baixo do cabeçalho (o fio `border-line` que ficava sob as Tabs) sai; o conteúdo começa logo abaixo do cabeçalho com o recuo de hoje do `[data-settings-scroll]`.
- **CA9. Painéis e busca (spec CA14).** Cada painel troca `role="tabpanel"`, `id` e `aria-labelledby` por `role="region"` e `aria-label={SETTINGS_TAB_LABELS[aba]}`, mantendo `data-settings-panel` e o `hidden` de hoje. A âncora (`location.hash`) passa a procurar o bloco em `[data-settings-panel="<aba>"]`. Busca, resultados, o clique num resultado (abre a linha com o destaque de 2 s), a nota "Esta opção aparece quando…", `SettingsNavigationState.focus`, `rememberSettingsTab` e o redirecionamento sem aba funcionam como hoje. Durante a busca, a linha da aba aberta continua marcada no sidebar (a rota não muda).
- **CA10. Atalhos (spec CA15).** Nada de atalho novo; as setas ←/→/Home/End saem com as Tabs e ↑/↓ **não** entram (decisão de 19/11/2026). Continuam valendo, com o sidebar em qualquer nível:
  - ⌘, de qualquer tela abre Configurações na última aba (menu do app; nada muda no main).
  - Com Configurações aberta, ⌘1 a ⌘8 (⌘9 quando houver 9 abas) abrem a aba N, mostram o nível Configurações se a raiz estava à mostra e põem o foco na linha da aba: `[data-sidebar-level="configuracoes"]:not([data-sidebar-leaving]) [data-settings-tab-link="<aba>"]` (no lugar do `document.getElementById(tabId(...))` de hoje, mesmo efeito do `focusTabRef`).
  - ⌘F foca a busca.
  - Esc que limpou a busca põe o foco na linha da aba aberta (mesmo seletor).

### Testes, smoke e docs
- **CA11. Testes de unidade (spec CA19, parte Configurações).** Em `test/renderer/sidebar-stack.test.ts`: `sectionOf('/configuracoes')` e `sectionOf('/configuracoes/conexoes')` → `'configuracoes'` (tire `/configuracoes/geral` da lista dos `null`); `levelFor` em `/configuracoes/geral` sem e com `poppedKey`; `transitionOf('email', 'configuracoes')` e `('configuracoes', 'email')` → `'push'`; `('configuracoes', 'root')` → `'pop'`. O `test/renderer/settings-tabs.test.ts` continua passando sem mudança.
- **CA12. Smoke (spec CA20, parte Configurações).** Em `src/main/smoke.ts`:
  - `settingsTabIs(tab)` passa a conferir `[data-settings-tab-link="${tab}"][aria-current="page"]` dentro do nível que não está saindo **e** `[data-settings-panel="${tab}"]` sem `hidden`; `selectSettingsTab` clica a linha (chamando `showSettingsLevel` antes: se o nível Configurações não está à mostra, `clickNav(contents, 'configuracoes')` e espera o nível).
  - `settingsLayoutMetrics`: a conferência "a fileira de abas não se mexe ao rolar" (`tabsShift`) vira "o cabeçalho (`[data-settings-title]`) não se mexe ao rolar"; no alinhamento do cabeçalho, troque o retângulo de `[role="tablist"]` pelo de `[data-settings-title]`.
  - `layoutMetrics` na tela de Configurações: `navItemHeight` mede `[data-sidebar-back]` (40 px), porque a raiz não está à mostra; nas outras telas, como hoje.
  - `settingsTabsChecks`: ⌘2 abre Gravação e o foco fica em `[data-settings-tab-link="gravacao"]` (troque o `activeTab` que lê `role="tab"`); ⌘8 abre Sobre; a seta → na lista de abas sai (as Tabs não existem mais) e entra no lugar: com a raiz à mostra (depois de `showRoot`), ⌘2 mostra o nível Configurações e foca a linha; "nenhuma aba marcada durante a busca" vira "durante a busca, `[data-settings-title]` diz 'Configurações' e a linha da aba aberta continua com `aria-current`".
  - `keyboardNavigation`: Tab até `[data-nav="configuracoes"]` e Enter agora mostram o nível Configurações; confira a rota `configuracoes`, `[data-sidebar-level="configuracoes"]` à mostra e o foco em `[data-sidebar-back]` (no lugar do `activeNav`).
  - Os 9 cliques em `[data-nav="configuracoes"]` já passam por `clickNav` (65); confira que os passos seguintes, que clicam outros itens, continuam voltando à raiz pelo `clickNav`.
  - Passos novos: CA1 (8 linhas na ordem de `SETTINGS_TABS`, 30 px cada, a aberta com `aria-current`, dica "⌘7" na linha Conexões), CA4 (Reuniões → clique em Configurações → última aba e nível à mostra, foco no cabeçalho), CA5, CA6 (`scribe:open-settings` com `conexoes` a partir da raiz e do nível Email; foco inalterado), CA7, CA8 (sem `[role="tablist"]` em `main`; `[data-settings-title]` com o nome da aba), CA9 (`settingsPath('gravacao', 'transcricao')` ainda rola até o bloco; um resultado da busca ainda destaca a linha).
  - Prints com `capture(win, ctx.outDir, nome)` (gravam em `apps/desktop/out/smoke/<nome>.png`), em `mcpChecks`, ao lado dos `configuracoes-conexoes-light`/`-dark` que já existem: `sidebar-configuracoes-light` e `sidebar-configuracoes-dark`, com Configurações › Conexões aberta e o nível Configurações à mostra, depois de `settle`. Os outros `configuracoes-*` que o smoke já tira mudam de aparência (sem Tabs): confira-os também.
- **CA13. Guia do app (spec CA21, parte Configurações).** Em `resources/assistente/guia-do-app.md`: a seção de Configurações diz que as abas ficam no nível Configurações da barra lateral (a seta no topo volta ao menu) e que a tela mostra o nome da aba e a busca; "⌘1 a ⌘8 trocam de aba" e "⌘1 a ⌘8: as abas de Configurações" continuam, dizendo que são as linhas da barra lateral; a seção "Barra lateral" (que o 65 reescreveu) ganha que Configurações também abre um nível.

## Invariantes
- O conteúdo de cada aba, a busca, o índice de busca (`settings-index.ts`), as âncoras e o destaque de 2 s ficam iguais. Nenhuma configuração muda de lugar.
- Nenhuma rota, canal de IPC, chave de settings ou atalho novo. `SETTINGS_TABS` não muda.
- O nível Email, o deslize, o temporizador de reserva e o movimento reduzido do 65 ficam como estão: o nível Configurações usa a mesma mecânica (com `prefers-reduced-motion`, o `tokens.css` zera a animação, o `animationend` não chega, e quem tira o nível que sai é o temporizador ou a troca instantânea do 65).
- Nenhuma biblioteca nova. `design/Tabs.tsx` continua no projeto.

## Fora de escopo
- Aba Email e as seções dela (contrato 55).
- `design.md`, `README.md` e o arquivamento da spec (fechamento da feature).
- Mudar o conteúdo de qualquer aba ou o `SettingRow`.

## Gates
- Na raiz do worktree: `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` (roda `bash apps/desktop/scripts/gates.sh`), verde nos 8 passos: `typecheck`, `lint` (`--max-warnings 0`), `test` (Vitest), `build`, `smoke`, literais de cor fora de `tokens.css`, `check-shapes.sh` (sem sombra, raio até 6, sem pílula) e o pytest do serviço do WhatsApp. Um passo só: `pnpm --filter @meeting-scribe/desktop typecheck` (ou `lint`, `test`, `smoke`).
- Os prints `sidebar-configuracoes-light`/`-dark` existem em `apps/desktop/out/smoke/` e foram conferidos por você contra a tela 03 do mockup, junto com os `configuracoes-*` que já existiam (no relatório, o que difere).

## Como o revisor verifica
1. `git diff --stat` só com os arquivos da Superfície; `git diff -- apps/desktop/src/renderer/src/design/Tabs.tsx` vazio.
2. `grep -n "Tabs\|tabId\|tabPanelId\|tablist\|tabpanel" apps/desktop/src/renderer/src/features/settings/SettingsScreen.tsx`: nenhum resultado.
3. `grep -n "SETTINGS_TABS" apps/desktop/src/renderer/src/app/SidebarStack.tsx`: as linhas saem de `SETTINGS_TABS` (nenhuma lista de abas escrita à mão).
4. `grep -n "voltar ao menu" apps/desktop/src/renderer/src/app/SidebarStack.tsx`: o nome acessível tem a seção na frente ("Configurações: voltar ao menu").
5. `grep -n 'role="tab"\|role=\\"tab' apps/desktop/src/main/smoke.ts`: sobram só os das abas da reunião e das Automações (nenhum de Configurações).
6. `pnpm --filter @meeting-scribe/desktop test` passa, com os casos do CA11.
7. `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde; os checks novos do CA12 com `ok: true` e detalhe legível.
8. Abrir `sidebar-configuracoes-light.png` e `-dark.png` e comparar com a tela 03: cabeçalho com seta + engrenagem + "Configurações", 8 linhas sem ícone com ⌘1 a ⌘8, Conexões marcada, título "Conexões" em 20 px à esquerda da busca, sem fileira de abas.
9. No `pnpm --filter @meeting-scribe/desktop dev` (manual): ⌘, em Reuniões abre a última aba com o nível; voltar; ⌘2 troca para Gravação, mostra o nível e foca a linha; no nível Email, ⌘, desliza direto para Configurações.

## Relatório final (formato)
Arquivos tocados com uma linha cada; o que cada CA virou (arquivo e função); saída resumida do `pnpm gates`; nomes dos checks novos e dos que mudaram no smoke, com o porquê; os 2 prints novos e o que difere do mockup; o que mudou de aparência nos `configuracoes-*`. Não commite.
