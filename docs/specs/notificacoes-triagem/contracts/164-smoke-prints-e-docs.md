# Contrato 164 — Smoke da triagem e das Notificações, telas obrigatórias, docs permanentes e artboards

Feature: notificacoes-triagem  ·  Wave: 4  ·  Depende de: 160, 161, 162, 163

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- 160–163 commitados; gates rápidos verdes. O gate completo (`pnpm gates` da raiz, smoke ~25 min, tela do Mac desbloqueada, nada pesado em paralelo) é rodado **pelo coordenador** depois deste contrato; o implementador roda só os gates rápidos e, se quiser validar um check isolado, `pnpm --filter desktop smoke` **apenas** se existir um modo de filtrar por grupo (ler `scripts/smoke.mjs`); senão, não rodar.
- Nunca deixar nada além de `smoke` em `apps/desktop/out/` (o `pack.sh` empacota a pasta inteira).

## Contexto mínimo
O smoke (`apps/desktop/src/main/smoke.ts`) roda o app com `userData` temporário, a ponte falsa do WhatsApp (`smoke-fixtures.ts`) e o Claude falso `apps/desktop/test/fixtures/fake-claude.mjs`, que decide a resposta pelo **prefixo do `--system-prompt`** (ex.: l.311 "Você responde mensagens de WhatsApp" para o atendimento). Grupos de checks (`whatsappChecks` l.6279, `atendimentoChecks` l.7357, chamados em sequência ~l.17939); `interface Check {ok; detail}`; capturas `capture(win, ctx.outDir, 'nome-light'|'-dark')` e a lista obrigatória `SCREENS` (l.274). O system prompt da triagem começa pelas instruções do agente (modelo pronto: "Você faz a triagem de conversas do WhatsApp"); a entrada tem a linha "Contato do funil de vendas: sim|não" e o bloco `<conversa>`.

## Superfície
- `apps/desktop/test/fixtures/fake-claude.mjs`: ramo para `systemPrompt.startsWith('Você faz a triagem de conversas do WhatsApp')` → JSON `{ urgente, ambito, motivo }` determinístico: `urgente = /hoje|urgente|prazo/i.test(input)`, `ambito = /Contato do funil de vendas: sim/.test(input) ? 'profissional' : 'pessoal'`, `motivo: 'pede o orçamento até hoje'` ou `'conversa casual'`. Se o Assistente do smoke gera blocos `lap-acao` por palavra-chave do pedido (ver como `tarefa-criar`/`instagram-rascunho` são provocados), acrescentar: pedido contendo "marque como urgente" → bloco `{"tipo":"triagem-etiqueta","chatId":<id da conversa citada>,"urgente":true}`; pedido contendo "crie o agente de triagem" → `{"tipo":"triagem-agente","acao":"criar"}`.
- `apps/desktop/src/main/smoke.ts`: `async function triagemChecks(ctx, watch, checks, shots)` chamado logo depois de `atendimentoChecks`; `ctx` ganha o que precisar (store/serviço da triagem, automações, settings) no mesmo molde de `ctx.atendimento`. `SCREENS` ganha os 5 pares abaixo. `smoke-fixtures.ts` só se precisar de um contato do funil para a conversa da Ana (telefone igual ao do fixture) ou de injetar mensagens (reutilizar o mecanismo que `atendimentoChecks` usa).
- Docs permanentes: `README.md` (raiz), `apps/desktop/resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/README.md` + `docs/telas/artboards/Notificacoes.dc.html` e `docs/telas/artboards/WhatsAppTriagem.dc.html` (+ entradas em `canvas.json` se o padrão exigir), copiados/adaptados de `docs/specs/notificacoes-triagem/mockups/NotificacoesTriagem.dc.html` (quadros 01 e 03).

### Checks (`triagem.*`), em ordem; `detail` só com números e booleanos
1. `semAgente`: abrir WhatsApp, clicar `[data-triagem-aba-opcao="urgentes"]` → `[data-triagem-vazio="sem-agente"]` existe; `shot('whatsapp-triagem-vazio-light')` e `-dark`. Clicar `[data-triagem-criar]` → `automations.listTasks()` tem 1 tarefa `whatsapp-message` habilitada com `agentName === 'Triagem do WhatsApp'`; a rota vai a Automações › Agendamentos. Abrir a tarefa para edição e `shot('automacoes-tarefa-whatsapp-light')`/`-dark` com `[data-task-frequency="whatsapp-message"]`, `[data-task-espera]`, `[data-task-grupos]`, `[data-task-whatsapp-aviso]` presentes e `[data-task-preview]` ausente. Salvar a tarefa com `esperaSeg: 5` (mínimo) para o resto do smoke.
2. `unicidade`: tentar salvar uma segunda tarefa `whatsapp-message` habilitada pela API das automações → `{ok:false}`; `detail: recusada=true`.
3. `triagem`: injetar 3 mensagens recebidas na conversa da Ana (contato do funil no fixture), com "preciso do orçamento até hoje" numa delas, em < 5 s; aguardar até 20 s: etiqueta da Ana com `urgente:true`, `ambito:'profissional'`, `origem:'agente'`; runs com `trigger:'whatsapp'` = 1 (prova o debounce: 3 mensagens → 1 chamada); `run.prompt` não contém "orçamento" (`promptSemTexto=true`); `run.status === 'ok'`. Na tela: linha da Ana com `[data-triagem-chip="urgente"]` antes de `[data-triagem-chip="profissional"]`; contagem "(1)" em Urgentes.
4. `notificacoes`: navegar a `/notificacoes`: número de `[data-notificacao^="whatsapp:"]` = chats com `unread > 0` (grupos conforme `whatsappNotifyGroups` do fixture); número de `[data-notificacao^="email:"]` = `!seen` das Entradas falsas; badge `[data-nav="notificacoes"] [data-nav-badge]` = soma; linha da Ana com chip Urgente; `shot('notificacoes-light')`/`-dark`. Clicar `[data-notificacao-lida]` da primeira linha de e-mail → a linha some e o badge cai 1. Clicar a linha da Ana → rota `/whatsapp` com `[data-whatsapp-conversation="<id da Ana>"]`.
5. `manual`: na conversa da Ana, clicar Pessoal em `[data-triagem-ambito]` → etiqueta `ambito:'pessoal', ambitoFixo:true`; `shot('whatsapp-triagem-light')`/`-dark` com a aba Todas, chips nas linhas e a barra `[data-triagem-bar]` visível. Injetar 1 mensagem recebida ("tudo bem?") → após nova triagem, `ambito` continua `'pessoal'`, `urgente` conforme o falso (`false`), runs = 2.
6. `respondeu`: injetar mensagem `fromMe` → `urgente:false` sem run nova (runs = 2). Clicar `[data-triagem-urgente]` → `urgente:true, urgenteFixo:true` sem run nova.
7. `assistente`: no Assistente, pedir "marque a conversa com a Ana como urgente" → cartão `[data-chat-action-kind="triagem-etiqueta"]`; `shot('assistente-cartao-triagem-light')`/`-dark`; clicar "Aplicar" → etiqueta `urgente:true`, cartão `done`. Se o mecanismo de blocos do falso não permitir, provocar o cartão pelo mesmo caminho que o smoke usa para `tarefa-criar` e registrar no relatório.
8. `desligado`: `settings.whatsappTriagem = false`; injetar mensagem recebida → nenhuma run nova em 8 s; aba Urgentes mostra `[data-triagem-vazio="desligado"]` quando vazia (limpar a etiqueta da Ana antes com `set({urgente:false, ambito:null})`); religar.
9. `privacidade`: `JSON.stringify(checks)` (todos os `detail` do grupo) não contém "orçamento" nem "Ana" → `detailLimpo=true`. Também: nenhuma linha do `devLog` do smoke com esses termos vinda de `[triagem]`.

### Docs
- `README.md`: parágrafo "### Notificações: tudo o que não foi lido" depois de "### Início"; em "### WhatsApp pessoal" (Experimental), o subtítulo "Triagem por agente" (abas, etiqueta reversível, agente das Automações com gatilho "quando chega mensagem", só etiqueta, interruptor, custo: uma chamada curta por conversa com mudança); em "## Privacidade e segurança", a frase: só as últimas mensagens da conversa que recebeu a mensagem vão ao modelo escolhido; as etiquetas ficam em `triagem.json` no seu Mac e saem ao remover o WhatsApp; nada é enviado.
- `guia-do-app.md`: seção "Notificações" já existe (160); acrescentar em "WhatsApp" as abas, os chips, a barra da etiqueta e "Triar agora"; em "Automações" o gatilho "Quando chega mensagem do WhatsApp" e o gatilho "WhatsApp" nas Execuções; em "Assistente" os cartões `triagem-agente`/`triagem-etiqueta` e "abrir notificações"; em "Configurações › Claude" o interruptor; em "Privacidade" a frase acima. O teste do guia continua verde.
- `design.md`: em "## Telas" a tela Notificações (item plano, linhas de 44 com duas linhas de texto, segmentado de origem) e as mudanças do WhatsApp (segmentado de triagem em **duas linhas** como exceção documentada por falta de largura; barra da etiqueta de 44 sob o cabeçalho; chips de 20 px raio 4 na linha da prévia); em "## Controles e densidade" o chip de etiqueta (20 px) ao lado do chip existente de 24.
- `docs/telas/README.md`: linhas dos dois artboards novos.

## Critérios de aceite
- CA1: `triagemChecks` existe, é chamado depois de `atendimentoChecks`, e os 9 checks acima estão em `report.json` com `ok: true` numa rodada completa do `pnpm gates` (verificado pelo coordenador).
- CA2: `SCREENS` contém `notificacoes-light/dark`, `whatsapp-triagem-light/dark`, `whatsapp-triagem-vazio-light/dark`, `automacoes-tarefa-whatsapp-light/dark`, `assistente-cartao-triagem-light/dark`, e os 10 PNG saem em `out/smoke/`.
- CA3: Nenhum `detail` de `triagem.*` contém texto de mensagem, nome de contato ou motivo (check 9 e grep do coordenador no `report.json`).
- CA4: `fake-claude.mjs` devolve JSON válido para o prefixo da triagem e o teste `triagem-classify` continua verde; os testes do falso (se houver) cobrem o ramo novo.
- CA5: Docs: `grep -n "Notificações" README.md guia-do-app.md design.md docs/telas/README.md` encontra as seções; `grep -n "Triagem" README.md` encontra a subseção e a frase de privacidade; o teste do guia e os gates rápidos ficam verdes.
- CA6: `docs/telas/artboards/Notificacoes.dc.html` e `WhatsAppTriagem.dc.html` abrem a 1120×740 e seguem o padrão dos vizinhos (`<dc-import>` da barra, tokens).

## Invariantes
- Checks existentes (`whatsapp.*`, `atendimento.*`, `automations.*`, `assistant.*`, `inicio.*`, `email.*`) continuam verdes; nenhuma captura existente renomeada.
- Nada é gravado em `apps/desktop/out/` fora de `out/smoke/`.
- Sem alteração de comportamento do app (este contrato só prova e documenta); mudanças em `src/` fora de `smoke*.ts` só se um check revelar defeito, e aí **parar e relatar** em vez de corrigir.

## Fora de escopo
- Auditoria dos prints (coordenador + agente auditor, depois do gate completo); versão, `pack.sh`, instalação, arquivamento (coordenador).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Gate completo pelo coordenador.

## Relatório esperado
≤ 40 linhas: checks escritos (nomes), como injetou mensagens e provocou o cartão, telas em `SCREENS`, docs tocadas, qualquer check que você não conseguiu escrever e por quê.
