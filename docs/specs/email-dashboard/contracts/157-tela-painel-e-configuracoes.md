# Contrato 157 — Tela Painel, item na barra lateral, Composer pré-preenchido e Configurações
Feature: email-dashboard · Wave: 3 · Depende de: 155, 156 e **ok do Andrew no mockup** (gate humano) · Spec: `docs/specs/email-dashboard/spec.md` R10–R24 · Plan: D5, D6 · Mockup: `docs/specs/email-dashboard/mockups/EmailPainel.dc.html` (D1–D13; PNGs em `mockups/png/`)

Caminhos relativos a `apps/desktop/src`. Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md` (só tokens; raio 4 em controle e 6 em painel; nenhuma sombra, pílula ou modal; Button 32, ActionButton 28, Segmented 28; linhas 44/32/28; página `px-8 pt-5`).

## Pré-condições
- 155 e 156 commitados: canais `scribe:email-dashboard-get|run|ignore|opened|apply-move`, evento `scribe:email-dashboard-changed`, funções do preload `emailDashboard*`, tipos `EmailDashboardView` etc. em `shared/email-dashboard.ts`, rotas `emailPainelPath`/`isEmailPainelPath`, `EmailNavigationState.compose.replyTo/text`, settings `emailDashboard`.
- Mockup aprovado pelo Andrew. Abrir os PNGs `01`–`07` (claro) antes de codar; o desenho manda quando o texto deixar dúvida.
- Moldes (ler antes): `features/inicio/InicioScreen.tsx` + `inicioFormat.ts` (`INICIO_CARTAO_CLASS`, cabeçalho de cartão, duas colunas 380 + resto com gap 24 acima de 900 px de janela, botão Atualizar da spec `inicio-atualizar` se já estiver na main; senão `Button variant="secondary" icon={RefreshCw}`), `features/email/EmailNav.tsx` (linhas de 28 px de conta/pasta, seleção), `features/email/EmailScreen.tsx` (`compose`, `newMessage`, tratamento de `EmailNavigationState` ~`:413-422`, banner de Desfazer `:286,560` — no mockup chamado `OrganizeBanner`), `features/email/emailStore.ts` (`openDraft`, `move`, `undo`), `features/email/format.ts` (`composeFrom`), `features/tarefas/SugestoesTarefas.tsx` (Adicionar/Ignorar otimista), `features/settings/EmailSettingsTab.tsx` + `InvitesSection.tsx` (Section, SettingRow, switch, Segmented), `app/Sidebar.tsx:66`, `app/SidebarStack.tsx:66`, `app/useMainNavigation.ts:61`.

## Superfície

### `features/email/painelStore.ts` (novo; zustand como os demais)
- Estado: `view: EmailDashboardView | null`, `loading`, `error: string | null`, `expanded: Set<string>` (blocos de resposta abertos), `showAllReplies: boolean`, `lastBatch: { batchId; moved; folderName } | null`.
- Ações: `load()` (`emailDashboardGet`), `run()` (`emailDashboardRun`; se `started=false && running=true` só marca `view.running`), `ignore(accountId, messageKey, kind)` (remove a linha na hora e chama o IPC; em erro recarrega), `openReply(row)` (marca `opened` via `emailDashboardOpened` e navega — ver abaixo), `applyMove(accountId, folder, keys)` (IPC; guarda `lastBatch`; em erro mostra `error` em linha), `undoLast()` (`emailBatchUndo(batchId)` já existente, depois `load()`), assinatura de `onEmailDashboardChanged` → substitui `view`.
- Nenhum texto de e-mail vai para `console`/log.

### `features/email/PainelEmail.tsx` (novo) e componentes internos
- Montado por `EmailScreen` quando `isEmailPainelPath(pathname)` (antes do redirect para a primeira conta; sem conta, a tela "nenhuma conta" continua a atual).
- Cabeçalho (R12, D2): título "Painel"; subtítulo "Analisado às HH:MM · N e-mails · Haiku|Sonnet" | "Ainda não analisado" | (desligado) "Ainda não analisado · análise por IA desligada"; botão Analisar agora à direita, 32 px, `RefreshCw`, rótulo "Analisando…" e desabilitado enquanto `running`; desabilitado também com `enabled=false` (R9).
- Banner de Desfazer (R18, D11) entre o cabeçalho e as colunas quando `lastBatch` existe: reaproveitar o componente do banner da tela Email com o texto "N e-mails movidos para <pasta>", subtítulo "Pelo Painel, às HH:MM · <conta>", botão Desfazer e ×. Desfazer → `undoLast()`; × → limpa `lastBatch`.
- Colunas (R22, D8): janela ≥ 900 px → esquerda 380 px (contas + Precisam de atenção), direita o resto (Respostas sugeridas, Sugestões de organização) rolando sozinha; abaixo, uma coluna. `gap 24`.
- Contas (R13, D3): linha de 28 px por conta: ícone `Mail`, nome, à direita "N não lidos · N pendentes" (+ " · POP3"), em `--text-muted`, fio `--line` entre linhas.
- Linha de mensagem (D4), compartilhada pelos três cartões: 44 px, calha de 12 px à esquerda com quadrado 6×6 `--accent` quando `importance ≥ 4`; 1ª linha remetente (`--text`, 600) + " · conta" (`--text-muted`) e hora/dia à direita (mesma formatação de hora da lista de e-mail); 2ª linha assunto + " · motivo" em `--text-muted`, `truncate`. Clique na linha → `navigate(emailPath(accountId,'inbox'), { state: { messageId: messageKey } })` (R14; mesmo estado que o cartão `emails` do chat usa).
- Cartão **Precisam de atenção** (R14): cabeçalho com título e "N e-mails" à direita; até 15 linhas; vazio = linha de 32 px com `Check` em `--text-faint` e "Nada precisa de atenção" (D9).
- Cartão **Respostas sugeridas** (R15, D5, D6): blocos = linha de mensagem + resposta com filete de 2 px `--line-strong` à esquerda, `line-clamp-2` recolhida, inteira quando expandida; linha de 28 px com "Ver resposta"/"Ver menos" (link em `--accent`) à esquerda e à direita `ActionButton` **Abrir no Composer** (`Reply`) e **Ignorar**; se `opened`, "✓ Aberta" em `--text-muted` no lugar do primeiro botão, e a linha inteira do bloco continua levando ao Composer por "Abrir no Composer" acessível via clique na resposta. Mostra 3 blocos e "Mostrar mais N" (linha de 32 px) que expande o resto em linha; vazio = "Nenhuma resposta sugerida".
- **Abrir no Composer** (R16): `openReply` marca `opened` e navega para `emailPath(accountId,'inbox')` com `state.compose = { replyTo: { messageKey, mailbox: 'INBOX' }, text: reply }`. Em `EmailScreen`, o tratamento de `compose` ganha o ramo `replyTo`: localiza a mensagem no cache (`messages` da pasta ou `scribe:email-messages`), chama `compose('reply', message)` e, no rascunho gerado (`composeFrom` + assinatura, como hoje), coloca `text = reply + '\n\n' + rascunho.text` (resposta, linha em branco, assinatura, linha em branco, citação — D12). Mensagem ausente → nota em linha "Este e-mail saiu da Caixa de Entrada" (padrão das notas da tela) e nada abre. Nenhum envio automático; o botão Enviar do Composer segue igual.
- Cartão **Sugestões de organização** (R17, D7): grupos com cabeçalho de 32 px "Mover para <folderName> · <conta>" (ou "Arquivar · <conta>") e `ActionButton` **Mover todos (N)** (`FolderInput`); linhas de mensagem com, no lugar da hora, `ActionButton` **Mover** e **Ignorar**. Mover/Mover todos → `applyMove`; a linha/grupo some na hora e o banner aparece. Vazio = "Caixa de Entrada em ordem".
- IA desligada (R21, D10): sem os dois cartões da direita; no lugar, nota em linha no topo da coluna da direita: "Análise por IA desligada. Ligue em Configurações › Email para ver respostas e sugestões de organização." com link para `settingsPath('email')` (usar o helper de rota das Configurações). Precisam de atenção sem quadrado nem motivo.
- Erro de IPC (`error`): nota em linha abaixo do cabeçalho, texto fixo "Não foi possível carregar o Painel" ou "Não foi possível mover"; sem conteúdo de e-mail.

### `features/email/EmailNav.tsx` (R10, D1)
- Primeira linha do nível Email: **Painel**, ícone `LayoutDashboard`, 28 px, mesmo recuo das contas, selecionado quando `isEmailPainelPath`; fio em `--side-active` (ou o token que o nav usa para separador) entre o Painel e as contas.

### `app/Sidebar.tsx`, `app/SidebarStack.tsx`, `app/useMainNavigation.ts` (R11)
- Clique em Email: se já está numa rota `/email/*` que não é o Painel → vai ao Painel; se já está no Painel → vai a `lastEmailPath` (última pasta) quando existir; se está fora do Email → Painel (com pelo menos uma conta; sem conta, comportamento atual). A notificação `scribe:open-email` continua abrindo a pasta da mensagem.

### `features/settings/EmailPainelSection.tsx` (novo) + `EmailSettingsTab.tsx` (R23, R24, D13)
- Section "Painel" entre "Avisos" e Convites, descrição "O Painel fica no topo do Email. Ele sugere; nada é enviado nem movido sem o seu clique."; `SettingRow` "Analisar e-mails com IA" (switch `emailDashboard.enabled`, descrição como no mockup); `SettingRow` "Modelo" (Segmented 28 px Haiku | Sonnet → `emailDashboard.model`; desabilitado quando desligado); `SettingRow` "Última análise" com "Às HH:MM · N e-mails · US$ 0,00" (ou "Nunca") e `Button secondary` Analisar agora (`RefreshCw`; desabilitado quando desligado ou `running`). Lê a visão por `emailDashboardGet` e ouve `onEmailDashboardChanged`.

## Critérios de aceite
- CA1 Dado duas contas, quando clico em Email na barra lateral vindo do Início, então a rota é `/email/painel`, o item Painel está selecionado e as contas aparecem abaixo dele; clicando em Email de novo, a rota é `lastEmailPath`.
- CA2 Dado `view` com 8 itens de atenção (3 com importância ≥ 4), 5 respostas (1 `opened`) e 2 grupos de mover, quando o Painel renderiza (teste de componente com o store mockado), então há 8 linhas em Precisam de atenção com 3 quadrados, 3 blocos de resposta visíveis + "Mostrar mais 2", "Aberta" num bloco, 2 cabeçalhos de grupo com "Mover todos (N)" corretos.
- CA3 Dado o CA2, quando clico em "Ver resposta" do 1º bloco, então o texto completo aparece e o link vira "Ver menos"; os outros blocos continuam recolhidos.
- CA4 Dado o CA2, quando clico em "Abrir no Composer" do 2º bloco, então `emailDashboardOpened` é chamado com a conta e a chave, e a navegação vai para `/email/<conta>/entrada` com `state.compose.replyTo.messageKey` igual à chave e `state.compose.text` igual à resposta.
- CA5 Dado `EmailScreen` na Caixa de Entrada com a mensagem `k` no cache e `state.compose = {replyTo:{messageKey:'k', mailbox:'INBOX'}, text:'Olá, obrigado.'}`, quando a tela monta, então o Composer abre em modo responder com `inReplyTo` da mensagem, `to` igual ao remetente, assunto "Re: …" e `text` começando por "Olá, obrigado.\n\n" e contendo a citação depois; `emailSend` não é chamado. Com `messageKey` ausente do cache, a nota "Este e-mail saiu da Caixa de Entrada" aparece e o Composer não abre.
- CA6 Dado o CA2, quando clico em "Ignorar" de uma resposta, então a linha some imediatamente e `emailDashboardIgnore` é chamado com `kind:'reply'`; em Ignorar de uma linha de mover, `kind:'move'`.
- CA7 Dado o CA2, quando clico em "Mover todos (4)" do 1º grupo, então `emailDashboardApplyMove` é chamado com as 4 chaves e a pasta, o grupo some e o banner mostra "4 e-mails movidos para Newsletters" com Desfazer; clicar em Desfazer chama `emailBatchUndo(batchId)` e recarrega.
- CA8 Dado `enabled=false`, então o botão Analisar agora está desabilitado, a nota com o link para Configurações › Email aparece, só o cartão Precisam de atenção existe e nenhuma linha tem quadrado ou motivo.
- CA9 Dado `running=true`, então o botão mostra "Analisando…" desabilitado; ao chegar `onEmailDashboardChanged` com `running=false`, volta a "Analisar agora" e o subtítulo mostra "Analisado às HH:MM · N e-mails · Haiku".
- CA10 Dado a aba Email das Configurações, então a seção Painel está entre Avisos e Convites com switch, Segmented e Última análise; desligar o switch grava `emailDashboard.enabled=false` e desabilita Segmented e Analisar agora; escolher Sonnet grava `model:'sonnet'`.
- CA11 Dado cada cartão vazio, então aparece a linha de 32 px com o texto do R20 e o cartão não some.
- CA12 Nenhum componente novo usa cor fora dos tokens, `shadow`, `rounded-full`, raio acima de 6 px, `fixed`/portal de modal (teste estático por grep nos arquivos novos, como já existe no repo para outras telas, se existir; senão criar um simples).

## Invariantes
- Composer, envio, lista de pastas, regras, Organizar com o Assistente e o banner do agente não mudam de comportamento (testes existentes verdes).
- `scribe:open-email` continua abrindo a pasta da mensagem notificada.
- Nenhum texto de e-mail em `console`, log ou mensagem de erro.
- Sem alteração em `main/` além de nada (toda a lógica já está no 156); se faltar algo no main, relatar em vez de improvisar.

## Fora de escopo desta tarefa
- Checks e prints do smoke, docs, design.md, README (158). Início. Assistente.

## Gates
- Rápidos: `pnpm -C apps/desktop typecheck`, `lint`, `test`. **Ao final, o completo:** `pnpm gates` da raiz (build + smoke; tela do Mac desbloqueada; antes confira `pgrep -fl smoke` e espere se outro smoke estiver rodando; se falhar com "display surface not available for capture" é a tela, não o código). O smoke ainda não tem checks do Painel (158), mas precisa continuar verde com a tela nova montada.
- Testes novos: `test/renderer/painel-email.test.tsx` (CA2–CA4, CA6–CA9, CA11), `test/renderer/email-screen-compose-reply.test.tsx` (CA5), `test/renderer/email-painel-section.test.tsx` (CA10), navegação (CA1), estático (CA12).

## Relatório final (formato)
Arquivos; CA1–CA12 com ✔/✘ e o teste; gates com números (inclusive o smoke: PNGs e checks); decisões onde houve margem; o que do mockup não foi possível seguir.
