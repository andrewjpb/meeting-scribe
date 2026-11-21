---
tipo: inventario
feature: funil-vendas
data: 2026-11-20
semana: 2026-W47
base: main dd106ce (versão 0.19.0)
---

# Inventário do app para o módulo Funil de vendas

Levantamento feito em 20/11/2026 sobre a `main` em `fb0e62b` (0.18.0). Serve de âncora de repositório
para a spec, o plan e os contratos. Caminhos relativos a `apps/desktop/`.

> **Atualização 20/11/2026 18:45.** A main avançou para `dd106ce` (0.19.0) com o Instagram (contratos
> 69 a 77) mesclado: a seção `redes` já existe em `SIDEBAR_SECTIONS`, `routes.ts`, `routes.tsx` e
> `SidebarStack.tsx`, o item Redes fica entre Email e Automações, e o canvas tem 50 artboards. Os
> contratos **84 a 106** foram usados pela frente `arquitetura-seguranca` (`docs/specs/arquitetura-seguranca/`),
> então o **próximo número livre é 107**. Onde este arquivo citar "próximo livre 84" ou "worktree
> redes-instagram não juntada", vale esta nota. Confira `SCREENS` e `expectedShots` no `smoke.ts` atual.

## A. Navegação e telas

**Rotas** (`src/shared/routes.ts`): `RouteId` tem 8 valores: `reunioes '/'`, `assistente '/assistente'`,
`automacoes '/automacoes'`, `whatsapp '/whatsapp'`, `email '/email/:conta?/:pasta?'`, `gravacao '/gravacao'`,
`detalhe '/reunioes/:id'`, `configuracoes` (`SETTINGS_ROUTE_PATTERN = '/configuracoes/:aba?'`). Auxiliares
`emailPath()`, `emailFolderFromSlug()`, `meetingPath()`, `settingsPath()`. `SETTINGS_TABS` tem 9 abas
(`geral, gravacao, claude, arquivos, contas, email, plugins, conexoes, sobre`) e os atalhos ⌘1–⌘9 já estão
todos ocupados. Tipos de `state` de navegação: `WhatsAppNavigationState {chatId?, text?}`,
`EmailNavigationState`, `SettingsNavigationState`. `ROUTE_REDIRECTS` leva `/perguntar` para `/assistente`.

**Tabela de rotas** (`src/renderer/src/app/routes.tsx`): `APP_ROUTES: AppRoute[]` com
`{id, path, element, nav?: {label, icon: LucideIcon}}`. Comentário do arquivo: "Rota nova: id em
shared/routes.ts, linha aqui; com `nav`, aparece na barra lateral". Ordem da raiz da barra lateral
(ícones `lucide-react`): 1 Reuniões (`NotebookText`), 2 Assistente (`Sparkles`), 3 Email (`Mail`, badge de
não lidas), 4 Automações (`Bot`), 5 WhatsApp (`Smartphone`, só com o serviço instalado), 6 Configurações
(`Settings`). `gravacao` e `detalhe` não têm `nav`. Toda tela nova precisa do marcador
`<!-- tela: <routeId> -->` em `resources/assistente/guia-do-app.md`; `test/assistant.test.ts:784` reprova
se faltar.

**Barra lateral em pilha (dois níveis)**: `src/renderer/src/app/Sidebar.tsx` gera `NAV_ITEMS` a partir de
`APP_ROUTES`, filtra o WhatsApp, mostra badge `data-nav-badge`; item de seção chama `openSection()`.
`src/renderer/src/app/sidebarLevels.ts` (puro, testado em `test/renderer/sidebar-stack.test.ts`):
`SIDEBAR_SECTIONS = ['email','configuracoes','assistente']`, `sectionOf()` (um `matchPath` por seção),
`levelFor()`, `activeNavId()`, `transitionOf()`, `rememberEmailPath()`/`lastEmailPath()`.
`src/renderer/src/app/SidebarStack.tsx`: `LEVEL_LABELS`, `LEVEL_CLASSES` (`Record<SidebarLevel,…>`),
`switch` com `never` em `content()`, componentes `EmailLevel`, `SettingsLevel` (linhas `NavLink` de 28 px,
`tabLinkClass`), `AssistantLevel` (`ChatHistory`), `BackHeader`.

Para declarar um item novo com subitens: (1) id em `routes.ts`; (2) linha com `nav` em `routes.tsx`;
(3) id em `SIDEBAR_SECTIONS` e padrão em `sectionOf`; (4) caso em `LEVEL_LABELS`, `LEVEL_CLASSES` e
`content()`, mais um `XxxLevel`; (5) ramo em `openSection()` no `Sidebar.tsx`. Medidas em
`src/renderer/src/design/base.css:443`: `--side-row: 32px`, `--side-subrow: 28px`, `--side-indent: 28px`.

**Precedente direto (worktree não juntada)**: `~/Documents/GitHub/meeting-scribe-redes-instagram`
(contratos 69–77) acrescenta `RouteId 'redes'`, `ROUTE_PATHS.redes = '/redes/:conta?/:secao?'`,
`REDES_SECTIONS`, `redesPath()`, `SIDEBAR_SECTIONS += 'redes'`, item entre Email e Automações
(ícone `at-sign`). Contrato: `docs/specs/redes-instagram/contracts/72-tela-redes-e-nivel-no-sidebar.md`
naquela worktree. **Pode haver conflito na junção.**

**Shell**: `src/renderer/src/app/Shell.tsx` (barra lateral, `<main data-route>`, faixa arrastável de 52 px,
`CalendarBanner`, `<Routes>`; `routeKey` evita remontar Email e Configurações).
`src/renderer/src/app/useMainNavigation.ts`: eventos `scribe:navigate`, `scribe:open-run`,
`scribe:open-whatsapp`, `scribe:open-email`, `scribe:open-meeting`, `scribe:open-settings`.

**Pastas de `features/`** (`src/renderer/src/features/`):
- `meetings/`: `MeetingsScreen.tsx` (`PageHeader` "Reuniões" com `SearchField` e "Nova gravação" ⌘N;
  `FolderBar`, `DayGroups` de `MeetingRow`; `EmptyState` com `TapeIllustration`).
  `MeetingDetailScreen.tsx` (`MeetingHeader` com `EditableTitle` e `DeleteAction` que confirma na própria
  linha; `Tabs` Resumo, Anotações, Assistente, Transcrição, Áudio). `SummaryTab.tsx`, `NotesTab.tsx`,
  `OpenQuestionsSection.tsx`, `MeetingWhatsAppLink.tsx`.
- `chat/`: `ChatScreen.tsx` sem `PageHeader` (contrato 78); linha da conversa `ChatConversation.tsx:309`
  (`h-11`) com título, Escopo, Modelo e Contexto. `ContextPanel.tsx` à direita com `SourcesSection.tsx` e
  `WhatsAppScopeSection.tsx`. `ActionCards.tsx`, `EmailBatchCard.tsx`, `McpApprovalCard.tsx`,
  `ChatHistory.tsx`, `chatStore.ts`.
- `email/`: `EmailScreen.tsx` (lista de 340 px + `ReadingPane.tsx`), `Composer.tsx`, `OrganizePanel.tsx`,
  `ContextMenu.tsx`, `MoveToPicker.tsx`, `EmailNav.tsx`. Arrastar mensagem para pasta usa DnD nativo HTML5.
- `whatsapp/`: `WhatsAppScreen.tsx` (lista, `Conversation` com cabeçalho `h-11`, `DetailsPanel.tsx` de 300 px
  com `Charts.tsx` e `RiskPanel.tsx`).
- `agents/`: `AutomationsScreen.tsx` (`PageHeader` com "Pausar todas as tarefas", bloco `AskNow`, abas
  Agentes, Tarefas agendadas, Execuções). `AgentForm.tsx` e `../schedules/TaskForm.tsx` **substituem o
  conteúdo da aba**, não abrem modal.
- `schedules/`: `SchedulesTab.tsx`, `RunsTab.tsx`, `TaskForm.tsx`, `frequency.ts`.
- `settings/`: `SettingsScreen.tsx` (`PageHeader size="section"` + busca; painéis via `panel(tab, …)`,
  `Section`/`SettingRow` por bloco), `settingsTabs.ts`.
- Restantes: `live/`, `notes/`, `calendar/`, `permissions/`, `meeting-prompt/`.

**Padrões de interface**: ação primária no `actions` do `PageHeader`, à direita do título; não há toolbar.
Página `px-8 pt-5`, rolagem `px-8 pt-5 pb-8`; cabeçalho de painel 44 px (`h-11`). **Não existe diálogo nem
modal**: confirmação na própria linha e formulário no lugar do conteúdo. Diálogo nativo do Electron só no
envio do WhatsApp e ao fechar. **Não há biblioteca de kanban nem de arrastar**; DnD nativo HTML5 em
`features/settings/EmailRulesSection.tsx:203-383` (reordenar regras), `EmailScreen.tsx:478` e
`EmailNav.tsx:104-234` (mover email). Dependências: React 19, react-router 8, zustand 5, zod 4, Tailwind 4.

**Design system** (`src/renderer/src/design/`): `Button` (`primary`, `secondary`, `danger`; aceita `icon`,
`shortcut`, `action` = `data-action` para o smoke), `ActionButton` (28 px), `PageHeader`, `EmptyState`,
`TextField`, `Select`, `CONTROL_CLASS` (`Field.tsx`), `Tabs` (`tabId`, `tabPanelId`), `Segmented`, `Switch`,
`Section`, `SettingRow`, `Note`, `ScrollFade`, `EditableTitle`, `StickyNote`, `Icon`, `Shortcut`.
Tokens em `design/tokens.css`: cores `--bg`, `--line`, `--title`, `--accent`, `--rec`, `--live`, `--note-*`;
densidade `--control-h: 32`, `--row-h: 44`, `--row-compact-h: 32`, `--panel-head-h: 44`, `--page-x: 32`,
`--page-top: 20`; raios 4 e 6 px; `.label` (11/16) em `base.css`. Docs: `docs/specs/_archive/densidade/spec.md`
(tabela "A escala densa"), `docs/specs/desktop-shell/design.md`, `docs/telas/ds/lap-reunioes/`
(`tokens.json` via `pnpm tokens:export`, `components/*/README.md` + `preview.html`).

## B. Dados

Não existe auxiliar compartilhado de escrita atômica; cada store repete: fila
`let queue = Promise.resolve(); serial = task => queue.then(task, task)`; gravação em
`${file}.tmp-${pid}-${uuid}` + `rename`, `mode 0o600`; arquivo inválido vira `.corrupt-<stamp>`/`.invalid`.
**Melhor cópia para um store novo: `src/main/schedules/store.ts:50-62`** (`serialQueue()`, `atomicWrite()`).

| Store (`src/main/`) | Arquivo em userData | Esquema zod (`src/shared/`) |
|---|---|---|
| `meetings/store.ts` | `meetings.json` (`{version:1, meetings, folders?}`) | no próprio store; tipos em `meetings.ts` |
| `meetings/transcripts.ts`, `summaries.ts`, `analyses.ts`, `notes.ts` | `meetings/<id>.json`, `.summary.json`, `.analyses.json`, `.notes.json` | `meeting-summary-schema.ts`, `meeting-analysis-schema.ts`, `meeting-notes-schema.ts` |
| `agents/store.ts` | `agents.json` | `automations-schema.ts` |
| `schedules/store.ts` | `schedules.json`, `schedule-runs/<id>.json` (≤500) | `automations-schema.ts` |
| `chat/store.ts` | `chats/<id>.json` | local |
| `chat/events-store.ts` | `chat-events.json` | local |
| `settings/store.ts` | `settings.json` (inclui `emailAccounts`, `emailSignatures`, `emailRules`) | `main/settings/schema.ts` |
| `email/email-store.ts` | `email/<conta>.json`, `<conta>.bodies/`, `<conta>.folders/`, `<conta>.rules-state.json` (fila por conta) | local |
| `email/batches.ts`, `invites/store.ts` | `email/batches.json`, `email/invites.json` | local |
| `whatsapp/insights.ts` | `whatsapp/insights.json`, `whatsapp/links.json` | `whatsapp-insights-schema.ts` |
| `mcp/store.ts`, `lock/store.ts` | `mcp-servers.json`, `mcp-cli-enabled.json`, `lock.json` | locais |

**`Meeting.calendar`** (`src/shared/meetings.ts:9-27`, zod em `main/meetings/store.ts:25-33`):
`{ provider?: 'google'|'microsoft'; eventId?; title?; start?; end?; attendees: {name, email}[] (≤50, texto ≤200);
joinUrl?: string|null }`. `attendeeName()` em `shared/calendar.ts:163`.

**Email** (`src/shared/email.ts:94-130`): `EmailMessage {id, accountId, mailbox, uid, seen, flagged, answered,
from: EmailAddress[], to: EmailAddress[], cc: EmailAddress[], subject, date: number(ms), messageId, inReplyTo,
references}`; `EmailAddress {name: string|null; address}`; `EmailAccount {id, address, name, …}`. Corpo à parte
em `EmailBody {text, html, attachments, invite?}`.

**WhatsApp** (`src/shared/whatsapp.ts`): `WhatsAppChat {id ('5511…@s.whatsapp.net' | '…@g.us' | '@lid'),
name, kind: 'person'|'group', unread, lastMessage, phone?}`; `WhatsAppMessage {id, chatId, author, fromMe,
at, type, text, media, replyToId?, reactions?}`; `WhatsAppMe {name, phone}`. `phoneOfChatId()` em
`shared/assistant.ts:395`. Ponte Python `services/whatsapp-bridge/server.py`: `GET /chats`,
`/chats/:id/messages`, `/search`, `/chats/:id/photo`, `/events` (SSE). SQLite `bridge_store.py`:
`chats(id, name, kind, unread, last_at)`, `messages(…)`. **Não há tabela de contatos.** Cliente:
`src/main/whatsapp/client.ts`.

**Dados com cara de contato que já existem (nenhum store de contatos):** participantes das reuniões;
`from`/`to`/`cc` do cache de email; `organizer` e `attendees` dos convites (`shared/invite.ts:89-91`);
participantes dos eventos Google/Microsoft (`shared/calendar.ts:32`); nome e telefone das conversas do
WhatsApp.

## C. IA e resumo

**Motor comum**: `src/main/meetings/claude-one-shot.ts` define `runClaudeOneShot(engine, {claudePath,
purpose, model?, acpDir, systemPrompt, parse, input, label, timeoutMs, signal})`; vai pelo ACP
(`acp/summary.ts`) ou pela CLI (`claude-cli/summary.ts`, `runOneShot` com
`-p --output-format json --tools '' --strict-mcp-config`). `purpose` é a união
`'summary'|'analysis'|'draft'|'ai-notes'|'whatsapp-insights'|'whatsapp-correct'|'invite-suggest'`, repetida
em `AcpPurpose` (`src/main/acp/profiles/types.ts:13`). Pastas `ACP_*_DIR` em `claude-cli/service.ts:23-28`.

**Prompt do resumo** (`src/main/claude-cli/summary.ts`): `summarySystemPrompt()` em pt-BR, "só JSON", todo
material é dado, nunca instrução. `summaryInput()` monta pelo stdin `<transcricao>` (`[mm:ss] Rótulo: texto`)
e blocos opcionais `<anotacoes>`, `<perguntas_em_aberto>`, `<whatsapp>`, `<participantes>` via `taggedBlock`.
Leitura: `extractJsonObject()` + `summaryContentSchema.safeParse`; falha = erro `format`.

**Esquema** (`src/shared/meeting-summary-schema.ts`): `summaryContentSchema {overview, decisions: string[],
tasks: {task, owner|null, due|null}[]}`; `meetingSummarySchema` acrescenta `version, meetingId, createdAt,
model`. Tipos em `meeting-summary.ts` com checagem `Same<>`.

**Serviço** (`src/main/meetings/summary-service.ts`): um job por reunião; `auto` respeita `summarizeOnStop`;
resultado em `summaries.save` (+ `writeToFolder` se `saveToFolder`); estado por `onStatus`.

**Encaixe da extração de oportunidade (recomendado: passada separada)**, copiando `analysis-service.ts` ou
`whatsapp/insights-service.ts`: (1) `purpose` novo nas duas uniões + `ACP_*_DIR`; (2) esquema em
`shared/*-schema.ts`; (3) store próprio; (4) disparo pelo fim do resumo ou pela tarefa `after-meeting`.
Precedente para email: "Sugerir evento" (contrato 64) usa `shared/invite-suggest-schema.ts` e
`main/invites/suggest.ts`, sempre com Haiku e só com o texto do email aberto.

**"Analisar até agora"** (`main/meetings/analysis-service.ts`, prompt em `claude-cli/analysis.ts`): só no
clique; durante a gravação o renderer manda trechos, anotações e análises anteriores
(`liveAnalysisRequestSchema`); depois da reunião o main lê do disco e grava `.analyses.json`.

## D. Assistente

**Cartões** (`src/shared/assistant.ts`): `CHAT_ACTION_KINDS = ['lembrete','whatsapp-resposta','tarefa',
'abrir','emails','email-resposta','email-lote','evento','lembrete-editar','lembrete-apagar']`. Base
`{id, status: 'proposed'|'done'|'failed'|'dismissed', result}`. `ACTIONS_PER_MESSAGE_MAX = 6`;
`ACTION_FENCE = 'lap-acao'`, `TOOL_FENCE = 'lap-ferramenta'`. `OPEN_SCREENS = ['reuniao','reunioes',
'whatsapp','configuracoes','automacoes','gravacao']` (tela nova entra aqui e em `OpenCard`,
`ActionCards.tsx:351`).

**Proposta → cartão → clique**: (1) o modelo escreve ` ```lap-acao {json}``` `; tipos e exemplos em
`assistantSystemPrompt()` (`src/main/claude-cli/chat.ts:136-186`, exemplos 159-178). (2) validação em
`src/main/chat/actions.ts`: `proposedSchema` (`discriminatedUnion('tipo')`, l.93), `resolve()` (l.372, lê o
que o cartão mostra pelo app via `ActionResolver` l.118: `whatsappChat`, `agents`, `meeting`, `email`,
`calendar`, `tasks`…), `extractActions()` (l.483, bloco inválido vira texto), `actionsHistory()` (l.514).
(3) `chat/service.ts:546-555` chama `deps.assistant.extract`; ligação em `src/main/index.ts:1417-1418`.
(4) zod do cartão gravado em `chat/store.ts`. (5) clique: `createChatActions()` (l.664) expõe `reminder`,
`setState`, `event`, `reminderChange`, trava `busy`, exige `proposed`; canais
`scribe:chat-action-reminder|state|event|reminder-change` (`shared/ipc.ts:230-243`), todos `refused` com o
app bloqueado; `assistant.test.ts` fixa a lista. (6) renderer `features/chat/ActionCards.tsx`: um componente
por tipo escolhido em `ActionCard` (l.1151), ganchos `data-chat-action` e `data-action`; chamadas em
`chatStore.ts`; envio externo usa o token de clique do preload.

**Ferramentas sem MCP** (`src/main/chat/tools.ts`): bloco `lap-ferramenta {"ferramenta": …}`; o main roda
(só leitura), grava `.md` na pasta da conversa, devolve ao modelo, até `TOOL_ROUNDS_MAX = 4`.

**Fontes e painel Contexto** (`src/main/chat/sources.ts`): `writeSources(deps, folder, scope)` grava antes de
cada pergunta `ESTADO.md` (sempre), `GUIA-DO-APP.md`, `AUTOMACOES.md`, `CONVERSAS-WHATSAPP.md` +
`WhatsApp - <conversa> - <id>.md`, `EMAILS.md` + exports, `BUSCA-EMAILS.md`; cada fonte depende do
interruptor; gravação atômica só se mudou; `isSourceFile` apaga o que não vale mais. Nomes em
`SOURCE_FILES`, dependências em `AssistantSourcesDeps`. Interruptores: `CHAT_SOURCE_KINDS = ['whatsapp',
'email','automations','guide','internet']` e `chatSourcesOf()` em `src/shared/chat.ts:121-134`, gravados em
`ChatScope.sources` (só os desligados). Tela `features/chat/SourcesSection.tsx` com `SOURCE_TEXT`.

**Para uma fonte "funil"**: (1) kind em `CHAT_SOURCE_KINDS` e `chatSourcesOf`; (2) arquivo em `SOURCE_FILES`
e ramo em `writeSources`/`AssistantSourcesDeps`; (3) entrada em `SOURCE_TEXT` + `SourceRow`; (4) descrição
e regra de citação em `assistantSystemPrompt`; (5) tipos novos em `proposedSchema`, `resolve`,
`actionsHistory`, `ChatAction` e `ActionCards`; (6) canal `chat-action-*` novo.
Acervo `src/main/chat/corpus.ts`: `userData/chat-corpus/` (um `.md` por reunião + `INDICE.md`); pastas de
escopo `chat-scope/<id>` com hardlinks.

**ACP**: `src/main/acp/profiles/types.ts` define `AcpSessionRequest {purpose, cwd, model, systemPrompt,
tools: 'read'|'none'}`. Fonte nova não exige mudar o perfil; passada de extração nova exige `AcpPurpose` novo.

## E. Automações

Tipos em `src/shared/automations.ts` (zod `automations-schema.ts`): `Schedule = every | daily | weekly |
monthly | once | cron | after-meeting`; `ScheduledTask {agentId, message, schedule, timezone, runOnce, notify,
output, reminder: TaskReminder|null, email: TaskEmailPermission|null, …}`; `AGENT_OUTPUT_KINDS = ['chat',
'note','file','notification']`. Envio de email (contrato 51): `TaskEmailPermission {accountId, allow: string[]
(endereços ou @domínio), maxPerRun ≤20, grantedAt}` em `src/shared/task-email.ts`; ferramenta `enviar_email`
em `src/main/schedules/email-send.ts` (`recipientAllowed`, pausa, bloqueio); executor `schedules/runner.ts`.

Alerta "oportunidade parada há N dias": (1) **sem Claude**, tipo novo avaliado no tick de 30 s como
`dueReminders()` em `schedules/service.ts:561-594`, só notificação; (2) **tarefa de agente**, a pasta da
execução recebe um `FUNIL.md` (hoje o runner só recebe as reuniões do escopo) e envio opcional por email.

## F. IPC e Configurações

`src/shared/ipc.ts`: `InvokeChannels {canal: {request, response}}` (l.82), `RendererEvents`, `MainEvents`;
`INVOKE: Record<InvokeChannel,true>` (l.640) obriga listar todo canal; `WHEN_LOCKED: Record<…,
'allowed'|'session'|'refused'>` (l.930); `ScribeApi` (l.1200). Main: `src/main/ipc.ts` tem
`handle(channel, appOrigin, handler)` (origem + bloqueio), `onEvent`, `sendTo`, `broadcast`; chamadas em
`registerIpc()` de `main/index.ts:1899+` (arquivo com 2 557 linhas). Preload `src/preload/index.ts` expõe
`window.__scribeApi` e recusa canal fora de `INVOKE_CHANNELS`.

Configurações: padrões em `src/shared/settings-defaults.ts` (`DEFAULT_SETTINGS`, l.212); esquema
`main/settings/schema.ts` (tolerante por campo, estrito para o renderer); toda linha nova entra em
`settingsIndex()` de `shared/settings-index.ts` (o smoke confere); aba nova exige `SETTINGS_TABS`
(atalhos ⌘1–⌘9 esgotados), `SETTINGS_TAB_LABELS` em `settingsTabs.ts`, `panel('<aba>', <Section/>)` em
`SettingsScreen.tsx:~450-472` e `SETTINGS_LABELS` em `chat/actions.ts:139`. Alternativa: `Section` dentro de
uma aba existente.

## G. Importação e exportação

**Não há importação de CSV, vCard nem `.ics` por arquivo.** Diálogos nativos em `main/index.ts:1807-1878`
(pasta, plugin, salvar `.md`/áudio, imagem, anexo WhatsApp, anexos de email, salvar anexo); no smoke cada um
é trocado por fixture (`smokeFixtures`). `.ics` nos convites vem de parte MIME do email, lida em
`src/shared/invite.ts` (puro, `ical.js`, teto `INVITE_ICS_MAX_BYTES`); `main/invites/ics-file.ts` só grava
`.ics` temporário.

## H. Processo do repositório

**Spec** (modelo `docs/specs/assistente-agenda/spec.md`): frontmatter `status: em-aprovacao | aprovado |
arquivado`, `feature`, `data`, `semana`. Seções: `# Spec: …`, Problema e objetivo, Não-objetivos, O que existe
hoje (com arquivo e linha), Regras R1…Rn, Telas de impacto no usuário, Critérios de aceite CA1…CAn (os do
smoke citam checks e nomes de prints), Prints exigidos, Riscos, Fora de escopo, Verificação end-to-end.

**Plan** (`plan.md`): mesmo frontmatter; abertura com Spec, Mockup, Branch e worktree
`~/Documents/GitHub/meeting-scribe-<feature>` + base; Decisões técnicas numeradas; `## Grafo de tarefas` em
tabela `| Wave | Contrato | Entrega | Depende |`; `## Gates`; `## Fechamento` (revisor cego, uma devolução,
commit pelo agente, merge, build local, teste navegado, mover para `_archive`).

**Contrato** (modelo `docs/specs/assistente-agenda/contracts/78-assistente-agenda.md`): arquivo
`NN-slug.md`, título `# Contrato NN — Título`; abertura "Feature `x` · Wave N · Depende de: … · Spec
`../spec.md` (R…, CA…) · Plan · Mockup. **Você não commita.** Worktree …"; seções `## Pré-condições` (o que
ler, com arquivo e linha), `## Superfície` (subseções `###` por arquivo/camada; Smoke com checks, prints e
`expectedShots += N`; Testes unitários), `## Critérios de aceite`, `## Invariantes`, `## Fora de escopo`,
`## Gates`, `## Relatório final (formato)`. **Numeração global: maior usado é 83**
(`_archive/densidade/contracts/83-artefatos-e-fechamento.md`); 69–77 estão na worktree redes-instagram.
**Próximo livre: 84.**

**Mockups**: arquivos `*.dc.html` (`<x-dc>`, `<helmet>`, `<dc-import name="SidebarRaiz" ativo="…">`,
`support.js` do canvas de Artifact do claude.ai, fora do repo) em `docs/specs/<feature>/mockups/` (ex.:
`docs/specs/assistente-agenda/mockups/AssistenteAgenda.dc.html`, 5 artboards) e no canvas vivo
`docs/telas/artboards/` (43 artboards de 1120×740, barra lateral 224×740, `canvas.json` com `boards` e
`order`). Publicação e link em `docs/telas/README.md`. Mockups são renderizados com Chrome headless para
conferir com os prints do smoke.

**Gates**: `pnpm gates` → `apps/desktop/scripts/gates.sh`, para no primeiro erro. Uso típico:
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`. 8 passos: typecheck (node, preload, web), eslint
`--max-warnings 0`, vitest, build electron-vite, smoke, nenhum literal de cor fora de `tokens.css`,
`check-shapes.sh` (sem sombra, raio ≤6 px, sem pílula), pytest da ponte do WhatsApp.

## I. Testes

Vitest 5 (`vitest.config.mts`, `include: test/**/*.test.ts`, node, `maxWorkers: 4`, alias `@shared`).
Testes do main e do shared em `test/` (86 arquivos, `<domínio>[-store|-service].test.ts`); lógica pura do
renderer em `test/renderer/` sem DOM; falsos em `test/fixtures/` (`fake-acp-agent.mjs` responde por regex,
`fake-claude.mjs`, `fake-lap-calendar.mjs`). Smoke: `src/main/smoke.ts` (11 836 linhas) via
`scripts/smoke.mjs` com userData temporário; `SCREENS` (l.161) × `THEMES` geram `<nome>-light.png` e
`<nome>-dark.png` em `out/smoke/` + `report.json`; blocos usam `both(name)`; contagem conferida por
`expectedShots = SCREENS.length * THEMES.length + 149` (l.11739). Tela nova = entrada em `SCREENS` ou
`both()` dentro de um bloco com `+N` em `expectedShots`. Dados semeados em `src/main/smoke-fixtures.ts`.
