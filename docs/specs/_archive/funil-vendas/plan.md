---
status: arquivado
arquivado_em: 2026-11-21
feature: funil-vendas
data: 2026-11-20
semana: 2026-W47
base: main dd106ce (versão 0.19.0)
---

# Plan: Funil de vendas (Contatos, Empresas, Oportunidades)

Spec `spec.md` · PRD `prd.md` · Inventário `inventario.md` · Mockup `mockups/Funil.dc.html` (16 artboards, PNGs em `mockups/png/`; a aprovar) · Branch `funil-vendas` (base dd106ce = 0.19.0, com o Instagram já mesclado). Caminhos de código relativos a `apps/desktop/`. Contratos numerados de **107 a 119** (84 a 106 são da frente `arquitetura-seguranca`).

**Worktrees.** Hoje a branch `funil-vendas` está aberta no repositório principal (`~/Documents/GitHub/meeting-scribe`); o git não abre a mesma branch em dois lugares, então **antes de criar qualquer worktree o repositório principal precisa voltar para a `main`**. Depois:
- waves de contrato único (5 a 8) rodam em `~/Documents/GitHub/meeting-scribe-funil-vendas` (branch `funil-vendas`);
- waves com mais de um contrato (1 a 4) rodam um worktree por contrato em `~/Documents/GitHub/meeting-scribe-funil-<NN>` (branch `funil-<NN>`, criada a partir da ponta da `funil-vendas`), e cada contrato aceito e commitado é mesclado na `funil-vendas` antes da wave seguinte.

## Decisões técnicas

1. **D1. Store único `userData/funil.json`** em `src/main/funil/store.ts`, copiando `serialQueue()` e `atomicWrite()` de `src/main/schedules/store.ts:49-62` (fila serial, temporário + `rename`, `mode 0o600`), cache em memória, quarentena `funil.json.corrupt-<stamp>` e cópia diária `funil.json.bak-<AAAA-MM-DD>` com as 7 mais recentes (R1). Porquê: um arquivo pequeno deixa atômicas as operações que cruzam entidades, o padrão já é testado e a cópia diária é o único "desfazer" desta versão.
2. **D2. Lógica pura em `src/shared/funil-*.ts`**: `funil-logic.ts` (normalização e comparação de telefone, mescla, domínio, etapas, última interação, esfriada, totais, `formatarBRL`), `funil-import.ts`, `funil-sugestoes.ts`, `funil-timeline.ts`, `funil-proposta.ts` + `funil-proposta-schema.ts`. Porquê: CA1 a CA6 e CA9 viram testes vitest sem Electron, e o renderer e o `FUNIL.md` usam a mesma formatação.
3. **D3. Serviço `src/main/funil/service.ts` sobre o store**, lendo os outros domínios só por dependências injetadas e só pelos caches que os serviços já mantêm (`email.cached()`, `whatsapp.chats()`, `meetings.list()`, resumos): sugestões e linha do tempo são calculadas **sob demanda**, dentro dos seus canais; `FunilView.ultimas` é recalculado só no `scribe:funil-get` e depois de cada gravação de `funil.json`. Porquê: nenhuma releitura de disco de email ou WhatsApp e nenhum cálculo em segundo plano.
4. **D4. IPC em `src/main/funil/ipc.ts` (`registerFunilIpc(deps)`)**. `src/main/index.ts` (2 736 linhas) recebe só a criação do serviço em `createAppServices` (`index.ts:946`), o campo em `AppServices` (`:853`), a chamada em `registerIpc` (`:2019`) e, nos contratos seguintes, ligações de uma linha cada.
5. **D5. `funilStore` zustand** em `features/funil/funilStore.ts`, carregado por `scribe:funil-get` e recarregado em `scribe:funil-changed`; payload `FunilView { state: FunilState; ultimas: Record<oportunidadeId, number> }`. Porquê: uma fonte só para todas as telas; "esfriou" no cartão sem uma ida ao main por oportunidade.
6. **D6. Arrastar com DnD nativo HTML5**, como `features/email/EmailNav.tsx:104-234`, tipo de dado `application/x-lap-funil-card`; nenhuma biblioteca nova.
7. **D7. Detecção numa passada separada `funnel-extract`**, copiando `src/main/invites/suggest.ts` (`runClaudeOneShot`, pasta ACP própria `ACP_FUNNEL_DIR`, modelo fixo `'haiku'`) e o ciclo de estado de `meetings/analysis-service.ts`; **`summaryContentSchema` não muda**.
8. **D8. Disparo automático no `onStatus` do resumo** (`index.ts:1540-1545`, ramo `status.state === 'ready'`), só com `funil.detectarNasReunioes` ligado, sem `meetings/<id>.funil.json` existente e **fora do smoke** (R38); "Detectar oportunidade" roda sempre e substitui o arquivo.
9. **D9. Um canal único `scribe:chat-action-funil`** `{chatId, index, actionId, campos?}` executa os quatro cartões pelo `kind` gravado.
10. **D10. Section "Funil de vendas" em Configurações › Geral**, porque `SETTINGS_TABS` (`shared/routes.ts:127`) tem 9 abas e ⌘1 a ⌘9 estão ocupados.
11. **D11. `src/main/smoke.ts` e `src/main/smoke-fixtures.ts` são editados por um só contrato por wave** (tabela abaixo); contratos sem smoke entregam testes vitest.
12. **D12. Escrever e-mail**: `EmailNavigationState.compose?: { to: string[]; subject?: string }` em `shared/routes.ts:89` (112); `EmailScreen` chama o `newMessage(to)` existente (`features/email/EmailScreen.tsx:394`, que já põe a assinatura) quando chega `compose` (119). `Composer.tsx` não muda.
13. **D13. Item Funil entre Email e Redes** (R17) em `APP_ROUTES` (`app/routes.tsx`, antes da linha `redes`); sempre visível. O Instagram já está na main, sem conflito de worktree.
14. **D14. Navegação por `state`**: `FunilNavigationState { nova?: { contatoIds: string[]; empresaId: string | null } }` em `shared/routes.ts`; "Abrir WhatsApp" navega para `/whatsapp` com `WhatsAppNavigationState { chatId }` (`routes.ts:35`); `scribe:navigate` com `'funil'` é mapeado em `app/useMainNavigation.ts:20-24` para `funilPath('oportunidades')`, como o `redes`.
15. **D15. Alerta diário pelo tick das Automações**: `AutomationsDeps.onTick?: (at: number) => Promise<void>` chamado em `doTick` (`schedules/service.ts:591-594`) depois de `dueReminders` e antes da checagem de pausa; lógica em `src/main/funil/alerts.ts`; o clique da notificação manda `scribe:navigate` com `'funil'` (D14).
16. **D16. Um gerador só de `FUNIL.md`** em `src/main/funil/markdown.ts` (115), usado pela fonte do Assistente (R41, 117) e pelas execuções de agente (R45, 115).
17. **D17. Agente com "Pode ler o funil" roda numa pasta própria da execução**, pelo caminho do ramo `request.tools` (`schedules/runner.ts:168-172`), porque o escopo "todas as reuniões" usa a pasta compartilhada do acervo (`runner.ts:180-183`).
18. **D18. Dados do smoke semeados antes dos serviços**: `smoke-fixtures.ts` grava `funil.json` (datas relativas a agora), citando remetentes do email falso (`main/email/fake-email.ts:51-75`). Porquê: "esfriada" exige datas antigas.
19. **D19. Relação com `arquitetura-seguranca`** (contratos 84 a 106, plan em rascunho): se o 93 (`storage/json-file.ts`) ou o 89 (`handle` com esquema) estiverem na main quando um contrato do funil começar, ele usa o que existir; nenhum contrato do funil implementa parte daquela frente.
20. **D20. Empresa por nome nas ações confirmadas**: importação com coluna Empresa, cartões do Assistente e proposta aplicada acham a empresa por nome sem acento e sem caixa e, não achando, criam. A sugestão por domínio (R5) continua só no clique.
21. **D21. `SearchPicker` único** (`features/funil/SearchPicker.tsx`, R25), criado no 112 e usado para Empresa e Contatos em todas as telas do funil (119, 114, 116).
22. **D22. Detalhe da oportunidade em contrato próprio (119)**, separado do kanban (112), para cada contrato ter uma tela e um bloco de smoke revisáveis sozinhos.

### Lacunas da spec resolvidas aqui

Todas as lacunas e contradições levantadas na primeira versão deste plan foram **resolvidas na spec** (revisão de 20/11/2026); ficam listadas para rastreio:

- **D-1** Bloco Participantes de `SummaryTab`: resolvida na spec (R35, abaixo das tarefas; sem `calendar`, sem bloco).
- **D-2** `ultimoAvisoEm`: resolvida na spec (campo de topo no modelo).
- **D-3** Fonte "agenda" das sugestões: resolvida na spec (R11: a agenda não é fonte).
- **D-4** Unidade do valor da proposta: resolvida na spec (centavos).
- **D-5** `atualizar` com id inválido e etapa desconhecida: resolvida na spec (R38, com linha a mais na justificativa).
- **D-6** Evento da proposta: resolvida na spec (R38 e R47, `scribe:funil-proposta-changed`).
- **D-7** Política de bloqueio: resolvida na spec (R47, todos `refused`).
- **D-8** "Select com busca": resolvida na spec (R25, `SearchPicker`).
- **D-9** Colunas nos filtros: resolvida na spec (R23).
- **D-10** Estados não desenhados e drop na faixa recolhida: resolvida na spec (lista de não desenhados; R24, destaque `--accent` e drop sem expandir).
- **D-11** Reunião apagada: resolvida na spec (modelo: o id fica em `meetingIds`, a linha do tempo mostra "Reunião apagada", a aba Reuniões desvincula; o `<id>.funil.json` é apagado).
- **D-12** Prints exigidos × CA: resolvida na spec (CA12 e CA14 citam os 13 prints). Total **`expectedShots` + 26** (de `+ 179` para `+ 205` em `smoke.ts:13421`).
- **D-13** Dias fora de 1 a 90: resolvida na spec (R46: volta ao último válido no blur, sem gravar).
- **D-14** Ordem dos blocos no artboard `09`: resolvida na spec (vale R35; o artboard é corrigido no 118).
- **D-15** Lugar do "Detectar oportunidade": resolvida na spec (R40, linha de ações do `SummaryTab`).
- **D-16** `contato-criar` sem e-mail nem telefone, mover para Perdido e contato citado sem e-mail: resolvida na spec (R42 e R39).

### Artboards do mockup `mockups/Funil.dc.html` (PNGs em `mockups/png/<nome>-claro.png` e `-escuro.png`)

| Artboard | Contrato |
|---|---|
| `00a-barra-raiz`, `00b-barra-nivel-funil` | 112 |
| `01-oportunidades`, `01b-oportunidades-motivo-perda`, `02-oportunidades-nova`, `03-oportunidades-editar-etapas` | 112 |
| `04-oportunidade-detalhe` (vale `formatarBRL`, sem centavos zerados) | 119 |
| `05-contatos`, `06-contatos-sugestoes`, `07-contatos-importar`, `08-empresas` | 114 |
| `09-reuniao-resumo-oportunidade` (vale R35: Participantes abaixo das tarefas) | 116 |
| `10-assistente-funil` | 117 |
| `11-configuracoes-geral-funil` | 109 |
| `12a-email-leitura-contato`, `12b-whatsapp-detalhes-contato` | 116 |

Não desenhados (seguem o artboard vizinho): cartões `oportunidade-proximo-passo` e `contato-criar` (117, vizinho `10`), variante "Atualizar oportunidade" (116, vizinho `09`), ficha Novo contato (114, vizinho `05`), prévia de vCard (114, vizinho `07`), Switch "Pode ler o funil" (115, linha "Pode pesquisar na internet" do `AgentForm`), notificação (115, texto de R44).

## Grafo de tarefas

| Wave | Contrato | Entrega | Arquivos que toca | Depende de |
|---|---|---|---|---|
| 1 | **107: Dados, store e lógica pura** | tipos, zod, store com backup diário, telefone brasileiro, mescla que desarquiva, arquivar, etapas, última interação, esfriada, totais, `formatarBRL` (R1 a R7, R27 no store; CA1 a CA4) | `src/shared/funil.ts`, `src/shared/funil-schema.ts`, `src/shared/funil-logic.ts`, `src/main/funil/store.ts`, `test/funil-store.test.ts`, `test/funil-logic.test.ts` | nada |
| 1 | **108: Importação (módulo puro)** | CSV e vCard (R14 a R16 na parte pura; CA5) | `src/shared/funil-import.ts`, `test/funil-import.test.ts`, `test/fixtures/funil/*` | nada |
| 1 | **109: Configurações do funil** | `DEFAULT_SETTINGS.funil`, esquema, índice, Section em Geral (R46; CA10; CA16 parte) | `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `src/shared/settings-index.ts`, `features/settings/SettingsScreen.tsx`, `features/settings/FunilSection.tsx` (novo), `src/main/smoke.ts`, `test/settings-store.test.ts` | artboard `11` |
| 2 | **110: Serviço e IPC** | serviço, sugestões e linha do tempo sob demanda, importação pelo diálogo, 16 canais (R47 menos proposta), `scribe:funil-changed`, `funilStore` (R4 na importação, R8 a R13, R16, R27 canal, R47; CA6) | `src/main/funil/service.ts`, `src/main/funil/ipc.ts`, `src/shared/funil-sugestoes.ts`, `src/shared/funil-timeline.ts`, `src/shared/funil.ts`, `src/shared/ipc.ts`, `src/main/index.ts`, `src/main/smoke-fixtures.ts`, `features/funil/funilStore.ts`, `test/funil-service.test.ts`, `test/funil-sugestoes.test.ts`, `test/funil-timeline.test.ts` | 107, 108 |
| 2 | **111: Detecção (motor)** | `funnel-extract`, prompt, esquema, store `<id>.funil.json`, extração (R38 menos disparo; CA9) | `src/shared/funil-proposta.ts`, `src/shared/funil-proposta-schema.ts`, `src/main/claude-cli/funnel.ts`, `src/main/funil/proposals.ts`, `src/main/funil/extract.ts`, `src/main/meetings/claude-one-shot.ts`, `src/main/acp/profiles/types.ts`, `test/fixtures/fake-acp-agent.mjs`, `test/funnel-extract.test.ts` | 107 |
| 3 | **112: Navegação e kanban** | rota, item e nível Funil, `useMainNavigation`, guia (marcador), kanban (filtros, nova, etapas, arrastar), `SearchPicker` (R7 e R6 na tela, R17 a R19, R21 a R26; CA7, CA11, CA12) | `src/shared/routes.ts`, `app/routes.tsx`, `app/sidebarLevels.ts`, `app/SidebarStack.tsx`, `app/Sidebar.tsx`, `app/useMainNavigation.ts`, `resources/assistente/guia-do-app.md`, `features/funil/{FunilScreen,OportunidadesScreen,KanbanCard,NovaOportunidadeCard,SearchPicker,funilFormat}.tsx/ts`, `features/funil/funilStore.ts`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/sidebar-stack.test.ts`, `test/renderer/funil-format.test.ts` | 109, 110, artboards `00a` a `03` |
| 3 | **113: Detecção (canais e disparo)** | canais `scribe:funil-proposta-*`, aplicar, vincular, descartar, nota "Citados na reunião", disparo pós-resumo fora do smoke, remoção do arquivo com a reunião (R38 disparo, R39 e R40 no main, R47 parte) | `src/shared/ipc.ts`, `src/shared/funil-proposta.ts`, `src/main/funil/ipc.ts`, `src/main/funil/apply-proposal.ts` (novo), `src/main/index.ts`, `test/funil-proposta.test.ts` | 110, 111 |
| 4 | **119: Tela Oportunidade (detalhe)** | campos, ações, Arquivar, abas, linha do tempo com "Reunião apagada", Escrever e-mail por `newMessage`, Abrir WhatsApp (R27 a R29; CA13) | `features/funil/{OportunidadeScreen,Timeline}.tsx` (novos), `features/funil/FunilScreen.tsx`, `features/funil/funilStore.ts`, `features/funil/funilFormat.ts`, `features/email/EmailScreen.tsx`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/funil-format.test.ts` | 112, artboard `04` |
| 4 | **115: Alertas e Automações** | `FUNIL.md` (gerador), alerta diário, Switch do agente, `FUNIL.md` na pasta da execução (R41 conteúdo, R44, R45) | `src/main/funil/markdown.ts`, `src/main/funil/alerts.ts` (novos), `src/main/funil/service.ts` (só `marcarAviso`), `src/main/schedules/service.ts`, `src/main/schedules/runner.ts`, `src/shared/automations.ts`, `src/shared/automations-schema.ts`, `features/agents/AgentForm.tsx`, `src/main/index.ts`, `test/funil-markdown.test.ts`, `test/funil-alerts.test.ts`, `test/automations-runner.test.ts`, `test/automations-service.test.ts` | 109, 110, 112 |
| 5 | **114: Telas de Contatos e Empresas** | lista, ficha, novo, sugestões, importar, empresas, sugestão de empresa (R5 na tela, R11 a R16 na tela, R27 nas fichas, R30 a R34; CA14) | `features/funil/{ContatosScreen,ContatoFicha,SugestoesList,ImportarPainel,EmpresasScreen}.tsx` (novos), `features/funil/FunilScreen.tsx`, `features/funil/funilStore.ts`, `features/funil/funilFormat.ts`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/renderer/funil-format.test.ts` | 112, 119, artboards `05` a `08` |
| 6 | **116: Botões nas telas existentes e cartão de detecção** | "+ Contato" no Resumo, Email e WhatsApp, cartão "Oportunidade detectada" com e-mail por contato e aviso de duplicata, "Detectar oportunidade" (R35 a R37, R39 e R40 na tela; CA15) | `features/meetings/SummaryTab.tsx`, `features/meetings/MeetingDetailScreen.tsx`, `features/meetings/OpportunityCard.tsx` (novo), `features/email/ReadingPane.tsx`, `features/whatsapp/DetailsPanel.tsx`, `features/funil/{ContactLink,proposalStore}.ts(x)` (novos), `src/main/smoke.ts`, `src/main/smoke-fixtures.ts` | 113, 114, 119, artboards `09`, `12a`, `12b` |
| 7 | **117: Assistente e agentes com o funil** | fonte Funil desligada por padrão, `OPEN_SCREENS`, 4 cartões, canal, instrução, guia dos cartões, smoke do agente (R19 cartões, R20, R41 a R43, R45 no smoke; CA8, CA16) | `src/shared/assistant.ts`, `src/shared/chat.ts`, `src/shared/ipc.ts`, `src/main/chat/{actions,store,sources}.ts`, `src/main/claude-cli/chat.ts`, `src/main/index.ts`, `features/chat/{ActionCards,SourcesSection}.tsx`, `features/chat/chatStore.ts`, `resources/assistente/guia-do-app.md`, `test/fixtures/fake-acp-agent.mjs`, `src/main/smoke.ts`, `src/main/smoke-fixtures.ts`, `test/assistant.test.ts`, `test/chat.test.ts` | 112, 115, 119, artboard `10` |
| 8 | **118: Fechamento** | README, guia completo, `docs/telas` (com os artboards `04` e `09` corrigidos), auditoria dos 26 prints, `expectedShots` final; arquivamento só depois do teste navegado (R19 final; CA17) | `README.md`, `resources/assistente/guia-do-app.md`, `docs/telas/**`, `docs/specs/desktop-shell/design.md`, `docs/specs/funil-vendas/auditoria-prints.md`, `src/main/smoke.ts` (só se a auditoria pedir) | todos |

### Dono do `smoke.ts` e do `smoke-fixtures.ts` por wave

| Wave | Edita `smoke.ts` | Edita `smoke-fixtures.ts` | Prints novos | `expectedShots` depois |
|---|---|---|---|---|
| 1 | 109 (check de texto em `configuracoes-geral`) | ninguém | 0 | `+ 179` |
| 2 | ninguém | 110 (CSV de importação) | 0 | `+ 179` |
| 3 | 112 | 112 (`funil.json` semeado) | 3 | `+ 185` |
| 4 | 119 | 119 | 1 | `+ 187` |
| 5 | 114 | 114 | 5 | `+ 197` |
| 6 | 116 | 116 | 3 | `+ 203` |
| 7 | 117 | 117 | 1 | `+ 205` |
| 8 | 118 (só auditoria) | ninguém | 0 | `+ 205` |

### Arquivos quentes: um contrato por wave

| Arquivo | Contratos (wave) |
|---|---|
| `src/main/smoke.ts` | 109 (1), 112 (3), 119 (4), 114 (5), 116 (6), 117 (7), 118 (8) |
| `src/main/smoke-fixtures.ts` | 110 (2), 112 (3), 119 (4), 114 (5), 116 (6), 117 (7) |
| `src/shared/routes.ts`, `app/routes.tsx`, `app/useMainNavigation.ts` | 112 (3) |
| `resources/assistente/guia-do-app.md` | 112 (3), 117 (7), 118 (8) |
| `src/shared/ipc.ts` | 110 (2), 113 (3), 117 (7) |
| `src/main/index.ts` | 110 (2), 113 (3), 115 (4), 117 (7) |
| `src/shared/assistant.ts` | 117 (7) |
| `src/main/funil/ipc.ts` | 110 (2), 113 (3) |
| `src/main/funil/service.ts` | 110 (2), 115 (4) |
| `src/shared/funil.ts` | 107 (1), 110 (2) |
| `src/shared/funil-proposta.ts` | 111 (2), 113 (3) |
| `features/funil/funilStore.ts`, `funilFormat.ts`, `test/renderer/funil-format.test.ts` | 110 (2, só o store), 112 (3), 119 (4), 114 (5) |
| `features/funil/FunilScreen.tsx` | 112 (3), 119 (4), 114 (5) |
| `test/fixtures/fake-acp-agent.mjs` | 111 (2), 117 (7) |

Mesma wave: zero dependência e zero arquivo em comum, no máximo 3 contratos. Nenhum contrato de UI começa sem o artboard dele aprovado pelo Andrew.

## Gates

Em todo contrato, na raiz do worktree (o script `gates` está no `package.json` da raiz): `cd <worktree> && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde (typecheck node, preload e web; eslint `--max-warnings 0`; vitest; build; smoke; nenhum literal de cor fora de `tokens.css`; `check-shapes.sh`; pytest da ponte). Smoke instável fora do escopo: rodar de novo e dizer no relatório.

**Ajuste mecânico liberado**: testes existentes que quebrarem só porque um tipo ganhou campo obrigatório (`AppSettings.funil` no 109, `Agent.funil` no 115, `ChatSources.funil` e os `ChatAction` novos no 117) podem ser ajustados no próprio contrato, acrescentando o campo com o valor padrão, sem mudar a asserção; o relatório lista cada arquivo de teste mexido assim.

Testes vitest novos exigidos por contrato:

| Contrato | Testes |
|---|---|
| 107 | `test/funil-store.test.ts` (CA1 a CA3), `test/funil-logic.test.ts` (CA4) |
| 108 | `test/funil-import.test.ts` (CA5) |
| 109 | `test/settings-store.test.ts` (CA10) |
| 110 | `test/funil-sugestoes.test.ts` (CA6), `test/funil-timeline.test.ts`, `test/funil-service.test.ts`; `test/lock-ipc.test.ts` verde |
| 111 | `test/funnel-extract.test.ts` (CA9) |
| 112 | `test/renderer/sidebar-stack.test.ts` (CA7), `test/renderer/funil-format.test.ts`; `test/assistant.test.ts` (guia) verde |
| 113 | `test/funil-proposta.test.ts` |
| 119 | `test/renderer/funil-format.test.ts` (casos novos) |
| 115 | `test/funil-markdown.test.ts`, `test/funil-alerts.test.ts`, `test/automations-runner.test.ts`, `test/automations-service.test.ts` |
| 114 | `test/renderer/funil-format.test.ts` (casos novos) |
| 116 | nenhum novo obrigatório (smoke) |
| 117 | `test/assistant.test.ts` (CA8), `test/chat.test.ts` |
| 118 | nenhum |

## Fechamento

Por contrato: `implementador` (Opus, só o contrato e este plan) → gates verdes → `revisor` cego (Opus, diff + contrato) → no máximo uma devolução → commit pelo agente de commits (nunca `git commit` à mão) → merge do `funil-<NN>` na `funil-vendas` (waves 1 a 4) → linha datada no Andamento da nota-índice do cofre. Ao fim da wave 8: merge da `funil-vendas` na main, build local (`.dmg` sem tag, sem release), teste navegado numa **sessão nova** com a skill `relatorio-teste-navegado` seguindo "Verificação end-to-end" da spec, correções em contrato próprio se houver, e só então `git mv docs/specs/funil-vendas docs/specs/_archive/funil-vendas` com `status: arquivado` (passo do coordenador, depois do teste navegado).

## Cobertura

| Regra | Contrato |
|---|---|
| R1 (escrita atômica e backup diário) | 107 |
| R2 | 107 |
| R3 | 107 (normalizar e comparar), 110 (comparação no WhatsApp) |
| R4 | 107 (store, desarquiva), 110 (importação e "+ Contato" pelo serviço) |
| R5 | 107 (ligação automática), 114 (sugestão na ficha) |
| R6 | 107 (store), 112 (arrastar), 119 (Select de etapa, marcar ganha/perdida) |
| R7 | 107 (cálculo), 110 (`ultimas`), 112 (marcador), 115 (alerta e `FUNIL.md`) |
| R8 | 110 |
| R9 | 107 (modelo `emails`), 110 (linha do tempo) |
| R10 | 110 |
| R11 | 110 (lógica e canal), 114 (tela) |
| R12 | 110 (lógica e canal), 114 (tela) |
| R13 | 110 (diálogo e fixture), 114 (botão e tela) |
| R14 | 108 (leitura), 114 (Selects de mapeamento) |
| R15 | 108 |
| R16 | 108 (módulo puro), 110 (confirmar e contagens), 114 (resultado) |
| R17 | 112 |
| R18 | 112 |
| R19 | 112 (marcador e texto base), 117 (cartões e fonte), 118 (revisão final) |
| R20 | 117 |
| R21 | 112 |
| R22 | 112 |
| R23 | 112 |
| R24 | 112 |
| R25 | 112 (`SearchPicker` e aviso de duplicata), 114 e 119 (uso do `SearchPicker`) |
| R26 | 112 |
| R27 (inclui Arquivar) | 107 (store), 110 (canal), 119 (tela), 114 (fichas mostram as arquivadas) |
| R28 | 112 (`compose` e navegação), 119 (ações) |
| R29 | 110 (linha do tempo), 119 (abas) |
| R30 | 114 |
| R31 | 114 |
| R32 | 114 |
| R33 | 114 |
| R34 | 114 |
| R35 | 116 |
| R36 | 116 |
| R37 | 116 |
| R38 | 111 (passada e rebaixamentos), 113 (disparo fora do smoke e evento) |
| R39 | 113 (aplicar, nota "Citados na reunião"), 116 (cartão, e-mail por contato, aviso de duplicata) |
| R40 | 113 (canal), 116 (botão) |
| R41 | 115 (conteúdo de `FUNIL.md`), 117 (fonte desligada por padrão e `SourcesSection`) |
| R42 | 117 |
| R43 | 117 |
| R44 | 115 |
| R45 | 115 (Switch e pasta), 117 (smoke do "Pedir agora") |
| R46 | 109 |
| R47 (inclui `scribe:funil-oportunidade-archive`) | 110 (canais do funil), 113 (canais e evento da proposta), 117 (canal do cartão) |

| CA | Contrato |
|---|---|
| CA1 | 107 |
| CA2 | 107 |
| CA3 | 107 |
| CA4 | 107 |
| CA5 | 108 |
| CA6 | 110 |
| CA7 | 112 |
| CA8 | 117 (o marcador do guia já entra no 112) |
| CA9 | 111 |
| CA10 | 109 |
| CA11 | 112 |
| CA12 | 112 |
| CA13 | 119 |
| CA14 | 114 |
| CA15 | 116 |
| CA16 | 117 (`assistente-funil`), 109 (`configuracoes-geral`) |
| CA17 | 109, 112, 119, 114, 116, 117 (cada um ajusta `expectedShots`), 118 (total e gates finais) |

## Gaps identificados

Copiado da seção homônima da spec (revisão cega da documentação em 20/11/2026). Os seis primeiros **entraram na spec** por serem baratos e de impacto direto no uso diário; os demais ficam para a versão seguinte.

Incorporados (já refletidos nas regras e nos contratos):
1. Telefone brasileiro com DDI, 0 de tronco e nono dígito (R3): sem isso a deduplicação falha em CSV real. Contrato 107.
2. Arquivar oportunidade fechada e limitar Ganhas/Perdidas a 90 dias por padrão (R23, R27): o kanban não acumula lixo com o tempo. Contratos 107, 110, 112, 119.
3. Backup diário de `funil.json` com 7 cópias (R1): hoje nada desfaz uma exclusão. Contrato 107.
4. Fonte Funil do Assistente desligada por padrão (R41): privacidade de contatos e telefones. Contrato 117.
5. Aviso de duplicata ao criar oportunidade para empresa que já tem uma aberta (R25, R39). Contratos 112, 116.
6. Previsão vencida marcada no cartão (R23). Contrato 112.

Versão seguinte:
7. Importar do **Contatos do macOS** (helper Swift novo + permissão, como o `lap-calendar`).
8. Detecção de oportunidade em **e-mail e WhatsApp**, não só em reunião.
9. **Lembrete a partir do próximo passo** (um clique cria o `ScheduledTask` com `reminder`).
10. Campo **fonte do lead** (indicação, site, evento, prospecção) e relatório por fonte.
11. **Exportar** contatos e oportunidades em CSV.
12. **Busca global** (reuniões, e-mails, contatos e oportunidades numa caixa só).
13. **Desfazer** e **mesclar contatos à mão**.
14. Previsão de vendas ponderada por etapa (probabilidade por coluna).
15. E-mail novo redigido pelo Assistente (cartão `email-novo`), hoje só resposta.

## Pendências

Levantadas no fechamento (contrato 118) e na auditoria dos prints de 21/11/2026 (`auditoria-prints.md`, base `main a4b62ad`). Nenhuma impede o teste navegado; as de tela entram num contrato de correção depois dele, junto com o que o teste achar.

### Da auditoria dos prints

1. **Título da oportunidade cortado no detalhe (bloqueador).** `funil-oportunidade-*`: "Loja virtual" vira "Loja vi…" ao lado do `Select` de etapa, com a linha quase vazia. O invólucro do `EditableTitle` (`max-w-full min-w-0`) encolhe e o `Select` fica com o espaço (mínimo de 240 px). Provável: `features/funil/OportunidadeScreen.tsx`, linhas ~479–488.
2. **Placeholder da busca do kanban cortado (menor).** `funil-oportunidades-*`, `-nova-*` e `-editar-etapas-*`: "Buscar oportunidades" perde o "s" final, encostado no "⌘F", sem reticências. Provável: rótulo do `SearchField` em `features/funil/OportunidadesScreen.tsx:486`.
3. **Select de mapeamento cortado na importação (menor).** `funil-contatos-importar-*`: a coluna Empresa mostra "Empresɛ"; a seta nativa e o `px-2.5` não cabem em ~150 px. Provável: `features/funil/ImportarPainel.tsx:129–133`.
4. **"×" de apagar etapa em todas as colunas (menor).** `funil-oportunidades-editar-etapas-*`: o "×" aparece desabilitado também nas etapas com cartões e, no escuro, parece clicável. R26 e o artboard 03 só o mostram na etapa aberta vazia. Provável: `features/funil/OportunidadesScreen.tsx`, linhas ~297–305.
5. **"+ Contato" abaixo do remetente no Email (menor).** `email-leitura-contato-*`: o botão quebra para uma linha própria sob o nome e o endereço, e R36 pede "ao lado do remetente". Provável: linha do remetente em `features/email/ReadingPane.tsx:259–268`, com `features/funil/ContactLink.tsx`.

### Já conhecidas

6. **Smoke do 112 não restaura `funil.json` inteiro entre blocos.** Em `funilKanbanChecks` (`src/main/smoke.ts`), `op-portal` e `op-consultoria` saem de um bloco com eventos extras e os levam para os blocos seguintes. Os checks passam hoje, mas os blocos ficam dependentes da ordem em que rodam.
7. **`notesDetail` do contrato 13 oscila sob carga.** Em `notesDetailEdits` (`src/main/smoke.ts`, ~l. 2108), `savedAfterMs` é medido depois do round-trip do `evaluate`, então o tempo inclui a latência do próprio smoke e o limite de 400 ms às vezes falha sem defeito no app.
8. **Smoke exige a tela do Mac acesa e desbloqueada por cerca de 20 minutos.** Com a tela bloqueada, as capturas falham (foi o que adiou estes entregáveis do 118). Rodar com `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` e sem bloquear a tela.
9. **Arquivamento da spec depois do teste navegado.** `git mv docs/specs/funil-vendas docs/specs/_archive/funil-vendas` com `status: arquivado` é passo do coordenador, depois do teste navegado em sessão nova (wave 8, ver "Fechamento").
