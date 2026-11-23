# Plan — notificacoes-triagem

Base: `6afc661` (0.23.1) · Spec: `spec.md` · Contratos 159–164 · Branch: main (sem worktree; a sessão do Painel de e-mail está no worktree `email-dashboard` e não toca os mesmos arquivos).

## Decisões técnicas
1. **Triagem executa por `runClaudeOneShot`, não pelo runner ACP** — o runner custa uma sessão completa e tem limite de 50/dia e 2 simultâneas; a triagem é uma passada de 30 s em Haiku, como `atendimento/reply.ts`. O agente das Automações dá instruções, modelo, pausa e Execuções; o motor fica em `main/whatsapp/triagem/`.
2. **Gatilho é a permissão** — `Schedule {kind:'whatsapp-message'}` dá ao agente a leitura da conversa que recebeu a mensagem, e só dela; nenhuma permissão nova no `Agent` (fora de escopo).
3. **Centro de notificações só no renderer** — lê os stores que o Shell já sincroniza (email folders `<conta>:inbox`, chats do WhatsApp); zero mudança em `main/email/*`. Rota plana `notificacoes` (sem flyout: o design não tem).
4. **Etiqueta com dois eixos** (`urgente` × `ambito`) em `userData/whatsapp/triagem.json`, molde de `atendimento/store.ts`; manual prevalece (`ambitoFixo`); `fromMe` limpa urgente.
5. **Um `AutomationRun` por triagem** com `trigger:'whatsapp'`, `prompt` sem texto de mensagem; fora do limite diário de 50; teto próprio de 300/dia.
6. **Cartões do Assistente** no padrão do contrato 153 (`lap-acao` → `main/chat/actions.ts` → `ActionCards.tsx` → `scribe:chat-action-triagem`), sem esperar o 153 ser implementado (arquivos diferentes, kinds diferentes).
7. **`contatoLigado` sai do renderer para `shared/funil-logic.ts`** para o main decidir "contato do funil".
8. Ícone `bell` (lucide) para Notificações; chips 20 px raio 4 com tokens (`--accent` para Urgente, `--muted` para âmbito); nenhuma cor nova.

## Grafo de tarefas
| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| 159 | Dados e tipos: `shared/triagem.ts` + schema, store `triagem.json`, `Schedule 'whatsapp-message'`, `RunTrigger 'whatsapp'`, `purpose 'whatsapp-triagem'`, modelo pronto em `EXAMPLE_AGENTS`, `contatoLigado` em shared, setting `whatsappTriagem` (defaults, 2 schemas, índice), canais em `shared/ipc.ts`, `RouteId 'notificacoes'`; testes | `shared/{triagem,triagem-schema,automations,ipc,routes,settings-defaults,settings-index,funil-logic}.ts`, `main/whatsapp/triagem/store.ts`, `main/settings/schema.ts`, `main/schedules/store.ts` (schema da schedule), `main/meetings/claude-one-shot.ts`, `renderer/features/funil/ContactLink.tsx` (import), `test/*` | — | 1 |
| 160 | Tela Notificações: rota, item da barra com badge, tela (segmentado, lista, vazio, marcar como lida, abrir), link no Início | `renderer/app/{routes,Sidebar}.tsx`, `renderer/features/notificacoes/*` (novo), `renderer/features/inicio/CartaoPendencias.tsx` | 159 (RouteId), mockup ok | 2 |
| 161 | Motor de triagem no main: `classify.ts` (one-shot), `service.ts` (debounce, fila, teto, aplicação, runs, `createTriagemFromTemplate`, unicidade da tarefa), IPC `scribe:triagem-*`, ligação no `onMessage` e no logout, leitura do interruptor; testes | `main/whatsapp/triagem/{classify,service,ipc}.ts`, `main/index.ts`, `main/whatsapp/service.ts` (limpeza), `main/schedules/service.ts` (consulta da tarefa ativa, run), `test/*` | 159 | 2 |
| 162 | WhatsApp e Automações: `triagemStore`, abas, chips, controles do cabeçalho, estado vazio com botão, gatilho no `TaskForm`/`frequency.ts`, rótulo "WhatsApp" na aba Execuções, interruptor na `SettingsScreen` | `renderer/features/whatsapp/{WhatsAppScreen.tsx,triagemStore.ts,TriagemTabs.tsx,EtiquetaChips.tsx}`, `renderer/features/schedules/{TaskForm.tsx,frequency.ts,RunsTab.tsx}`, `renderer/features/settings/SettingsScreen.tsx` | 161, mockup ok | 3 |
| 163 | Assistente: cartões `triagem-agente`, `triagem-etiqueta`, `abrir` estendido; fonte WhatsApp com etiqueta e cabeçalho; seção Triagem em `AUTOMACOES.md`; system prompt; testes | `shared/assistant.ts`, `main/chat/{actions,store,sources}.ts`, `main/claude-cli/chat.ts`, `main/whatsapp/export.ts`, `renderer/features/chat/ActionCards.tsx`, `main/index.ts` (handler), `test/*` | 161, mockup ok | 3 |
| 164 | Smoke (`triagemChecks` + 5 pares de telas em `SCREENS`), docs permanentes (README, guia do app, design.md, docs/telas), auditoria dos prints | `main/smoke.ts`, `main/smoke-fixtures.ts`, `README.md`, `apps/desktop/resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/*` | 160, 162, 163 | 4 |

Waves: 1 = {159}; 2 = {160, 161} (sem arquivo em comum: 160 só renderer, 161 só main); 3 = {162, 163} (162 toca `features/whatsapp|schedules|settings`; 163 toca `features/chat` + main/chat; `main/index.ts` só no 163 nesta wave); 4 = {164}. Teto de 2 agentes por wave; waves 2 e 3 em paralelo com um worktree por agente ou em sequência na árvore principal (decidir na hora pela carga: smoke e testes de tempo falham com a máquina carregada).

## Gates desta feature
- Por contrato: `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (rápidos); gate completo `pnpm gates` da raiz (8 passos, smoke ~25 min, tela do Mac desbloqueada, nada pesado em paralelo) ao fim de cada wave que toca UI e obrigatoriamente no 164.
- Gate 6 (literal de cor) e 7 (formas: sombra, raio > 6, pílula) valem para toda tela nova.
- Regra do `detail`: só números e booleanos; grep no smoke por texto das mensagens falsas deve dar zero.
