---
status: rascunho
feature: sidebar-pilha
data: 2026-11-19
semana: 2026-W47
---

# Spec: Sidebar em pilha (navegação em dois níveis)

> Rascunho de 19/11/2026, com o mockup `docs/specs/sidebar-pilha/mockups/SidebarPilha.dc.html`. Contratos em `docs/specs/sidebar-pilha/contracts/` (65 e 66).
>
> Decisões do mockup: D1–D7 nas opções recomendadas, 19/11/2026.
>
> Decisões do Andrew sobre as dúvidas do rascunho (19/11/2026): o foco vai ao cabeçalho-voltar só quando a entrada no nível vem de clique no próprio sidebar (⌘, e aviso de email não mexem no foco); as setas ↑/↓ entre as linhas de Configurações ficam de fora; o nome acessível do cabeçalho inclui o nome visível ("Email: voltar ao menu"); D5 mantido em 20/26.

## Problema e objetivo
O sidebar só cresce para baixo: os itens fixos, depois cada conta de email com as pastas dela, e o contrato 55 (email-organizacao) vai pôr ali a árvore inteira de pastas IMAP. Configurações tem 8 abas (9 com a aba Email do 55) numa fileira horizontal que já aperta na coluna de 760 px. O objetivo: navegação lateral em dois níveis, como os Ajustes do iOS. Um nível **raiz** com as seções do app e um nível **de seção**, só para Email e Configurações, que ocupa a coluna inteira do sidebar e tem no topo um cabeçalho que volta à raiz. A marca no topo e o rodapé (Bloquear, aviso de versão, permissões) ficam parados; só a coluna do meio desliza. A largura continua 224 px.

## Não-objetivos
- Mudar o conteúdo das telas de email (lista e leitura) ou de qualquer aba de Configurações.
- Terceiro nível, nível próprio para Automações ou WhatsApp, sidebar recolhível ou de largura ajustável.
- Atalho novo de teclado (nem para voltar), gesto de trackpad para voltar.
- Guardar o nível entre aberturas do app.

## O que existe hoje (conferido no código em 19/11/2026)
- `app/Sidebar.tsx`: os itens saem de `APP_ROUTES` com `nav` (Reuniões, Assistente, Automações, WhatsApp só com o serviço instalado, Configurações), `NavLink` de 40 px; logo abaixo vem `<EmailNav />`; no rodapé (`mt-auto`), `LockButton`, `UpdateNotice` e `PermissionsBlock`. O estado não passa pelo `Shell.tsx`: o sidebar já está dentro do roteador e lê a rota sozinho.
- `features/email/EmailNav.tsx`: `<nav aria-label="Email">` com `mt-4` e `overflow-y-auto`. Por conta, um botão de 40 px com a seta que recolhe (estado em `settings.emailCollapsed`) e, recolhida, o número de não lidas; aberta, "Caixa de Entrada" (com o número) e "Enviados", recuadas 32 px. Sem conta, não desenha nada.
- Não lidas: `unreadCount(folders[folderKey(conta, 'inbox')])` conta as mensagens não vistas da Caixa de Entrada **carregada na lista local**, não um número do servidor. `unreadBadge` mostra "999+" acima de 999 e nada em zero.
- Email: `ROUTE_PATHS.email` é o padrão do roteador `/email/:conta?/:pasta?`, não um caminho navegável. `/email` com conta abre a Caixa de Entrada da primeira. **Sem conta nenhuma, não há redirecionamento**: a tela de email mostra a nota "Nenhuma conta de email ainda. Adicione uma em Configurações › Contas › Email." com o link "Abrir Contas" (`settingsPath('contas')`).
- Configurações: `/configuracoes/:aba?`. Sem a aba, `SettingsScreen` redireciona para `lastSettingsTab()` (memória da sessão em `settingsTabs.ts`, padrão Geral); o item do sidebar já leva a `/configuracoes`. As abas são `Tabs` horizontais (`role="tablist"`) com ←, →, Home e End.
- Atalhos que já existem: ⌘, (menu do app, abre Configurações na última aba); com Configurações aberta, ⌘1 a ⌘8 trocam de aba e põem o foco na aba (`tabForShortcut` já aceita 1 a 9); ⌘F foca a busca de Configurações; Esc que limpa a busca devolve o foco à aba aberta; ⌘N nova gravação; ⌘⇧L bloquear.
- Navegação vinda do main: `scribe:navigate` (o menu manda `configuracoes`, `gravacao` e `automacoes`), `scribe:open-email` (Caixa de Entrada da conta com a mensagem aberta), `scribe:open-settings` (uma aba), `scribe:open-run`, `scribe:open-whatsapp`, `scribe:open-meeting`.
- Movimento: `tokens.css` desliga toda animação e transição com `prefers-reduced-motion` (`!important`). Não há deslize horizontal no app; `.route-enter` é só fade.

## Regras
- **R1. Nível raiz.** Itens, de cima para baixo: Reuniões, Assistente, **Email** (novo), Automações, WhatsApp (só com o serviço instalado, como hoje) e Configurações. Linhas de 40 px, ícone 16 e rótulo 13, no desenho de hoje. Email usa o ícone `Mail` (o mesmo da nota da tela de email). À direita do Email, o total de não lidas de todas as contas: a soma de `unreadCount` da Caixa de Entrada de cada conta, a mesma fonte do `EmailNav`, formatada por `unreadBadge` (12 px tabular, `--side-text`, com " não lidas" só para leitor de tela). O número some em zero e enquanto as contas não carregaram (D3). Sem conta configurada, o item continua, sem número, e leva a `/email`, que mostra a nota "Nenhuma conta de email ainda" com "Abrir Contas". Item ativo: Reuniões só em `/` (como hoje); Assistente, Automações e WhatsApp nas rotas deles; Email em qualquer `/email/*`; Configurações em qualquer `/configuracoes/*`. Gravação e detalhe da reunião não marcam item, como hoje.
- **R2. Só Email e Configurações têm nível próprio.** Automações e WhatsApp continuam itens planos; as listas internas deles ficam na tela. São dois níveis no máximo: nenhuma linha de um nível de seção abre outro nível (Conexões é uma linha que navega, não um terceiro nível).
- **R3. Nível Email.** Cabeçalho-voltar "Email" (R5) e, abaixo, o conteúdo que hoje é o `EmailNav`: as contas recolhíveis com Caixa de Entrada (não lidas) e Enviados. O nível rola sozinho, entre o cabeçalho e o rodapé, e ao aparecer traz a pasta aberta para a área visível. Com uma conta só, a linha da conta fica, sem a seta, e não recolhe (D1). Sem conta, abaixo do cabeçalho aparece só a frase "Nenhuma conta de email ainda." (12 px, `--side-muted`); o caminho para criar continua na nota da tela de email. Quando o contrato 55 entrar, a árvore de pastas dele (linhas de 30 px, clique direito, alvo de arrastar) aparece **neste nível**, no lugar do `EmailNav` de hoje; os itens principais não ficam mais visíveis acima das pastas.
- **R4. Nível Configurações.** Cabeçalho-voltar "Configurações" e uma linha por aba de `SETTINGS_TABS`, na ordem, com o rótulo de `SETTINGS_TAB_LABELS` (Geral, Gravação, Claude, Arquivos, Contas, Plugins, Conexões, Sobre; a aba Email do 55 entra sozinha, porque a lista sai de `SETTINGS_TABS`). Linha de 30 px, rótulo 13, sem ícone (D6), recuo de 32 px (o mesmo das pastas do email), a ativa com `--side-active` e `--side-text`, e o atalho à direita (D7). Clicar numa linha navega para `settingsPath(aba)`. As `Tabs` horizontais saem do `SettingsScreen`, que fica com o cabeçalho (título da aba à esquerda, D5, e a busca à direita, como hoje) e o conteúdo da aba. Durante uma busca, o título vira "Configurações" (os resultados são de todas as abas), a linha da aba aberta continua marcada no sidebar (a rota não muda) e os resultados ocupam o lugar do painel, como hoje. Os atalhos de hoje continuam valendo com o sidebar em qualquer nível: ⌘, abre Configurações; com Configurações aberta, ⌘1 a ⌘8 (⌘9 com a aba do 55) trocam de aba e põem o foco na linha da aba no sidebar; ⌘F foca a busca; Esc que limpa a busca devolve o foco à linha da aba aberta. As setas ←, →, Home e End eram da lista de abas e saem com ela; ↑ e ↓ entre as linhas não entram (decisão de 19/11/2026).
- **R5. Cabeçalho-voltar.** Primeira linha do nível de seção, 40 px, um `<button>` inteiro clicável: `ChevronLeft` 16 à esquerda, ícone da seção 16 (`Mail`, `Settings`) e o nome da seção ("Email", "Configurações") em 13 peso 500 `--side-text`; passar o mouse dá o fundo `--side-active`. Nome acessível com o nome visível na frente: `aria-label="Email: voltar ao menu"` e `aria-label="Configurações: voltar ao menu"`. Foco: quando o nível entra por clique (ou Enter) no item da raiz, no próprio sidebar, o foco vai para o cabeçalho; quando volta à raiz pelo cabeçalho, o foco vai para o item da seção na raiz. Quando o nível muda por uma navegação vinda de fora do sidebar (⌘, e outros itens de menu, aviso de email, `scribe:open-settings`, link na tela), o foco não se mexe; a única exceção é ⌘1 a ⌘8 do R4, que já movem o foco hoje.
- **R6. O nível é estado da UI, sincronizado com a rota num sentido só.**
  - Toda navegação para `/email/*` ou `/configuracoes/*` mostra o nível daquela seção, venha de clique, atalho, menu, aviso ou link. Toda navegação para outra rota mostra a raiz.
  - **Voltar não navega**: só mostra a raiz; a tela principal continua a mesma e o item da seção corrente fica marcado na raiz (D4). A próxima navegação, qualquer que seja, volta a valer a regra de cima.
  - Clicar em Email ou Configurações na raiz **estando já naquela seção** só mostra o nível, sem navegar. Estando em outra rota, navega para o último destino da seção: Email, o último `/email/<conta>/<pasta>` aberto nesta sessão, se a conta ainda existe, senão `/email` (Caixa de Entrada da primeira conta, ou a nota sem conta); Configurações, `/configuracoes`, que já abre a última aba vista na sessão (padrão Geral).
  - De um nível de seção direto para o outro (no nível Email, ⌘, abre Configurações): troca com o deslize de entrada, sem passar pela raiz.
  - O nível não é guardado: ao abrir a janela já numa rota de seção, o nível dela aparece de cara, sem animação.
- **R7. Animação.** Deslize horizontal em `--duration-slow` (180 ms) com `--ease-out`. Entrar num nível: o novo vem de `translateX(100%)` para 0 e o que sai vai de 0 para `translateX(-30%)` sumindo (opacidade 1 para 0) (D2). Voltar é o inverso: a raiz vem de `translateX(-30%)` com opacidade 0 para 0 com opacidade 1, e o nível de seção vai de 0 para `translateX(100%)`. A coluna do meio corta o que passa da borda (`overflow: hidden`) e ocupa os 224 px inteiros, para o deslize chegar à borda do sidebar e não parar no recuo de 12 px. Os dois níveis só existem juntos durante a transição; depois fica só o atual. O que sai fica `inert` e `aria-hidden`. Um clique no meio da transição termina a anterior na hora e começa a nova. Com `prefers-reduced-motion`, a troca é instantânea e o nível que sai nem chega a aparecer. Sem biblioteca: classes e keyframes em `design/base.css` com os tokens. É o primeiro deslize horizontal do app; o padrão vai para o `design.md` no fechamento.
- **R8. Acessibilidade.** Cada nível é um `<nav>` com o nome dele: "Navegação principal" (raiz, como hoje), "Email" e "Configurações". O item ou linha ativa tem `aria-current="page"`, como hoje. Seta, ícones e dica de atalho com `aria-hidden`. Foco visível branco sobre `--side-bg` (design.md). Toda ação tem caminho de teclado: Tab chega ao cabeçalho, às linhas e aos itens; Enter e Espaço acionam.

## Regras de negócio
- **N1. Nada muda fora da navegação.** Nenhum canal novo do main, nenhuma configuração nova gravada, nenhum dado novo lido. O nível e o "último destino do email" vivem só na memória da janela.
- **N2. Bloqueio.** Com o app bloqueado, nada muda em relação a hoje (o sidebar fica atrás da camada de bloqueio e o main não navega).
- **N3. Contas que saem.** Se a conta do último destino do email foi removida, o clique em Email vai para `/email`. `emailCollapsed` continua filtrado como hoje.

## Telas de impacto no usuário
1. **Sidebar em todas as telas**: entra o item Email na raiz, com o total de não lidas; as contas de email saem da raiz e vão para o nível Email; aparece o cabeçalho-voltar nos níveis de seção; o deslize ao entrar e sair.
2. **Email**: ganha o nível próprio no sidebar (contas, Caixa de Entrada, Enviados; depois do 55, a árvore de pastas). A tela de email em si não muda.
3. **Configurações**: as abas horizontais somem; as abas viram linhas no nível Configurações do sidebar; o topo da tela passa a ter o nome da aba aberta e a busca. O conteúdo de cada aba não muda.

Há telas: o mockup precisa do ok do Andrew antes do primeiro contrato de UI. Depois da implementação dá para gerar a apresentação do cliente com prints reais; perguntar antes de gerar.

## Relação com o contrato 55 (email-organizacao)
O 55 ainda é rascunho, no worktree `meeting-scribe-email-organizacao` (branch `email-organizacao`), e só começa depois dos commits do 53 e do 56. Ele foi escrito contra o sidebar de hoje (itens principais em cima, pastas embaixo, Configurações com Tabs). Com a pilha, **o 55 passa a ser escrito e ajustado contra a pilha**, já na main. CAs do rascunho afetados:
- **CA2 (árvore no sidebar, D1 e D2 do 55):** a árvore, as linhas de pasta de 30 px e a linha da conta de 40 px renderizam dentro do nível Email, no lugar do `EmailNav` de hoje, sem os itens principais acima. O recolhimento por subárvore (`emailFoldersCollapsed`) e o D1 desta spec (conta única sem seta) convivem.
- **CA3 (abrir qualquer pasta pelo sidebar):** a navegação para a pasta mantém o nível Email (R6); "último destino" passa a lembrar também as pastas que não são Entrada nem Enviados (o caminho que o CA1 do 55 define).
- **CA5 (arrastar mensagem para pasta do sidebar):** só há alvo com o nível Email à mostra. Na tela de email o nível já está à mostra (R6); se a pessoa voltou à raiz, não há alvo. Abrir o nível ao passar o arrasto sobre o item Email fica fora desta spec; o 55 decide se quer.
- **CA9 (clique direito na pasta, campo "Nova subpasta" dentro da árvore):** o menu e o campo ficam dentro de uma coluna que corta o que passa da borda durante a transição e rola na vertical; o 55 posiciona o menu fora da coluna (como já precisaria, por causa do `overflow-y-auto` de hoje).
- **CA14 (aba Email, ⌘1 a ⌘9):** a aba entra em `SETTINGS_TABS` e aparece sozinha como linha do nível Configurações, com "⌘6"; o 55 não recria Tabs e o título da tela é "Email". O link "Abrir Contas" da nota sem conta passa a `settingsPath('email')`.
- **CA23 e CA26 (busca e smoke):** os passos que conferem aba marcada por `[role="tab"]` passam a conferir a linha do sidebar (os seletores que o contrato 66 criar); os prints de sidebar do 55 já saem com a pilha.
- **CA24 (aviso de email movido por regra):** abre a pasta destino e, por R6, o nível Email, de qualquer nível.
- **Mockup do 55:** as telas 01 e 05 (sidebar com itens principais acima da árvore) e 09 a 12 (Configurações com Tabs) ficam valendo só pelo conteúdo; o sidebar e o topo de Configurações delas passam a ser os desta spec.

## Critérios de aceite
- **CA1. Raiz.** Na raiz, a ordem dos itens é Reuniões, Assistente, Email, Automações, (WhatsApp), Configurações, todos com 40 px de altura e `data-nav` com o id da rota (`email` no novo). Sem o serviço do WhatsApp, o item dele não aparece.
- **CA2. Número do Email.** Com 2 contas e 3 não lidas somadas nas Caixas de Entrada carregadas, o item Email mostra "3" e o leitor de tela lê "3 não lidas". Marcar a última não lida como lida faz o número sumir. Acima de 999, "999+".
- **CA3. Sem conta.** Sem conta de email, o item Email aparece sem número; o clique abre `/email` com a nota "Nenhuma conta de email ainda" e o nível Email com o cabeçalho e a frase "Nenhuma conta de email ainda.".
- **CA4. Entrar vindo de outra rota.** Em Reuniões, clicar Email abre o último `/email/<conta>/<pasta>` da sessão (ou a Caixa de Entrada da primeira conta na primeira vez) e mostra o nível Email; clicar Configurações abre a última aba vista (Geral na primeira vez) e mostra o nível Configurações.
- **CA5. Entrar estando na seção.** Na tela de email, depois de voltar à raiz, clicar Email mostra o nível sem navegar (a rota e a mensagem aberta não mudam). O mesmo para Configurações.
- **CA6. Voltar não navega.** No nível Email com uma mensagem aberta, o cabeçalho-voltar mostra a raiz; a rota, a lista e a mensagem aberta continuam; o item Email fica marcado com `aria-current="page"`.
- **CA7. Rota leva ao nível.** De qualquer nível: o clique num aviso de email (`scribe:open-email`) mostra o nível Email; ⌘, e `scribe:open-settings` mostram o nível Configurações com a aba certa marcada; `scribe:navigate` para `gravacao` ou `automacoes` mostra a raiz. Do nível Email, ⌘, troca direto para o nível Configurações.
- **CA8. Abrir já numa seção.** Recarregar a janela numa rota de email mostra o nível Email sem animação (nenhuma classe de deslize aplicada na primeira pintura).
- **CA9. Animação.** Entrar e voltar aplicam as classes de deslize com 180 ms e `--ease-out`; durante a transição há dois níveis no DOM e o que sai tem `inert` e `aria-hidden`; depois dela, um só. Dois cliques rápidos (entrar e voltar) terminam com um nível só no DOM, o certo.
- **CA10. Movimento reduzido.** Com `prefers-reduced-motion: reduce`, a troca de nível acontece sem animação e nunca há dois níveis no DOM.
- **CA11. Partes paradas.** Durante a transição, a marca e o rodapé (Bloquear, aviso de versão, Permissões) não mudam de posição (mesmo `getBoundingClientRect` antes, no meio e depois); a largura do sidebar continua 224 px.
- **CA12. Nível Email.** Mostra o cabeçalho e as contas como o `EmailNav` de hoje (recolher grava em `emailCollapsed`, Caixa de Entrada com não lidas, Enviados). Com contas que passam da altura, só o nível rola (cabeçalho e rodapé ficam). Ao aparecer, a pasta aberta fica visível. Com uma conta só, a linha da conta não tem seta e não recolhe.
- **CA13. Nível Configurações.** Mostra o cabeçalho e as 8 linhas na ordem de `SETTINGS_TABS`, 30 px cada, com a aba aberta marcada (`aria-current="page"`) e o atalho de cada uma (D7). Clicar numa linha navega para `settingsPath(aba)` e o painel dela aparece.
- **CA14. Configurações sem Tabs.** `SettingsScreen` não tem `role="tablist"`; o topo mostra o nome da aba aberta (D5) e a busca. Com a busca preenchida, o título é "Configurações", os resultados aparecem como hoje e o clique num resultado abre a linha com o destaque de 2 s. Âncoras (`settingsPath('gravacao', 'transcricao')`) e o foco pedido por `SettingsNavigationState` continuam funcionando.
- **CA15. Atalhos.** Com Configurações aberta e o sidebar na raiz, ⌘2 abre Gravação, mostra o nível Configurações e põe o foco na linha "Gravação"; ⌘8 abre Sobre; ⌘F foca a busca; Esc que limpa a busca põe o foco na linha da aba aberta. ⌘, de qualquer tela abre a última aba. Nenhum atalho novo.
- **CA16. Foco.** Clicar (ou Enter) em Email na raiz põe o foco no cabeçalho-voltar; acionar o cabeçalho põe o foco no item Email da raiz. Um aviso de email (`scribe:open-email`) ou ⌘, com o foco na tela não movem o foco para o sidebar.
- **CA17. Acessibilidade.** Raiz em `<nav aria-label="Navegação principal">`, níveis em `<nav aria-label="Email">` e `<nav aria-label="Configurações">`; cabeçalho com `aria-label="Email: voltar ao menu"` e `aria-label="Configurações: voltar ao menu"`; seta, ícones e dicas com `aria-hidden`.
- **CA18. Design.** Só tokens de `tokens.css` (gate 6), sem sombra, raio 4 (gate 7), ícones `lucide-react` pelo `Icon`, textos do mockup aprovado.
- **CA19. Testes de unidade** (Vitest, `test/renderer/`): seção de cada rota; nível mostrado com e sem "voltar" desde a última navegação; direção da troca (entrar, voltar, seção para seção, primeira pintura); último destino do email com conta que existe e com conta removida; soma das não lidas (zero, várias contas, conta sem lista carregada).
- **CA20. Smoke.** Os passos existentes continuam verdes (cliques em `[data-nav]` voltam à raiz antes quando preciso; os passos de Configurações usam as linhas do sidebar em vez de `[role="tab"]`), e passos novos conferem CA1, CA2, CA4 a CA7, CA9 a CA11, CA13 a CA15 e tiram os prints abaixo.
- **CA21. Docs.** `resources/assistente/guia-do-app.md` descreve a raiz, o item Email, os níveis e o voltar; "⌘1 a ⌘8: as abas de Configurações" passa a falar das linhas do sidebar.

## Prints exigidos
Do smoke, em claro e escuro, janela 1120×740:
- `sidebar-raiz-light`, `sidebar-raiz-dark`: raiz com o item Email e o número.
- `sidebar-email-light`, `sidebar-email-dark`: nível Email com duas contas, uma aberta.
- `sidebar-configuracoes-light`, `sidebar-configuracoes-dark`: nível Configurações com Conexões aberta e a tela sem Tabs.

O smoke grava os PNGs em `apps/desktop/out/smoke/<nome>.png` (`capture(win, ctx.outDir, nome)` em `apps/desktop/src/main/smoke.ts`). Na conta do servidor IMAP falso do smoke há 2 não lidas, então o número dos prints é "2" (o "3" do mockup é ilustrativo).

Os prints de Configurações que o smoke já tira (`configuracoes-*`) mudam de aparência (sem Tabs) e são conferidos de novo contra o mockup.

## Riscos
- **Conflito com o worktree `email-organizacao`.** O 55 reescreve `EmailNav.tsx` e mexe em `SettingsScreen.tsx`, `settingsTabs.ts`, `shared/routes.ts` e `main/smoke.ts`, os mesmos arquivos desta feature. Ordem recomendada: a pilha entra na main primeiro; a branch `email-organizacao` junta a main antes de começar o 55; o 55 é escrito contra a pilha. Para o conflito ficar pequeno, a pilha mexe no `EmailNav` só no mínimo (o espaço de cima e o D1); o resto da mudança fica no componente do nível.
- **Smoke.** Dezenas de passos clicam `[data-nav="..."]` supondo a raiz à mostra, e os de Configurações conferem `[role="tab"]` e a fileira de abas (inclusive "a fileira não se mexe ao rolar" e a seta →). Todos precisam do ajuste no mesmo contrato que muda o comportamento.
- **Movimento reduzido.** Com `prefers-reduced-motion`, `tokens.css` zera a animação e o fim dela nunca é anunciado; quem espera o fim da animação para tirar o nível que sai precisa de outro caminho (plan, T4).
- **Corte da coluna.** A coluna que corta o deslize pode cortar menus e campos que o 55 põe dentro da árvore (clique direito na pasta, nova subpasta). O corte vale só durante a transição (plan, T3) e o 55 posiciona os menus fora da coluna.
- **convites-agenda.** O contrato 63 põe o bloco "Convites" em Configurações (aba Email do 55, ou Contas antes); conflito pequeno no `SettingsScreen.tsx`, resolvido por quem entrar depois.
- **Descoberta.** Na raiz a pessoa não vê mais as contas; o número no item Email compensa. Se a pessoa sentir falta, é uma mudança de desenho, não de regra.

## Fora de escopo
- **F1** Terceiro nível em qualquer seção.
- **F2** Nível próprio para Automações e WhatsApp.
- **F3** Atalho de teclado para voltar e gesto de trackpad.
- **F4** Abrir o nível Email ao arrastar uma mensagem sobre o item Email (decisão do 55, se quiser).
- **F5** Guardar o nível ou o último destino do email entre aberturas do app.
- **F6** Qualquer mudança na lista, na leitura ou no Composer do email, e no conteúdo das abas de Configurações.

## Verificação end-to-end
1. `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos, com os 6 prints novos.
2. No `pnpm --filter @meeting-scribe/desktop dev`, com duas contas no servidor IMAP falso do smoke: na raiz, Email mostra o total de não lidas; clicar Email abre a Caixa de Entrada da primeira conta e o nível desliza da direita; abrir Enviados da segunda conta; voltar (a tela continua em Enviados, Email marcado); ir a Reuniões; clicar Email de novo abre os Enviados da segunda conta.
3. ⌘, em Reuniões: nível Configurações com a última aba; ⌘2 troca para Gravação com o foco na linha; voltar; ⌘8 abre Sobre e o nível volta.
4. Com "Reduzir movimento" ligado no macOS, os passos 2 e 3 trocam de nível sem deslize.
5. Teste navegado numa sessão nova (skill `relatorio-teste-navegado`), com os prints, só com o servidor de email falso; nenhuma IA envia email.
