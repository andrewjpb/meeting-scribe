---
status: arquivado
arquivado_em: 2026-11-22
aprovado_em: 2026-11-22
feature: tarefas
tipo: plan
data: 2026-11-22
semana: 2026-W47
base: main 6ce57bd (versão 0.20.1, funil-vendas arquivado)
contratos: 121 a 129
---

# Plan: Tarefas ligadas a tudo

Spec `spec.md` (R1 a R37, CA1 a CA17) · PRD `prd.md` · Análise `analise.md` · Mockup `mockups/Tarefas.dc.html` (16 artboards numerados, PNGs em `mockups/png/`; os contratos citam número e nome; as escolhas de layout que viraram regra estão na seção "Alinhamento com o mockup" da spec) · Branch `tarefas` (base 6ce57bd). Caminhos de código relativos a `apps/desktop/`. Contratos numerados de **121 a 129**.

**Antes da wave 1.** `docs/specs/tarefas/` ainda não está no git (`?? docs/specs/tarefas/`): o agente de commits commita a pasta na `main` (ou direto na branch nova), depois `git branch tarefas` a partir da ponta. Os worktrees saem da `tarefas` (seção "Worktrees").

## Decisões técnicas

1. **D1. Store único `userData/tarefas.json`** em `src/main/tarefas/store.ts`, copiando o padrão de `src/main/funil/store.ts:72-87,186-273` (fila serial, temporário + `rename`, `mode 0o600`, cache em memória, `tarefas.json.corrupt-<stamp>` quando inválido, cópia diária `tarefas.json.bak-<AAAA-MM-DD>` com as 7 mais recentes). Limites: 5 000 tarefas, 50 eventos de histórico por tarefa (o mais antigo sai), 2 000 sugestões ignoradas. Porquê: o mesmo padrão já testado no funil, e um arquivo só deixa atômicas a migração e o "Adicionar as minhas".
2. **D2. Lógica pura em `src/shared/tarefas-*.ts`** (121): `tarefas.ts` (tipos e constantes), `tarefas-schema.ts` (zod do arquivo; o renderer não carrega zod), `tarefas-logic.ts` (derivados `vencida`, `deHoje`, `proximaDaOportunidade`, partição Vencidas/Hoje/Próximas/Sem prazo, `slugTexto`, `chaveSugestao`, lembrete padrão e recálculo, dono do resumo → responsável) e `tarefas-sugestoes.ts`. O gerador de `TAREFAS.md` fica em `src/main/tarefas/markdown.ts`. Porquê: CA1, CA5, CA8 e CA10 viram vitest sem Electron, e tela, `TAREFAS.md`, aviso "Hoje" e badge usam a mesma partição.
3. **D3. Serviço `src/main/tarefas/service.ts` com dependências injetadas** (122): store, `funil.state()`, `meetings.list()`, `summaries.get()`, `analysis.list()`, `insights.read()`, `whatsapp.chats()`, `settings()`, `timeZone()`, `notify`, `onChange`, `onOportunidade?`. Nunca abre arquivo de outro domínio; domínio desligado ou com falha vale vazio. Sugestões e nomes da view só nos canais que pedem; nenhum timer próprio.
4. **D4. IPC em `src/main/tarefas/ipc.ts` (`registerTarefasIpc`)**, os 8 canais da R37 com zod `.strict()` e `'refused'` em `WHEN_LOCKED`; eventos `scribe:tarefas-changed` (`TarefasView` inteira) e `scribe:open-tarefa` (`{ id: string | null }`, D7). `src/main/index.ts` recebe só blocos de ligação.
5. **D5. `useTarefas` zustand** em `features/tarefas/tarefasStore.ts` (122), carregado por `scribe:tarefas-get` e recarregado em `scribe:tarefas-changed` (padrão de `features/funil/funilStore.ts`). `TarefasView = { tarefas: Tarefa[]; hoje: 'AAAA-MM-DD'; nomes: { oportunidades; contatos; reunioes; whatsapp } }`: `hoje` vem do main no fuso do Mac, e os nomes da origem são resolvidos no main pelos caches (busca e coluna Origem da R3 sem uma ida ao main por linha).
6. **D6. Lembretes no tick de 30 s das Automações sem mexer em `schedules/service.ts`.** O `onTick` (`schedules/service.ts:128,602`) já existe: em `index.ts:1753` ele vira uma função composta que chama `tarefas.dispararLembretes(at)` (122) e o aviso "Hoje" (124). Notificação própria `showTarefaNotice` em `index.ts` (título "Tarefa", corpo = título, botão Abrir); bloqueado, o corpo vira "Você tem uma tarefa com lembrete" por uma função pura testável (`main/tarefas/lembretes.ts`). No smoke, a notificação vai para `smokeFixtures.tarefas.notifications` (com `open()`), separada das notificações das Automações. Na virada do dia (primeiro tick com data local nova), o serviço reemite `scribe:tarefas-changed` (R12).
7. **D7. "Abrir" das notificações por um evento novo `scribe:open-tarefa { id: string | null }`** (122 declara e manda; 123 escuta em `app/useMainNavigation.ts`). Porquê: `scribe:navigate` só leva `RouteId` e a rota `tarefas` nasce na wave 3. Bloqueado, o **main** guarda o destino pendente (`createDestinoPendente`, `main/tarefas/lembretes.ts`, 122) e reemite o evento quando `applyLockStatus` passa a desbloqueado; o renderer só consome, já desbloqueado (R12). O aviso "Hoje" (124) usa o mesmo caminho com `id: null`.
8. **D8. Próximo passo derivado sem dependência circular.** O serviço do funil recebe `tarefas: { todas(): Promise<Tarefa[]>; criar(input): Promise<TarefasActionResult> }` e ganha `notificarTarefas()`, que reemite `scribe:funil-changed`; o serviço de tarefas recebe `onOportunidade(evento)`, que chama `funil.registrarTarefa(evento)`. Os dois lados são closures em `index.ts`, resolvidas na hora da chamada (nenhum chama o outro no construtor). O `onChange` das tarefas em `index.ts` faz `broadcast('scribe:tarefas-changed')` e `void funil.notificarTarefas()` (124).
9. **D9. `FunilView.proximosPassos: Record<oportunidadeId, { texto; data; tarefaId } | null>`** (124), uma chave por oportunidade aberta e não arquivada (`null` sem tarefa aberta). `Oportunidade.proximoPasso` fica **opcional e legado** no tipo e no esquema (só a migração lê; o store nunca mais grava). `OportunidadeInput.proximoPasso` continua aceito: o serviço do funil grava a oportunidade e cria a tarefa ligada. Porquê: aplicar proposta (`funil/apply-proposal.ts:135,153`), o cartão `oportunidade-criar` e o `oportunidade-proximo-passo` (`chat/actions.ts:1317-1377`) passam pelo serviço e seguem funcionando sem mudar; e a fixture do smoke (`smoke-fixtures.ts:707-711`) segue compilando e vira o caso de migração.
10. **D10. Evento do funil da tarefa.** `EventoFunilTipo` ganha `'tarefa'` e `EventoFunil.tarefa?: { id; acao: 'criada' | 'feita' | 'prazo' }`; `registrarTarefa` grava o evento e põe `atualizadoEm = at`, que já conta em `ultimaInteracao` (`shared/funil-logic.ts:101-117`), cumprindo a R10 sem mudar a regra de "esfriou". Linha do tempo: na oportunidade, os eventos `tarefa` viram `ItemLinhaDoTempo` `tarefa`; no contato, os itens saem das tarefas com o contato nos vínculos (criada e feita).
11. **D11. Migração R35** em `src/main/tarefas/migracao.ts` (121, dependências injetadas, testada com falsos); adaptadores nos stores de cada domínio (124: `funil/store.ts` `legado`/`backupMigracao`/`limparLegado`/`restaurarMigracao`; `schedules/store.ts` `lembretes`/`backupMigracao`/`removerLembretes`/`restaurarMigracao`). Gatilho: `migradoEm === null` (arquivo ausente ou nunca migrado). Ordem: lê tudo → monta as tarefas → cópias `funil.json.bak-tarefas-<dia>` e `schedules.json.bak-tarefas-<dia>` → grava `tarefas.json` (anexando às existentes, com `migradoEm`) → tira os lembretes de `schedules.json` → tira `proximoPasso` de `funil.json`. Falha depois da gravação: desfaz (`tarefas.json` volta ao conteúdo anterior, os outros dois voltam das cópias), loga sem título e o app segue. No boot, `await services.migrarTarefas()` logo depois de `createAppServices` (`index.ts:2663`) e antes de `services.lock.init()`/`registerIpc` (`:2671-2672`) e de `automations.start()` (`:2755`). Ligado no 124, junto com a troca do funil para o derivado (D9), para o kanban nunca ficar sem passo.
12. **D12. Aviso "Hoje"** em `src/main/tarefas/hoje.ts` (124), substituindo `src/main/funil/alerts.ts` (removido com `test/funil-alerts.test.ts`). Um por dia a partir de `tarefas.horaLembrete`, com `ultimoAvisoHojeEm` em `tarefas.json`; o `ultimoAvisoEm` de `funil.json` fica no arquivo, sem uso.
13. **D13. `SummaryTask.dueIso` sem quebrar resumos antigos** (121): no esquema, `dueIso` é opcional e passa por `preprocess` (texto fora de `AAAA-MM-DD` válido vira `null`, nunca reprova o resumo); o tipo ganha `dueIso?: string | null`. O pedido (`claude-cli/summary.ts:135-154`) ganha o bloco `<data_da_reuniao>AAAA-MM-DD (dia da semana)</data_da_reuniao>`, passado por `meetings/summary-service.ts:153`, e o prompt (`:62`) explica o campo.
14. **D14. Canal único `scribe:chat-action-tarefa`** `{ chatId, index, actionId, campos? }` (127) executa `tarefa-criar`, `tarefa-concluir` e `tarefa-adiar` pelo `kind` gravado, como o `scribe:chat-action-funil` (`shared/ipc.ts:283`). `campos` só no criar (oportunidade/contato escolhidos no `SearchPicker` quando a resolução por nome foi ambígua).
15. **D15. Renomear `tarefa` → `agendamento` e "Tarefas agendadas" → "Agendamentos"** (128, wave 1): `CHAT_ACTION_KINDS`, `proposedSchema` (só o nome novo), prompt, `ActionCards`, textos da tela, do guia, de `AUTOMACOES.md` e das fontes. O `chat/store.ts` lê o `kind: 'tarefa'` gravado e o devolve como `agendamento` (cartão antigo renderiza). O id interno da aba (`AUTOMATIONS_TABS` `'tarefas'`) e o tipo `ScheduledTask` não mudam; o "Abrir" aceita o alvo `agendamentos` como sinônimo da aba.
16. **D16. `TarefasSettings` em `settings-defaults`/`schema`** e Section **Tarefas** em Configurações › Geral, abaixo de `FunilSection` (`SettingsScreen.tsx:313`) (128, wave 1). Porquê: `SETTINGS_TABS` tem 9 abas e ⌘1 a ⌘9 estão ocupados (como o D10 do funil).
17. **D17. Smoke.** `SCREENS` ganha `'tarefas-hoje'` (123; o nome do print exigido, ver D-1). `tarefas.json` semeado pelo 123 em `smoke-fixtures.ts` com `migradoEm: null` (a migração anexa as do funil depois do 124); o lembrete legado em `schedules.json` é semeado pelo 125, que faz o check de CA1. Checks novos medem por id e calculam contagens da view (nunca um número fixo que mude quando outra wave somar tarefas). Todo `detail` novo só com números e booleanos. Dono do `smoke.ts` por wave na tabela abaixo; `expectedShots` termina em `SCREENS.length * THEMES.length + 222`.
18. **D18. Componentes de tarefa compartilhados** criados no 123 em `features/tarefas/` (`TarefaLinha.tsx`, `NovaTarefaInline.tsx`, `tarefasFormat.ts`) e reusados (só importados) pelo 125 e pelo 126. O `SearchPicker` do funil (`features/funil/SearchPicker.tsx:33`) é importado, nunca editado. O "Vincular reunião" do detalhe da tarefa é próprio (o do funil é código em linha de `OportunidadeScreen.tsx:549-571`, que o 124 mexe na mesma wave).
19. **D19. ⌘⇧T** (livre: `main/menu.ts` só usa ⌘, ⌘N e ⌘⇧L; nenhum renderer ouve `KeyT`): ouvinte global no renderer em `app/Shell.tsx` (123), como o atalho de bloqueio (`app/lockStore.ts:101`).
20. **D20. "Pode ler as tarefas" dividido**: o campo `Agent.tarefas`, o Switch no `AgentForm` e o modelo "Minhas tarefas" são do 128 (wave 1, artboard 14); o runner (124) só usa o campo, pelo mesmo caminho do "Pode ler o funil" (`schedules/runner.ts:14-15,47-48,106-123`: pasta própria da execução, arquivo 0600 apagado no fim); o smoke do "Pedir agora" fica com o 127, como o 117 fez para o 115.
21. **D21. Um gerador só de `TAREFAS.md`** (121), usado pela fonte do Assistente (127) e pelas execuções de agente (124).
22. **D22. Nada entra sem clique.** Nenhum caminho automático cria tarefa: sugestões são calculadas sob demanda; a migração só converte o que já existia.

### Redistribuição dos contratos (em relação à análise)

A análise propunha 121 dados · 122 serviço e aviso Hoje · 123 tela · 124 funil · 125 reunião · 126 e-mail e WhatsApp · 127 Assistente · 128 Automações e configurações · 129 fechamento. Mantidos 9, redistribuídos pela colisão de arquivos e pelo dono do smoke (só um contrato por wave edita `smoke.ts`, e quase todo contrato de tela precisa dele):

- **128 sobe para a wave 1** (configurações, todo o vocabulário "Agendamentos", o cartão `agendamento`, os rótulos do funil e o campo e o Switch "Pode ler as tarefas", que o artboard 14 cobre): não depende de nada e é o dono do smoke ao lado do 121, que é só vitest.
- **`dueIso` (R21) e a lógica das sugestões (R26) entram no 121** (dados e lógica pura), para o 122 e o 126 só consumirem.
- **O funil vira dois contratos**: **124** (main: derivado, migração no boot, `FUNIL.md`, eventos, dados da linha do tempo, aviso "Hoje" e `TAREFAS.md` no runner; só vitest, roda ao lado do 123) e **125** (telas do funil). O aviso "Hoje" sai do 122 para o 124 porque substitui `funil/alerts.ts`, que o 124 já mexe.
- **126 junta Reunião, E-mail e WhatsApp** (as telas existentes, como o 116 do funil), num smoke só.
- **127** fica com o Assistente (fonte, cartões, lembrete → tarefa, Agendamentos sem lembretes) e o smoke do "Pode ler as tarefas".

### Artboards do mockup `mockups/Tarefas.dc.html` (pelo nome da tela)

| Artboard | Contrato |
|---|---|
| 01 Barra lateral (raiz) com Tarefas e o contador de vencidas | 123 |
| 02 Tarefas › Hoje · 03 Tarefas › Todas agrupadas por Oportunidade · 04 Tarefas › detalhe ao lado · 05 Tarefas › Nova tarefa em linha · 06 Tarefas › Sugestões · 07 Tarefas › vazia ("Nada para hoje") | 123 |
| 08 Funil › Oportunidade com a seção Tarefas · 09 Funil › ficha do contato com Tarefas · 16 Funil › kanban com a próxima tarefa e "Sem tarefa" | 125 |
| 10 Reunião › Resumo com Adicionar e o estado da tarefa · 11 Email › leitura com + Tarefa · 12 WhatsApp › Detalhes com + Tarefa | 126 |
| 13 Assistente com o cartão `tarefa-criar` e a citação | 127 |
| 14 Automações › Agendamentos e Pode ler as tarefas · 15 Configurações › Geral › Tarefas | 128 |

Não desenhados (seguem o vizinho): ficha da empresa com Tarefas (125, vizinho 09); cartões `tarefa-concluir` e `tarefa-adiar` (127, vizinho 13); notificações "Tarefa" e "Hoje" (122/124, texto da spec). Nenhum contrato de tela começa sem o artboard dele aprovado pelo Andrew.

## Grafo de tarefas

| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| **121** | Dados, store, lógica pura, sugestões, migração (função), `TAREFAS.md`, `dueIso` | `src/shared/tarefas.ts`, `src/shared/tarefas-schema.ts`, `src/shared/tarefas-logic.ts`, `src/shared/tarefas-sugestoes.ts`, `src/main/tarefas/{store,migracao,markdown}.ts` (novos), `src/shared/meeting-summary.ts`, `src/shared/meeting-summary-schema.ts`, `src/main/claude-cli/summary.ts`, `src/main/meetings/summary-service.ts`, `test/tarefas-{store,logic,sugestoes,migracao,markdown}.test.ts`, `test/meeting-summary.test.ts` | — | 1 |
| **128** | Configurações › Tarefas, "Agendamentos" (todo o vocabulário), cartão `agendamento`, rótulos do funil, campo e Switch "Pode ler as tarefas" | `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `src/shared/settings-index.ts`, `features/settings/{SettingsScreen,TarefasSection,FunilSection}.tsx`, `features/agents/{AutomationsScreen,AgentForm}.tsx`, `features/agents/automationsStore.ts` (comentário), `features/schedules/{SchedulesTab,TaskForm,RunsTab}.tsx`, `features/chat/{ActionCards,SourcesSection}.tsx`, `app/routes.tsx` (comentário `:38`), `src/shared/{assistant,automations,automations-schema}.ts`, `src/main/chat/{actions,store,sources,corpus}.ts`, `src/main/claude-cli/chat.ts`, `src/main/tray/menu.ts`, `src/main/schedules/service.ts` (texto `:589`), `src/main/index.ts` (texto `:380`), `resources/assistente/guia-do-app.md`, `src/main/smoke.ts`, `test/{settings-store,assistant,chat,automations-service,tray-automations}.test.ts` | artboards 14 e 15 | 1 |
| **122** | Serviço, IPC, lembretes, sugestões, "Adicionar do resumo", store do renderer | `src/main/tarefas/{service,ipc,lembretes}.ts` (novos), `src/shared/tarefas.ts` (acréscimos), `src/shared/ipc.ts`, `src/main/index.ts`, `src/main/smoke-fixtures.ts` (só o tipo e o array de notificações), `features/tarefas/tarefasStore.ts` (novo), `test/tarefas-service.test.ts`, `test/tarefas-ipc.test.ts`, `test/lock-ipc.test.ts` (verde) | 121, 128 | 2 |
| **123** | Tela Tarefas, item da barra, ⌘⇧T, "Abrir" | `src/shared/routes.ts`, `app/{routes.tsx,Sidebar.tsx,useMainNavigation.ts,Shell.tsx}`, `features/tarefas/{TarefasScreen,TarefaLinha,NovaTarefaInline,TarefaDetalhe,SugestoesTarefas}.tsx`, `features/tarefas/{tarefasFormat,tarefasStore}.ts`, `resources/assistente/guia-do-app.md`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/{tarefas-format,sidebar-stack}.test.ts` | 122, artboards Tarefas e barra | 3 |
| **124** | Funil no main (derivado, migração no boot, `FUNIL.md`, eventos, dados da linha do tempo), aviso "Hoje", `TAREFAS.md` no runner | `src/shared/{funil,funil-schema,funil-logic,funil-timeline}.ts`, `src/main/funil/{store,service,markdown}.ts`, `src/main/funil/alerts.ts` (removido), `src/main/tarefas/hoje.ts` (novo), `src/main/schedules/{store,runner}.ts`, `src/main/chat/actions.ts` (uma leitura), `src/main/index.ts`, `features/funil/{KanbanCard,OportunidadeScreen,Timeline}.tsx` (só o mínimo), `features/funil/funilFormat.ts`, `test/funil-{store,service,timeline,markdown,logic,proposta}.test.ts`, `test/assistant.test.ts` (`:1310`), `test/funil-alerts.test.ts` (removido), `test/tarefas-hoje.test.ts`, `test/tarefas-migracao-integracao.test.ts`, `test/automations-runner.test.ts`, `test/renderer/funil-format.test.ts` | 121, 122, 128 | 3 |
| **125** | Funil nas telas: kanban, seção Tarefas da oportunidade, fichas, linha do tempo; smoke da migração | `features/funil/{KanbanCard,OportunidadeScreen,Timeline,ContatoFicha,EmpresasScreen}.tsx`, `features/funil/funilFormat.ts`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/funil-format.test.ts` | 123, 124, artboards do funil | 4 |
| **126** | Reunião › Resumo, E-mail e WhatsApp | `features/meetings/SummaryTab.tsx`, `features/email/ReadingPane.tsx`, `features/whatsapp/DetailsPanel.tsx`, `features/tarefas/tarefasFormat.ts` (funções do resumo), `test/fixtures/fake-claude.mjs`, `test/fixtures/fake-acp-agent.mjs` (só o resumo), `src/main/smoke.ts`, `src/main/smoke-fixtures.ts` (se precisar), `test/renderer/tarefas-format.test.ts` (casos novos) | 123, 125 (dono do smoke anterior), artboards | 5 |
| **127** | Assistente: fonte, cartões, lembrete → tarefa, Agendamentos sem lembretes; smoke dos agentes | `src/shared/{assistant,chat,ipc}.ts`, `src/main/chat/{actions,store,sources,corpus}.ts`, `src/main/claude-cli/chat.ts`, `src/main/index.ts`, `features/chat/{ActionCards,SourcesSection}.tsx`, `features/chat/chatStore.ts`, `features/schedules/SchedulesTab.tsx`, `test/fixtures/fake-acp-agent.mjs`, `src/main/smoke.ts`, `test/{assistant,chat}.test.ts` | 122, 123, 124, 126, artboard Assistente | 6 |
| **129** | Fechamento: README, guia, design, `docs/telas`, auditoria dos prints, notas | `README.md`, `resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/**`, `docs/specs/tarefas/{auditoria-prints,notas-release,plan}.md`, `src/main/smoke.ts` (só se a auditoria pedir) | todos | 7 |

(Na linha do 128, `src/shared/routes.ts` **não** entra: o comentário "tarefas agendadas" de `routes.ts:8` é trocado pelo 123, dono do arquivo na wave 3.)

### Waves

| Wave | Contratos em paralelo | Dono do `smoke.ts` | Dono do `smoke-fixtures.ts` | Prints novos | `expectedShots` depois |
|---|---|---|---|---|---|
| 1 | 121 · 128 | 128 (checks de Configurações e de Agendamentos; renomeia `tarefas-light`) | ninguém | 0 | `+ 205` |
| 2 | 122 | ninguém | 122 (tipo e array `tarefas.notifications`) | 0 | `+ 205` |
| 3 | 123 · 124 | 123 | 123 (`tarefas.json` semeado) | 11 (`tarefas-hoje` ×2 pela `SCREENS`, mais 9) | `SCREENS` 17 e `+ 214` |
| 4 | 125 | 125 | 125 (lembrete legado em `schedules.json`) | 1 | `+ 215` |
| 5 | 126 | 126 | 126 (se precisar) | 5 | `+ 220` |
| 6 | 127 | 127 | 127 (se precisar) | 2 | `+ 222` |
| 7 | 129 | 129 (só auditoria) | ninguém | 0 | `+ 222` |

Total: **19 PNGs novos** (de 237 para 256) e 4 regravados com outro conteúdo ou nome (`funil-oportunidade`, `automacoes-agendamentos` no lugar de `tarefas-light`, `configuracoes-geral`, `sidebar-raiz`). `expectedShots` final em `smoke.ts:15254`: `SCREENS.length * THEMES.length + 222`, com `SCREENS` de 17 itens.

### Arquivos quentes: um contrato por wave

| Arquivo | Contratos (wave) |
|---|---|
| `src/main/smoke.ts` | 128 (1), 123 (3), 125 (4), 126 (5), 127 (6), 129 (7) |
| `src/main/smoke-fixtures.ts` | 122 (2), 123 (3), 125 (4), 126 (5), 127 (6) |
| `src/shared/ipc.ts` | 122 (2), 127 (6) |
| `src/main/index.ts` | 128 (1, só o texto de `:380`), 122 (2), 124 (3), 127 (6) |
| `src/main/schedules/service.ts`, `src/main/tray/menu.ts` | 128 (1, só texto) |
| `test/assistant.test.ts` | 128 (1), 124 (3), 127 (6) |
| `features/funil/Timeline.tsx` | 124 (3, mínimo), 125 (4) |
| `src/shared/routes.ts`, `app/routes.tsx`, `app/Sidebar.tsx`, `app/useMainNavigation.ts`, `app/Shell.tsx` | 123 (3) |
| `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `src/shared/settings-index.ts`, `SettingsScreen.tsx` | 128 (1) |
| `src/shared/assistant.ts`, `src/main/chat/store.ts`, `src/main/claude-cli/chat.ts`, `features/chat/ActionCards.tsx`, `src/main/chat/sources.ts` | 128 (1), 127 (6) |
| `src/main/chat/actions.ts` | 128 (1), 124 (3, uma leitura), 127 (6) |
| `resources/assistente/guia-do-app.md` | 128 (1), 123 (3), 129 (7) |
| `src/shared/tarefas.ts` | 121 (1), 122 (2) |
| `src/main/tarefas/service.ts` | 122 (2) |
| `src/shared/funil*.ts`, `src/main/funil/*` | 124 (3) |
| `features/funil/KanbanCard.tsx`, `OportunidadeScreen.tsx`, `funilFormat.ts`, `test/renderer/funil-format.test.ts` | 124 (3, só a fonte do dado), 125 (4) |
| `features/tarefas/tarefasStore.ts` | 122 (2), 123 (3) |
| `features/tarefas/tarefasFormat.ts`, `test/renderer/tarefas-format.test.ts` | 123 (3), 126 (5) |
| `features/schedules/SchedulesTab.tsx` | 128 (1), 127 (6) |
| `test/fixtures/fake-acp-agent.mjs` | 126 (5), 127 (6) |
| `src/shared/automations.ts`, `automations-schema.ts`, `AgentForm.tsx` | 128 (1) |
| `src/main/schedules/runner.ts`, `src/main/schedules/store.ts` | 124 (3) |

Mesma wave: zero dependência e zero arquivo em comum, no máximo 3 contratos (conferido para as waves 1 e 3, as únicas com dois).

**Risco de mescla da wave 3.** 123 e 124 não dividem arquivo, mas o smoke do 123 roda, depois da mescla, com as 4 tarefas migradas do funil somadas às semeadas. Por isso o 123 mede por id, confere ordens e grupos por "contém, nesta ordem relativa" e calcula contagens da view (D17); todo check do 123 que muda estado (prazo, lembrete, responsável, feita, reabrir) usa só tarefas semeadas **sem** vínculo de oportunidade, para a mescla não gerar eventos em `funil.json` pelo gancho R10; o `tarefasVazia`, que precisa esvaziar Hoje (onde aparece a migrada vencida de `op-vistoria`), **cancela e reabre** em vez de concluir (D-15: cancelar e reabrir não chamam o gancho); e as tarefas semeadas que se ligam a oportunidades têm prazo **depois** do passo migrado (o kanban do 112 continua mostrando os mesmos passos). Depois de mesclar 123 e 124 na `tarefas`, o coordenador roda `pnpm gates` uma vez na ponta antes da wave 4.

## Gates

Em todo contrato, **da raiz do worktree** (o script `gates` está no `package.json` da raiz, `package.json:15` → `apps/desktop/scripts/gates.sh`), com a tela do Mac acesa e desbloqueada durante todo o smoke (cerca de 20 a 25 minutos):

`cd <worktree> && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`

Verde = typecheck (node, preload, web), eslint `--max-warnings 0`, vitest, build, smoke, nenhum literal de cor fora de `tokens.css`, `check-shapes.sh`, pytest da ponte. Smoke instável fora do escopo do contrato: rodar de novo e dizer no relatório.

**Ajuste mecânico liberado**: testes existentes que quebrarem só porque um tipo ganhou campo obrigatório (`AppSettings.tarefas` e `Agent.tarefas` no 128, `FunilView.proximosPassos` no 124, `ChatSources.tarefas` e os `ChatAction` novos no 127) podem ser ajustados no próprio contrato, acrescentando o campo com o valor padrão, sem mudar a asserção; o relatório lista cada arquivo mexido assim.

| Contrato | Testes vitest exigidos |
|---|---|
| 121 | `test/tarefas-store.test.ts`, `test/tarefas-logic.test.ts`, `test/tarefas-sugestoes.test.ts`, `test/tarefas-migracao.test.ts`, `test/tarefas-markdown.test.ts`, `test/meeting-summary.test.ts` (casos novos) |
| 128 | `test/settings-store.test.ts` (CA15, rótulos do funil), `test/assistant.test.ts` e `test/chat.test.ts` (CA12, textos), `test/automations-service.test.ts` (`Agent.tarefas`, texto da pausa), `test/tray-automations.test.ts` (textos) |
| 122 | `test/tarefas-service.test.ts` (inclui destino pendente e virada do dia), `test/tarefas-ipc.test.ts`; `test/lock-ipc.test.ts` verde |
| 123 | `test/renderer/tarefas-format.test.ts` (novo), `test/renderer/sidebar-stack.test.ts`; `test/assistant.test.ts` (marcador do guia) verde |
| 124 | `test/funil-{store,service,timeline,markdown,logic}.test.ts`, `test/funil-proposta.test.ts:152` e `test/assistant.test.ts:1310` (asserção nova: passo não gravado, tarefa criada), `test/tarefas-hoje.test.ts` (novo), `test/tarefas-migracao-integracao.test.ts` (novo), `test/automations-runner.test.ts`, `test/renderer/funil-format.test.ts` |
| 125 | `test/renderer/funil-format.test.ts` (casos novos) |
| 126 | `test/renderer/tarefas-format.test.ts` (casos novos) |
| 127 | `test/assistant.test.ts`, `test/chat.test.ts` |
| 129 | nenhum |

## Fechamento

Por contrato: `implementador` (Opus, só o contrato e este plan) → gates verdes → `revisor` cego (Opus, diff + contrato) → no máximo uma devolução → commit **pelo agente de commits** (nunca `git commit` à mão, nem para doc) → merge do `tarefas-<NN>` na `tarefas` → linha datada (hora real de `date`) no Andamento da nota-índice do cofre. Sem push. Ao fim da wave 7: merge da `tarefas` na `main`, build local (`.dmg` sem tag), teste navegado numa **sessão nova** com a skill `relatorio-teste-navegado` seguindo "Verificação end-to-end" da spec, correções em contrato próprio se houver, e só então `git mv docs/specs/tarefas docs/specs/_archive/tarefas` com `status: arquivado` (passo do coordenador).

## Worktrees

O repositório principal fica na `main`. A branch da feature, `tarefas`, fica aberta em `~/Documents/GitHub/meeting-scribe-tarefas` (onde os merges acontecem e onde o 129 roda). Cada contrato roda no seu worktree, criado da ponta atual da `tarefas`:

```
git -C ~/Documents/GitHub/meeting-scribe worktree add ~/Documents/GitHub/meeting-scribe-tarefas -b tarefas main
git -C ~/Documents/GitHub/meeting-scribe-tarefas worktree add ~/Documents/GitHub/meeting-scribe-tarefas-<NN> -b tarefas-<NN> tarefas
```

| Wave | Worktrees |
|---|---|
| 1 | `meeting-scribe-tarefas-121` (`tarefas-121`), `meeting-scribe-tarefas-128` (`tarefas-128`) |
| 2 | `meeting-scribe-tarefas-122` |
| 3 | `meeting-scribe-tarefas-123`, `meeting-scribe-tarefas-124` |
| 4 | `meeting-scribe-tarefas-125` |
| 5 | `meeting-scribe-tarefas-126` |
| 6 | `meeting-scribe-tarefas-127` |
| 7 | `meeting-scribe-tarefas` (o 129 roda na própria `tarefas`) |

Cada contrato aceito e commitado é mesclado na `tarefas` antes da wave seguinte; o worktree do contrato é removido depois do merge. Em cada worktree novo, `pnpm install` antes dos gates.

## Cobertura

| Regra | Contrato |
|---|---|
| R1 | 123 |
| R2 | 123 (visões e ordens; partição pura no 121) |
| R3 | 123 (nomes da origem resolvidos no 122) |
| R4 | 123 |
| R5 | 123 (campos, vínculos, Abrir e-mail/conversa), 126 (smoke do Abrir) |
| R6 | 123 |
| R7 | 122 (evento), 123 (busca e filtros locais) |
| R8 | 121 (store), 122 (canais) |
| R9 | 122 (criação), 125 e 126 (telas que criam) |
| R10 | 122 (gancho `onOportunidade`), 124 (evento `tarefa` e interação) |
| R11 | 121 (cálculo), 122 (aplica com `TarefasSettings`), 128 (configuração) |
| R12 | 122 (tick, notificação, destino pendente no main, virada do dia), 123 (consome o Abrir; smoke com bloqueio) |
| R13 | 127 (inclui `ESTADO.md` com "Lembretes" derivados, `AUTOMACOES.md` sem lembretes e "Ver em Tarefas"), 121 ("Lembretes" em `TAREFAS.md`) |
| R14 | 124 (derivado), 125 ("Sem tarefa" no kanban) |
| R15 | 125 |
| R16 | 124 |
| R17 | 124 (passo vira tarefa pelo serviço), 127 (texto do `done` e oportunidade fechada) |
| R18 | 124 (dados do item: `tarefaId`, título, prazo, origem resumida, criada/feita; `Timeline.tsx` mínimo), 125 (UI com "Abrir tarefa") |
| R19 | 125 |
| R20 | 124 |
| R21 | 121 (esquema e pedido), 126 (fixture e tela) |
| R22 | 121 (responsável e casamento), 122 (canal), 126 (tela) |
| R23 | 121/122 (casamento por texto), 126 (smoke) |
| R24 | 126 (+ Tarefa), 123 (Abrir e-mail no detalhe) |
| R25 | 126 (+ Tarefa), 123 (Abrir conversa no detalhe) |
| R26 | 121 (lógica), 122 (canal), 123 (aba) |
| R27 | 121 (gerador), 127 (fonte) |
| R28 | 127 |
| R29 | 128 |
| R30 | 127 |
| R31 | 128 (campo, Switch, modelo "Minhas tarefas"), 124 (runner), 127 (smoke do Pedir agora) |
| R32 | 124 (aviso), 128 (rótulo "Incluir oportunidades esfriadas no aviso Hoje") |
| R33 | 128 (todo o vocabulário: tela, formulário, bandeja, notificações, guia, `AUTOMACOES.md`), 127 (lista sem lembretes; `AUTOMACOES.md` sem lembretes) |
| R34 | 128 |
| R35 | 121 (função), 124 (adaptadores e boot), 125 (smoke) |
| R36 | 121 (0600, log sem título), 122 (canais `refused`), 124 (`TAREFAS.md` do agente apagado), 127 (fonte e canal do cartão) |
| R37 | 122 |

| CA | Contrato |
|---|---|
| CA1 | 121 (falsos), 124 (stores reais), 125 (smoke) |
| CA2 | 123 |
| CA3 | 123 |
| CA4 | 123 |
| CA5 | 121 (recálculo), 123 (tela) |
| CA6 | 122 (vitest), 123 (smoke) |
| CA7 | 124 (derivado, `FUNIL.md`, evento), 125 (smoke) |
| CA8 | 121 (`dueIso`), 122 (canal), 126 (smoke) |
| CA9 | 126 |
| CA10 | 121 e 122 (as três fontes), 123 (smoke e print) |
| CA11 | 127 |
| CA12 | 128 |
| CA13 | 128 (Switch, campo, textos e `AUTOMACOES.md`), 124 (runner), 127 (smoke do agente e lista sem lembretes) |
| CA14 | 124 |
| CA15 | 128 |
| CA16 | 122 (`lock-ipc`), 123 (smoke no bloqueio), 127 (canal do cartão) |
| CA17 | 128, 123, 125, 126, 127 (cada um ajusta `expectedShots`), 129 (total e auditoria) |

## Ambiguidades da spec (resolvidas aqui ou para o coordenador)

Resolvidas no plan (o contrato segue a resolução; o coordenador confirma ou devolve):

- **D-1** "`SCREENS` ganha `tarefas`" × print exigido `tarefas-hoje`: `SCREENS` ganha **`'tarefas-hoje'`** (o mesmo nome da lista de prints e sem colidir com o `tarefas-light` antigo, que o 128 renomeia para `automacoes-agendamentos-light` na wave 1).
- **D-2** `configuracoes-geral` "rolada até Tarefas; substitui": o print da `SCREENS` passa a mostrar a Section Tarefas (rolagem antes do `shoot`, `smoke.ts:14890`); a checagem da Marca (`settingsReady`) continua antes da rolagem. O bloco Marca deixa de aparecer nesse print.
- **D-3** Migração disparada por `migradoEm === null` (não por "arquivo ausente"), anexando às tarefas que já existirem; falha depois da gravação desfaz as três gravações (D11).
- **D-4** Lembrete que migra = `reminder` com `nextRunAt` no futuro (desligado tem `nextRunAt` nulo e não migra); os já disparados também saem de `schedules.json` (estão na cópia); remoção sempre por lista de ids; `schedules.json` inválido → a parte das Automações é pulada sem regravar; nada a migrar → nenhum `mutate` em `schedules.json` nem em `funil.json` (R35).
- **D-5** `vinculos.email.mailbox: string | null` (já no modelo da spec): o lembrete de e-mail achado só no servidor (contrato 45, `assistant.ts` `ReminderEmail.mailbox`) não perde a pasta, e o "Abrir e-mail" do detalhe (123) a respeita.
- **D-6** Lembrete "padrão" × "personalizado" sem campo novo: é padrão quando `lembreteEm` é igual ao padrão calculado do prazo antigo (`tarefas-logic.ts`, `recalcularLembrete`). Prazo novo numa tarefa sem prazo e sem lembrete, com `lembrarNoPrazo` ligado, ganha o padrão.
- **D-7** Cartão `lembrete` e lembrete migrado: `prazo` = dia local do `quando` (aparece em Hoje no dia), `lembreteEm` = o `quando` (personalizado).
- **D-8** Passo migrado (`migracao/proximo-passo`) nasce **sem** lembrete: evita uma rajada de avisos de passos vencidos na primeira abertura.
- **D-9** `quando` dos compromissos do WhatsApp vira prazo só se for `AAAA-MM-DD` ou `dd/mm` (ano corrente, ou o seguinte se já passou); "sexta" fica sem prazo.
- **D-10** "Feitas" ordena por `feitaEm`, que guarda o momento do fechamento (feita **ou** cancelada); cancelada não vira feita nem o contrário sem passar por Reabrir (erro `fechada`).
- **D-11** Agrupar por Contato: a tarefa entra no grupo do primeiro contato dos vínculos; sem contato, "Sem contato". "Esta semana" = depois de hoje até o domingo da semana corrente.
- **D-12** Aviso "Hoje": título "Hoje", corpo com as partes não nulas separadas por " · " ("1 vencida · 1 para hoje · Funil: 1 esfriada"); bloqueado, "Há tarefas pedindo atenção.". Abrir → `/tarefas`.
- **D-13** Ids nos cartões: `TAREFAS.md` mostra o id curto (8 primeiros caracteres); os cartões aceitam o id inteiro ou o curto; curto que casa com 0 ou mais de 1 tarefa → `failed` "Essa tarefa não existe mais".
- **D-14** `lembrete-editar` opera sobre tarefa **aberta** com `lembreteEm` (disparado ou não); salvar põe o novo `lembreteEm` e zera `lembreteDisparadoEm`. `lembrete-apagar` apaga a tarefa (CA11).
- **D-15** R10 grava evento só em criar, concluir e mudar prazo (não em reabrir nem cancelar).
- **D-16** R22 "nome casa com um participante que é contato": o `owner` igual (sem acento e sem caixa) ao `name` de um `calendar.attendees` cujo `email` é de um contato.
- **D-17** O 123 só pode mostrar Sugestões do que o smoke tem (o resumo "Você" das reuniões gravadas e o que mais existir); as três fontes da CA10 ficam provadas no vitest do 121/122.

Decididas pelo coordenador na revisão do pacote (22/11/2026):

- **P-1** (D-2) `configuracoes-geral` rolado até Tarefas, substituindo. **Decidido pelo coordenador: mantido.**
- **P-2** (D-5) `vinculos.email.mailbox`. **Decidido pelo coordenador: aceito (já na spec).**
- **P-3** (D-8) Passo migrado sem lembrete. **Decidido pelo coordenador: mantido (já na spec, R35).**

## Pendências

Levantadas no fechamento (contrato 129, 22/11/2026). Nenhuma é bloqueadora; cada uma vira contrato próprio quando entrar.

**Do código (achados dos relatórios e das revisões dos contratos 121 a 128):**

1. **Sugestão de análise adicionada pode voltar.** A sugestão que vem do `toConfirm` da análise nasce com `origem: { tipo: 'manual' }` quando é adicionada, e o `jaVirou` de `shared/tarefas-sugestoes.ts:49` só reconhece as tarefas de origem `reuniao` e `whatsapp`. Depois de adicionada, a mesma linha da análise volta à aba Sugestões até ser ignorada. Anotada na devolução do 123; nenhum contrato posterior pegou.
2. **`createReminder` e `updateReminder` sem uso no serviço das Automações** (`main/schedules/service.ts:150,155,872,922`): desde o 127 os lembretes do Assistente são tarefas, e nada chama esses dois métodos (o `createReminder` do `chatStore` é outro, do canal do chat). Junto, os ramos de lembrete do `features/schedules/SchedulesTab.tsx` (`:102`, `:143-164`, `:186`) ficaram mortos, porque a lista já filtra `!task.reminder` na `:50`. Tirar os dois com os testes que os cobrem.
3. **`textoPassoDetalhe` sem uso** (`features/funil/funilFormat.ts:226`): o campo Próximo passo do detalhe da oportunidade saiu no 125 e a função ficou, com os casos em `test/renderer/funil-format.test.ts`.
4. **`NovaTarefaInline` no painel de 300 px do WhatsApp:** o campo Oportunidade (180 px) e a dica longa ("Enter cria · Esc cancela · a oportunidade é opcional e traz os contatos dela para os vínculos.") não cabem bem na largura do painel de Detalhes; o formulário quebra em várias linhas. Uma variante compacta (sem a dica longa, Oportunidade na linha de baixo) resolve.
5. **Seção Tarefas da oportunidade dentro do cabeçalho fixo:** a seção fica entre a grade de campos e as abas, fora da área que rola. A lista das abertas tem teto de 220 px e rola por dentro, mas com muitas tarefas (mais "Nova tarefa" e "Feitas") a seção inteira passa de 300 px e aperta as abas e a linha do tempo numa janela de 740 px de altura.
6. **Cartão `tarefa-criar`: "Editar" contorna o `ambiguo`** (achado opcional do revisor do 127, fora da devolução): com o nome da oportunidade ou do contato ambíguo, abrir "Editar" e salvar deixa criar sem passar pela escolha no `SearchPicker`.
7. **Lembrete padrão no pulo do horário de verão** (achado opcional do revisor do 121): `lembretePadrao` pode cair num horário que não existe no dia em que o relógio adianta. Não afeta o fuso de São Paulo hoje (sem horário de verão); vale para quem usar outro fuso.
8. **"Era padrão" depende da hora atual** (consequência da D-6, informação do revisor do 121): o recálculo decide se o lembrete era o padrão comparando com o padrão calculado com a `horaLembrete` de agora; quem muda a hora em Configurações e depois muda o prazo de uma tarefa antiga perde o recálculo daquela tarefa.
9. **`emailExport.reminders` sem teste unitário** (achado do revisor do 129): a lista dos lembretes de e-mail que o Assistente recebe (`main/index.ts` ~1545-1552) filtra só os lembretes futuros e ainda não disparados, mas essa lógica mora no `index.ts`, sem teste unitário; só o smoke a cobre. Levar o filtro para uma função pura (em `main/tarefas/`) com vitest.

**Da auditoria dos prints e do fechamento:**

10. **Auditoria dos prints pendente de execução.** O `pnpm gates` do fechamento parou no smoke com "Current display surface not available for capture" (tela do Mac bloqueada); nenhum dos 19 prints novos nem dos regravados foi gerado. `auditoria-prints.md` está com `status: pendente-de-execucao` e a lista do que conferir em cada print. O CA17 da spec (smoke com `SCREENS.length * THEMES.length + 222` PNGs e `report.json` sem título nem e-mail) segue sem prova até o smoke rodar.
11. **Artboards antigos de `docs/telas` sem o "+ Tarefa" e o bloco Tarefas:** `EmailLeitura`, `EmailLeituraContato`, `WhatsAppContato`, `FunilContatos` (ficha sem o bloco Tarefas), `FunilEmpresas` e `DetalheResumoOportunidade` (tabela de tarefas sem a coluna de estado) continuam como estavam; as telas novas e mudadas têm artboard próprio (ver `docs/telas/README.md`). Os artboards novos ainda precisam ser conferidos contra os prints quando o smoke rodar.
