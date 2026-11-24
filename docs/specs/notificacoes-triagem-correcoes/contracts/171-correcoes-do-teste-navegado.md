# Contrato 171 — Correções do teste navegado da triagem (0.25.1)

Feature: notificacoes-triagem-correcoes  ·  Wave: 1  ·  Depende de: — (base `8b55751`)

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato. Spec de origem para comportamento: `docs/specs/_archive/notificacoes-triagem/spec.md` (R1–R28, N1–N8).

## Pré-condições
- Árvore principal limpa em `8b55751` ou posterior; gates rápidos verdes antes de começar.
- Não rodar `pnpm gates` (smoke ~25 min): é do coordenador. O implementador roda só os gates rápidos.
- Não commitar. Não tocar em `apps/desktop/out/` fora de `out/smoke/`.

## Contexto mínimo (todos os caminhos em `apps/desktop/src/`)
- Estado vazio das abas: `renderer/src/features/whatsapp/WhatsAppScreen.tsx:1013` e `:1037-1043` (`TriagemVazia`) só reconhece `status.motivo` `'desligado'` e `'sem-agente'`; o main já manda `'pausado'` (`main/whatsapp/triagem/service.ts:187-191` → `main/schedules/service.ts:685-693 triagemSituacao`) e o renderer recebe por `scribe:triagem-status-changed` (`triagemStore.ts:83`).
- "Triar agora": `main/whatsapp/triagem/service.ts:369-384 runNow` → `enfileirar({chatId, manual:true})` → `triar` (`:290-329`); o `onMessage` (`:352-354`) filtra grupo por `schedule.grupos`, o `runNow` não. `prompt` montado em `runBase` (`:230-250`, l.244). Erros: `TriagemRunError` (`:41`), canal em `shared/ipc.ts:764`, textos em `renderer/src/features/whatsapp/triagemStore.ts:15-22`. Timeout `TRIAGEM_TIMEOUT_MS` = 30 s.
- "Rodar agora"/"Rodar de novo": `renderer/src/features/schedules/SchedulesTab.tsx:136-140,191-194`, `RunsTab.tsx:143-157`; main `main/schedules/service.ts:911-914 runNow`, `:935-939 rerun`, `:695-706 startTask` (o tick já exclui `whatsapp-message` em `:624`).
- "Marcar como lida": `renderer/src/features/notificacoes/NotificacaoRow.tsx:103` (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`); padrão do app `group-focus-within:opacity-100` (`features/chat/ChatHistory.tsx:209`, `features/whatsapp/WhatsAppScreen.tsx:175`).
- Motivo: `TRIAGEM_MOTIVO_MAX=160` em `shared/triagem.ts:21`; cortes em `main/whatsapp/triagem/classify.ts:134` e `shared/triagem.ts:108` (`aplicarAgente`); system prompt em `classify.ts:91`; teste `test/triagem-logic.test.ts:85-88` espera `toHaveLength(160)`.
- Barra da etiqueta: `renderer/src/features/whatsapp/EtiquetaBar.tsx:72` (`flex h-11 … gap-2.5 px-5`), aviso em `:87-92` (`block truncate text-right text-12 text-rec`), `running`/"Triando…" em `:27,50-69,96`.
- TaskForm: `renderer/src/features/schedules/TaskForm.tsx` — `whatsappTrigger` (`:174`), hint da Frequência (`:249`, `describeSchedule`), Saída (`:290-298`), Reunião do post-it (`:303-307`), `<EmailSection>` (`:309`, `:376+`); `describeSchedule` em `shared/automations.ts:650-651`.
- Título "Claude": `renderer/src/features/chat/ChatMessages.tsx:253-260 AssistantHeader` (usado em `:280,:292,:335`); detalhe da execução `renderer/src/features/agents/parts.tsx:77-85 RunAnswer` com `finished: AutomationRun` (`agentName` em `shared/automations.ts:215`, preenchido pela triagem em `service.ts:236`).
- Modelo pronto "Triagem do WhatsApp": `EXAMPLE_AGENTS` em `shared/automations.ts` (instruções do agente).
- Smoke: `main/smoke.ts` — `triagemChecks` (checks `semAgente` ~l.7851, `desligado` ~l.8109, hover de "Marcar como lida" ~l.8186-8193).

## Superfície

### C1 — estado vazio com tarefa pausada (R12)
- `WhatsAppScreen.tsx` (`TriagemVazia` e o cálculo da l.1013): `motivo === 'pausado'` → mesmo texto de `'sem-agente'`. Botão: se `status.tarefaId` → "Abrir Automações" (`useAutomations.getState().setTab('tarefas')` + navegar a Automações, mesmo caminho que o "Criar agente" usa depois de criar); senão → "Criar agente de triagem" (como hoje). Atributos: `data-triagem-vazio="sem-agente"` nos dois casos e `data-triagem-vazio-acao="abrir"|"criar"`.
- Se `TriagemStatus` não expõe `tarefaId`, acrescentar no tipo (`shared/ipc.ts` / `service.ts computeStatus`) — ele já existe em `triagemSituacao`.

### C2 — "Triar agora" respeita grupos
- `service.ts runNow`: depois de `refreshStatus`, obter a tarefa ativa (`deps.automations.triagemSituacao()`); se `isGroupChat(chatId) && task?.schedule.kind === 'whatsapp-message' && !task.schedule.grupos` → `{ ok:false, error:'grupos' }` sem enfileirar.
- `TriagemRunError` += `'grupos'`; `shared/ipc.ts:764` idem; `TRIAGEM_RUN_ERRORS.grupos = 'Grupos estão fora da triagem. Ligue “Incluir grupos” na tarefa.'`.

### C3 — execução manual distinguível
- `runBase(…, manual)`: `prompt` = `` `Triagem da conversa ${chatName} · ${n} mensagens novas${manual ? ' · Triar agora' : ''}` ``. Passar `manual` de `triar` (`:310`); `registrarTeto` (`:263`) continua sem sufixo. `trigger` não muda.

### C4 — sem "Rodar agora"/"Rodar de novo" na triagem
- `main/schedules/service.ts startTask`: `if (task.schedule.kind === 'whatsapp-message') return { ok:false, error:'invalid' }` (antes de enfileirar; cobre `runNow` e `rerun`).
- `SchedulesTab.tsx`: não renderizar `task-run-now` quando `task.schedule.kind === 'whatsapp-message'` (Editar/Duplicar/Excluir continuam).
- `RunsTab.tsx RunDetail`: não renderizar `run-again` quando `shown.trigger === 'whatsapp'`.

### C5 — "Marcar como lida" no foco da linha
- `NotificacaoRow.tsx:103`: acrescentar `group-focus-within:opacity-100` (manter `group-hover:` e `focus-visible:`). Atualizar o comentário da l.44 se citar só hover.

### C6 — motivo cortado na palavra
- `shared/triagem.ts`: `export function cortarMotivo(s: string, max = TRIAGEM_MOTIVO_MAX): string` — `s.length <= max` → `s`; senão corta em `max - 1`, recua até o último espaço se ele estiver além de 60% do limite, `trimEnd()` e acrescenta `…` (resultado ≤ max). Usar em `aplicarAgente` (`:108`) e em `classify.ts:134` no lugar dos `slice`.
- `classify.ts:91` (system prompt): `"motivo": "por que, em poucas palavras"` → `"motivo": "por que, em até 120 caracteres"`.
- `test/triagem-logic.test.ts:85-88`: ajustar para `length <= 160` e `endsWith('…')` no caso de 300 caracteres; acrescentar caso com espaços provando corte na palavra inteira.

### C7 — aviso sem truncar
- `EtiquetaBar.tsx`: barra `flex min-h-11 items-center gap-2.5 px-5 py-1` (sai `h-11`); o aviso passa de `block truncate` para `line-clamp-2 leading-4 text-right text-12 text-rec` (manter `title`). Controles `shrink-0` como estão. Conferir visualmente com o painel Detalhes aberto na largura padrão da janela (1470) — o texto "A triagem está desligada em Configurações." tem de aparecer inteiro em até 2 linhas.

### C8 — TaskForm no gatilho WhatsApp
- Hint da Frequência quando `whatsappTrigger`: `` `Roda em cada conversa que recebe mensagem, ${frequency.esperaSeg} s depois da última. ${frequency.grupos ? 'Inclui grupos.' : 'Grupos ficam de fora.'}` `` (o `WHATSAPP_TRIGGER_NOTICE` continua).
- `{!whatsappTrigger && …}` em torno do select Saída, da "Reunião do post-it" e do `<EmailSection>`. Ao trocar o kind para `whatsapp-message`: `output: null`, `emailDraft.on = false` (ou o campo equivalente), para não salvar valor antigo.
- `test/renderer/schedules-frequency.test.ts` segue verde; acrescentar teste do hint se o arquivo cobrir hints.

### C9 — nome do agente no detalhe da execução
- `ChatMessages.tsx AssistantHeader` e `AssistantMessage`: prop opcional `author?: string` (padrão `'Claude'`). `parts.tsx RunAnswer`: passar `author={finished?.agentName ?? 'Claude'}`. O Assistente e `LiveAssistantMessage` não passam nada.

### C10 — "Triando…" até terminar
- `service.ts triar`: no `finally`, emitir `scribe:triagem-done { chatId, ok: boolean }` (canal novo em `shared/ipc.ts`, broadcast só com app desbloqueado, como `triagem-changed`). Também emitir quando `runNow` recusa? Não — a recusa já volta síncrona.
- `triagemStore.ts`/`EtiquetaBar.tsx`: `running` fica `true` após `{ok:true}` e cai em `triagem-done` daquela `chatId` ou após 35 s (`setTimeout` limpo no unmount).

### C11 — instruções do modelo pronto
- `EXAMPLE_AGENTS` "Triagem do WhatsApp": acrescentar às instruções, em português e sem mudar o formato de saída: "Contato do funil pende para profissional mesmo em conversa informal. Urgente só com pedido explícito e prazo, cobrança de resposta ou problema em andamento; conversa só com anexos, mensagens automáticas (saldo, notificação, robô) ou sem pedido não é urgente." O `fake-claude.mjs` decide pelo prefixo "Você faz a triagem de conversas do WhatsApp": manter esse começo.

### Smoke (`main/smoke.ts`, grupo `triagemChecks`)
- Novo check `pausado` logo depois de `semAgente`: desabilitar a tarefa criada (`automations.updateTask`/toggle usado pelo app), abrir a aba Urgentes com etiquetas limpas → `[data-triagem-vazio="sem-agente"][data-triagem-vazio-acao="abrir"]` existe; clicar → rota Automações › Agendamentos; reabilitar a tarefa. `detail` só booleanos.
- Novo check `manualGrupo`: `runNow` num chat de grupo do fixture com `grupos=false` → `{ok:false, error:'grupos'}` e runs inalteradas.
- `manual` (já existe): conferir `run.prompt.endsWith('· Triar agora')` na run gerada por `runNow`; as automáticas não terminam assim.
- `notificacoes`: além do hover (l.8186-8193), focar a primeira linha de e-mail por teclado (`focus()` no botão da linha) → `[data-notificacao-lida]` com `opacity` 1.
- `automacoes`/tela `automacoes-tarefa-whatsapp-*`: `[data-task-output]` (ou o seletor do select Saída) e `section[aria-label="Pode enviar email"]` ausentes no gatilho WhatsApp.

### Docs
- `apps/desktop/resources/assistente/guia-do-app.md` e `README.md`: só se citarem "Rodar agora" para a triagem ou o texto antigo do hint; caso contrário, nada. `docs/specs/desktop-shell/design.md`: nota de que a barra da etiqueta tem altura mínima 44 e o aviso pode ocupar 2 linhas.

## Critérios de aceite
- CA1: com a tarefa `whatsapp-message` `enabled=false`, a aba Urgentes vazia mostra o texto de "sem agente" e o botão "Abrir Automações", que leva a Agendamentos; com a tarefa ligada volta "Nenhuma conversa aqui."; sem tarefa, "Criar agente de triagem" como antes (smoke `pausado` + `semAgente` verdes).
- CA2: `runNow` em grupo com `grupos=false` devolve `error:'grupos'`, não cria run, e a barra mostra o texto; com `grupos=true` tria normalmente (teste unitário + smoke `manualGrupo`).
- CA3: run manual tem `prompt` terminando exatamente em "· Triar agora"; runs automáticas não; `hojeTrigger('whatsapp')` conta as duas (teste em `triagem-service.test.ts`).
- CA4: `startTask` recusa `whatsapp-message` com `error:'invalid'` (teste); `SchedulesTab` não mostra `task-run-now` para esse kind e `RunDetail` não mostra `run-again` para `trigger:'whatsapp'` (teste de renderer ou smoke).
- CA5: smoke `notificacoes` prova opacidade 1 no foco por teclado da linha.
- CA6: `cortarMotivo` testado (≤160, termina em "…", corta em palavra inteira, não altera texto curto); `etiquetaSchema` aceita o resultado; prompt pede "até 120 caracteres".
- CA7: aviso da barra legível inteiro com Detalhes aberto (print `whatsapp-triagem-*` ou check de `scrollWidth <= clientWidth` do elemento do aviso no smoke com um erro provocado).
- CA8: no gatilho WhatsApp, Saída/post-it/e-mail não renderizam e o hint traz a espera e a frase dos grupos; tarefa salva nesse gatilho tem `output` nulo e sem e-mail.
- CA9: detalhe de uma run da triagem mostra "Triagem do WhatsApp" como autor; o Assistente continua "Claude".
- CA10: `scribe:triagem-done` emitido em sucesso, falha e timeout (teste do serviço); `running` cai no evento (teste do store ou smoke).
- CA11: instruções do modelo pronto contêm as duas frases e começam pelo prefixo que o `fake-claude.mjs` reconhece; `triagem-classify` e o smoke continuam verdes.
- CA12: gates rápidos verdes; `pnpm gates` completo verde (coordenador); nenhum `detail` do smoke com texto de mensagem.

## Invariantes
- N1–N8 da spec de origem; nenhum caminho novo de envio; `trigger:'whatsapp'` e teto diário intactos; debounce intacto.
- Textos das telas em pt-BR, sem literal de cor fora de `tokens.css`, sem raio > 6 nem sombra nova (gates 6 e 7).
- Checks existentes do smoke continuam verdes; nenhuma captura renomeada.
- `fake-claude.mjs`: prefixo do system prompt da triagem inalterado.

## Fora de escopo
- Custo do Assistente; pendência das 500 runs; qualquer mudança no `EmailScreen` ou em `main/email/*`; versão, `pack.sh`, release e arquivamento (coordenador).

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Gate completo pelo coordenador.

## Relatório esperado
≤ 40 linhas: por item C1–C11, arquivo e o que mudou; testes novos/ajustados (nomes); checks do smoke escritos; qualquer item não feito e por quê; `git diff --stat`.
