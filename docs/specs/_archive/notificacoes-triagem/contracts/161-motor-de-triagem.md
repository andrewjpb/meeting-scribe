# Contrato 161 — Motor de triagem no main: classificação, debounce, fila, execuções e IPC

Feature: notificacoes-triagem  ·  Wave: 2  ·  Depende de: 159

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contrato 159 commitado (tipos em `shared/triagem.ts`, store, `Schedule 'whatsapp-message'`, `RunTrigger 'whatsapp'`, `purpose 'whatsapp-triagem'`, `TRIAGEM_TEMPLATE`, `whatsappTriagem`, `contatoLigado` em `shared/funil-logic.ts`).
- Nenhuma tela muda neste contrato. Não tocar `main/email/*`, `features/email/*`, `renderer/*` (exceto nada), `main/smoke.ts`.

## Contexto mínimo
A cada mensagem recebida numa conversa do WhatsApp, se houver um agente de triagem ativo, o motor espera `esperaSeg` desde a última mensagem da conversa, chama o modelo UMA vez com as últimas mensagens da conversa e grava a etiqueta (`aplicarAgente`). A IA só etiqueta: este módulo não importa `send-guard`, não envia, não apaga, não move. Roda também com o app bloqueado; eventos ao renderer só desbloqueado.

Moldes: `main/whatsapp/atendimento/{service,reply}.ts` (deps injetadas, `setTimer`/`clearTimer`/`now` para teste, `runClaudeOneShot` com parse zod, escape em `<conversa>`, `INCOMING_MAX_AGE_MS`), `main/funil/extract.ts` (Haiku, 30 s, cancela no timeout, `dispose()`), `main/inicio/ipc.ts` (registro de handlers), `shared/ipc.ts` + `preload/index.ts` para canais.

## Superfície
- Criar `apps/desktop/src/main/whatsapp/triagem/classify.ts`: `buildTriagemPrompt(input): { systemPrompt; input }`, `parseTriagemResultado(raw): TriagemResultado | null`, `createTriagemClassifier(engine, { claudePath })` → `(input, signal) => Promise<TriagemOutcome>` com `runClaudeOneShot({ purpose: 'whatsapp-triagem', model, acpDir: ACP_TRIAGEM_DIR, timeoutMs: TRIAGEM_TIMEOUT_MS })`.
- Criar `apps/desktop/src/main/whatsapp/triagem/service.ts`: `createTriagemService(deps): TriagemService`.
- Criar `apps/desktop/src/main/whatsapp/triagem/ipc.ts`: registra os handlers.
- Alterar `apps/desktop/src/main/schedules/service.ts` (+ tipos em `shared/automations.ts` se precisar): `triagemAtiva(): Promise<{ task: ScheduledTask; agent: Agent } | null>`, `criarTriagemDoModelo(): Promise<{ ok: true; agentId; taskId } | { ok: false; error: string }>`, `salvarExecucaoExterna(run: AutomationRun): Promise<void>` (grava em `runs` e emite o mesmo evento que as runs normais emitem para a aba Execuções), e a regra de unicidade (CA7).
- Alterar `apps/desktop/src/shared/ipc.ts` (canais abaixo, todos `refused` em `WHEN_LOCKED`), `apps/desktop/src/preload/index.ts` (exposição), `apps/desktop/src/main/index.ts` (instanciar store + classifier + service; chamar no `onMessage` do WhatsApp logo depois de `atendimentoRef.current?.onMessage(...)`; `dispose()` no encerramento; registrar `createTriagemIpc`).
- Alterar `apps/desktop/src/main/whatsapp/service.ts`: nos blocos "Remover" e "Sair da conta" que apagam `insights.json`/`transcripts.json` (≈ l.654 e 670), apagar também `WHATSAPP_PATHS.triagem` e chamar `deps.onForget?.()`/equivalente para o store esquecer o cache (escolha o mecanismo que o arquivo já usa para `transcripts.forget()`).
- Criar `apps/desktop/test/triagem-classify.test.ts`, `apps/desktop/test/triagem-service.test.ts`; estender `automations-service.test.ts` (CA7, CA8).

### Canais (`shared/ipc.ts`)
```ts
'scribe:triagem-list':   { request: undefined; response: { etiquetas: Record<string, Etiqueta>; status: TriagemStatus } }
'scribe:triagem-set':    { request: { chatId: string; patch: EtiquetaPatch }; response: { ok: true; etiqueta: Etiqueta } | { ok: false; error: string } }
'scribe:triagem-run':    { request: { chatId: string }; response: { ok: true } | { ok: false; error: 'sem-agente' | 'desligado' | 'pausado' | 'sem-mensagens' | 'teto' | 'ocupado' } }
'scribe:triagem-create-from-template': { request: undefined; response: { ok: true; agentId: string; taskId: string } | { ok: false; error: string } }
// eventos (só desbloqueado): 'scribe:triagem-changed' { chatId: string; etiqueta: Etiqueta | null }  ·  'scribe:triagem-status-changed' TriagemStatus
```
`TriagemStatus` (em `shared/triagem.ts`): `{ ativo: boolean; motivo: 'sem-agente' | 'desligado' | 'pausado' | null; agenteNome: string | null; tarefaId: string | null; hoje: number; teto: number }`. `pausado` cobre tarefa `!enabled`, `autoPaused` e pausa geral dos agendamentos.

### Serviço
`TriagemServiceDeps`: `store` (159), `enabled: () => Promise<boolean>` (`settings.whatsappTriagem`), `automations: { triagemAtiva; salvarExecucaoExterna }`, `whatsapp: { lastMessages(chatId, n): Promise<WhatsAppMessage[]>; chat(chatId): Promise<WhatsAppChat | null>; ownerName(): string | null }`, `funil: { contatos(): Promise<Contato[]>; empresaNome(id): Promise<string | null> }`, `classify`, `changed(chatId, etiqueta)`, `statusChanged()`, `locked()`, `runs: { hojeTrigger(trigger): Promise<number> }` (ou `listar` e contar), `now`, `setTimer`, `clearTimer`, `log`.
`TriagemService`: `onMessage(message: WhatsAppMessage, chatName: string): Promise<void>`, `runNow(chatId)`, `list()`, `set(chatId, patch)`, `status()`, `createFromTemplate()`, `dispose()`.

Regras:
1. `onMessage` com `fromMe`: `store.set(chatId, respostaDoDono(atual))` quando havia etiqueta; `changed`; retorna. Nada mais.
2. Recebida: se `now - at > TRIAGEM_MAX_AGE_MS` → ignora. Grava `mensagemRecebida(atual)` quando havia etiqueta. Se `!(await enabled())` → ignora (sem timer). Se `triagemAtiva()` é `null` → ignora. Se `isGroupChat(chatId) && !task.schedule.grupos` → ignora. Reinicia o timer da conversa para `task.schedule.esperaSeg * 1000` (um timer por `chatId`; mensagem nova cancela o anterior).
3. Ao disparar: relê `lastMessages(chatId, TRIAGEM_MENSAGENS_MAX)`; `ultimaRecebida` = última com `!fromMe`; se não há ou `!precisaTriar(atual, ultimaRecebida.id)` → nada. Se o contador do dia ≥ `TRIAGEM_TETO_DIARIO` → grava **uma** run `failed` por dia com `error: 'Teto diário de triagens atingido'` e para. Se já há `TRIAGEM_SIMULTANEAS` em andamento → fila FIFO (uma entrada por `chatId`).
4. Entrada do classificador: `{ instructions: agent.instructions, model: agent.model, chatName, kind, ownerName, messages (≤12, texto; mídia → '[imagem]' | '[áudio]' | '[vídeo]' | '[documento]' | '[figurinha]'; total cortado em TRIAGEM_CHARS_MAX pelo começo, mantendo as mais recentes), funil: agent.funil ? { contato: boolean; empresa: string | null } : null }`. `funil.contato` por `contatoLigado(contatos, { whatsappChatId: chatId, telefone: telefoneDoChat(chat) })`.
5. Saída `ok` → `store.set(chatId, aplicarAgente(atual, resultado, ultimaRecebida.id, now))`, `changed(chatId, etiqueta)` (só desbloqueado), run `done`. Saída inválida/timeout/erro → run `failed`, etiqueta inalterada. Em ambos: contador do dia +1.
6. Run (`AutomationRun`): `taskId`, `taskName`, `agentId`, `agentName`, `trigger: 'whatsapp'`, `model: agent.model`, `costUsd` (do one-shot ou 0), `prompt: \`Triagem da conversa ${chatName} · ${n} mensagens novas\`` (n = recebidas desde `atual?.lastMessageId`; **nunca** texto de mensagem), `answer` com o texto `Etiqueta: <chips unidos por ' · ' ou 'Nenhuma'>. Motivo: <motivo>` no mesmo formato de `ChatMessage` que as runs normais usam, `meetingId: null`, `outputResult: null`.
7. `set(chatId, patch)` → `aplicarManual`, grava, `changed`, devolve. `runNow(chatId)` → ignora debounce e teto de idade, respeita `enabled`, agente, teto diário e fila; erro tipado quando não pode.
8. `status()` conforme `TriagemStatus`; `statusChanged()` quando o resultado muda (checar a cada `onMessage`/`runNow`/`createFromTemplate` e quando `automations` emite mudança de tarefas, se houver hook barato; senão só nesses momentos).
9. `createFromTemplate()` delega a `automations.criarTriagemDoModelo()`.
10. `log` só com `chatId` truncado a 8 caracteres, contagens e durações. Nenhum texto de mensagem, nome de contato ou motivo em log.
11. `dispose()` cancela timers e sinais em andamento.

### Automações (`main/schedules/service.ts`)
- `triagemAtiva()`: a tarefa com `schedule.kind === 'whatsapp-message'`, `enabled && !autoPaused`, agendamentos não pausados globalmente, agente existente → `{task, agent}`; senão `null`.
- `criarTriagemDoModelo()`: agente = o existente com `name === TRIAGEM_AGENT_NAME` ou `agents.save(TRIAGEM_TEMPLATE)`; tarefa = a existente `whatsapp-message` (reabilitada) ou nova `{ agentId, name: 'Triagem do WhatsApp', message: '', schedule: TRIAGEM_SCHEDULE_DEFAULTS, enabled: true, notify: false, output: 'notification' ou o padrão do tipo }`. Idempotente.
- Unicidade: salvar/habilitar uma tarefa `whatsapp-message` quando já existe outra habilitada → `{ ok: false, error: 'Já existe um agente de triagem ativo: <nome da tarefa>' }` no caminho de save que o renderer já usa.
- O `tick`/`due`/`missed` nunca enfileiram tarefas `whatsapp-message` (garantido pelo 159, CA6; confirmar por teste).

## Critérios de aceite
- CA1 (`classify`): `buildTriagemPrompt` com 15 mensagens usa as 12 mais recentes; mensagem de mídia sem texto vira `[imagem]`; texto contendo `</conversa>` é escapado; entrada acima de 4.000 caracteres é cortada mantendo as mais recentes; linha `Contato do funil de vendas: sim (Empresa X)` quando `funil.contato`, `não` quando `funil && !contato`, ausente quando `funil === null`; o `systemPrompt` contém as `instructions` do agente e a exigência de JSON `{urgente, ambito, motivo}`.
- CA2 (`parse`): `{"urgente":true,"ambito":"profissional","motivo":"x"}` → ok; com texto ao redor e cerca ```json → ok; `ambito: 'trabalho'` → `null`; `urgente: 'sim'` → `null`; `motivo` ausente → ok com `''`.
- CA3 (debounce): com `esperaSeg: 30` e timers falsos, 3 mensagens recebidas em t=0, 10 s, 20 s → `classify` chamado **1** vez, em t=50 s; `store.set` com `lastMessageId` da 3ª; `changed` chamado 1 vez com a etiqueta; 1 run `done` salva com `prompt === 'Triagem da conversa Ana · 3 mensagens novas'` e sem o texto das mensagens.
- CA4: mensagem `fromMe` numa conversa urgente → etiqueta com `urgente:false`, `classify` não chamado, `changed` chamado. Mensagem recebida com `at` 6 min atrás → nada. `enabled()` false → nada (nem timer). `triagemAtiva()` null → nada. Grupo com `grupos:false` → nada; com `grupos:true` → triado.
- CA5: etiqueta anterior com `ambitoFixo:true, ambito:'pessoal'` e resultado `profissional` → gravado `ambito:'pessoal'`, `urgente` do resultado. Resultado inválido → run `failed`, `store.set` não chamado, `changed` não chamado.
- CA6: contador do dia em 300 → `classify` não chamado; exatamente 1 run `failed` com `error: 'Teto diário de triagens atingido'` mesmo com 5 mensagens em 5 conversas; `status().hoje === 300`. 3 conversas disparando ao mesmo tempo com `TRIAGEM_SIMULTANEAS = 2` → a 3ª só começa quando uma termina.
- CA7 (unicidade): com uma tarefa `whatsapp-message` habilitada, salvar outra habilitada → `{ok:false, error}` com a mensagem exata; salvar a mesma (edição) → ok; salvar outra **desabilitada** → ok.
- CA8: `criarTriagemDoModelo()` duas vezes → mesmo `agentId` e `taskId`; agente com `funil:true, model:'haiku'`; tarefa `enabled:true`, `schedule` = `TRIAGEM_SCHEDULE_DEFAULTS`. `triagemAtiva()` → `null` quando a tarefa está `enabled:false` ou os agendamentos estão pausados globalmente; `status().motivo === 'pausado'` nesses casos, `'sem-agente'` sem tarefa, `'desligado'` com o interruptor off (prioridade: desligado > sem-agente > pausado).
- CA9 (IPC): `scribe:triagem-list`, `-set`, `-run`, `-create-from-template` em `INVOKE_CHANNELS` e `WHEN_LOCKED` (`refused`), expostos no preload; `scribe:triagem-changed`/`-status-changed` não são emitidos com `locked()` true (teste do serviço com `locked: () => true` → `changed` não chamado; `store.set` chamado).
- CA10: "Remover" e "Sair da conta" apagam `whatsapp/triagem.json` (teste existente dessas rotinas estendido ou novo). `salvarExecucaoExterna` faz a run aparecer em `runs.list()` e não conta em `AUTOMATIC_TRIGGERS`/limite diário (teste em `automations-service.test.ts`).
- CA11: `index.ts` chama `triagem.onMessage(message, chatName)` no `onMessage` do WhatsApp **depois** do atendimento e **antes** de `notifyWhatsApp` (conferir por leitura; sem teste automático além do typecheck).

## Invariantes
- `main/whatsapp/triagem/*` não importa `send-guard`, `agentSend`, nem nada de `main/email`. `grep -rn "send-guard\|agentSend\|main/email" apps/desktop/src/main/whatsapp/triagem/` vazio.
- `main/agents`, `main/schedules` e `main/tray` continuam sem importar `main/whatsapp/atendimento` (invariante do 153) e **não importam** `main/whatsapp/triagem` (a dependência é o inverso: triagem → automations, por deps injetadas).
- Testes existentes `atendimento-*.test.ts`, `automations-*.test.ts`, `tray-automations.test.ts` verdes sem edição além dos acréscimos.
- Nenhuma string de mensagem em `devLog`/`console`.

## Fora de escopo desta tarefa
- Telas e stores do renderer (160, 162), cartões do Assistente e fonte (163), smoke e docs (164), `main/smoke.ts`.

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz). Smoke não é exigido aqui (vem no fim da wave 3 e no 164).
- Testes novos: `triagem-classify.test.ts` (CA1, CA2), `triagem-service.test.ts` (CA3–CA6, CA9), acréscimos em `automations-service.test.ts` (CA7, CA8, CA10) e no teste de limpeza do WhatsApp (CA10).

## Relatório esperado do implementador
≤ 40 linhas: arquivos, contagem de testes, como ligou no `index.ts` (linhas), decisões tomadas onde o contrato deixou escolha (formato do `answer`, hook de status), cláusulas não cumpridas e por quê.
