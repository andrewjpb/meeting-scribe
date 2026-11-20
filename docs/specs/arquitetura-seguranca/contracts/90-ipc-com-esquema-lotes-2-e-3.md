# Contrato 90 — IPC com esquema no registro, lotes 2 e 3 (o resto dos canais)
Feature: arquitetura-seguranca · Wave: 4 (parte A, lote 2) e 5 (parte B, lote 3) · Depende de: 89 · Spec/Plan: `docs/specs/arquitetura-seguranca/{spec,plan}.md` (RASCUNHO, aguardam aprovação)

Microtarefa S7 do plan, fim do requisito **R3**. Usa o mecanismo do 89 sem mudar: o registro central `src/main/ipc-schemas/`, o tipo mapeado que reprova canal sem esquema, a lista de pendentes que só encolhe e o passo `ipc-esquemas` do smoke. Duas partes, cada uma com seu implementador, seus gates e seu commit: **A** migra o lote 2 (reuniões e gravação, Assistente, Configurações); **B** migra o lote 3 (WhatsApp, agenda e contas, MCP, automações, atualização e o resto) e apaga o modo "pendente". No fim, **nenhum** dos 216 canais fica sem esquema.

Contagens conferidas na `main` em `bf9ceba` (200 `invoke` + 14 eventos), mais o que o 85 acrescenta (`scribe:claude-path-pick` e o evento `scribe:exec-click`): **201 + 15**. O 89 cobre 39 + 4; aqui ficam **162 + 11**. Canal que outra frente acrescentar até a parte B entra com esquema na própria microtarefa dela (o tipo mapeado do 89 obriga).

## Pré-condições
- O 89 commitado na `main`, com `IPC_PENDING_INVOKE.length === 162` e `IPC_PENDING_EVENTS.length === 11`. A parte B só começa depois do commit da parte A.
- O 85 commitado: `scribe:claude-path-set` e `scribe:mcp-test` (com `draft`) já levam o gesto que ele definiu. O esquema destes dois segue **o formato final do 85** (o campo do token e o caminho vindo do diálogo), conferido no texto dele antes de escrever.
- Nenhum contrato que mexa em `main/index.ts` roda em paralelo (A10/102 em especial).
- Ler antes: `src/main/ipc.ts` e `src/main/ipc-schemas/*` (do 89), `test/ipc-schemas.test.ts`, os registros em `src/main/index.ts` (de `1923` a `2330` hoje) e o preload.

## Os lotes (nomes sem o prefixo `scribe:`)

**Lote 2 — parte A (85 `invoke` + 6 eventos)**
| Área | Arquivo de esquema | Canais |
|---|---|---|
| Reuniões e gravação (45) | `ipc-schemas/meetings.ts` **novo** | `meetings-` list, get, create, rename, delete, overview, search, move (8); `folders-` list, create, rename, delete (4); `transcript-` save, get, copy (3); `transcription-token`; `translate-turn`; `notes-` get, save, copy (3); `summary-` get, generate, copy (3); `analysis-run`, `analysis-copy`; `analyses-` get, save, add (3); `ai-notes-` run, cancel (2); `meeting-files`, `meeting-file-` open, reveal, download (4); `audio-` folder, folder-choose, begin, append, finish (5); `recording-session-` open, close (2); `capture-mode`; `claude-` start, translate, stop (3) |
| Assistente (13) | `ipc-schemas/chat.ts` **novo** | `chat-` list, get, send, stop, delete, update, redo, copy, approval, action-reminder, action-state, action-event, action-reminder-change |
| Configurações (27) | `ipc-schemas/settings.ts` **novo** | `app-info`; `settings-` get, update; `key-` status, save, verify, remove; `models-list`; `model-select`; `mic-access`, `mic-access-request`; `claude-locate`; `claude-path-set`; `claude-path-pick` (do 85); `acp-` status, install, remove; `branding-get`; `brand-logo-` choose, reset; `lock-` status, now, unlock, touch-id, password-set, password-remove; `plugin-save` |
| Eventos (6) | `chat.ts` e `settings.ts` | `chat-close`, `chat-leave`, `lock-activity`, `open-key-dashboard`, `open-privacy-settings`, `exec-click` (do 85) |

**Lote 3 — parte B (77 `invoke` + 5 eventos)**
| Área | Arquivo de esquema | Canais |
|---|---|---|
| WhatsApp (24) | `ipc-schemas/whatsapp.ts` **novo** | `whatsapp-` status, risk-accept, install, start, stop, pair, logout, remove, chats, messages, search, send, send-media, attach-pick, react, typing, draft, link-get, link-set, photo, media, transcribe, insights, insights-run |
| Agenda, Meet e navegador (11) | `ipc-schemas/calendar.ts` **novo** | `calendar-` get, list, record, dismiss, join, recording (6); `meet-status`; `meeting-prompt-` state, act (2); `navegador-` status, set (2) |
| Contas e Drive (14) | `ipc-schemas/accounts.ts` **novo** | `google-` status, client-save, sign-in, sign-in-cancel, sign-out, calendar-grant (6); `microsoft-` status, client-save, sign-in, sign-in-cancel, sign-out (5); `drive-` status, retry, open (3) |
| MCP (9) | `ipc-schemas/mcp.ts` **novo** | `mcp-` chat-servers, overview, test, save, update, remove, details, import, connector-tools |
| Automações (15) | `ipc-schemas/automations.ts` **novo** | `agents-` list, save, delete, test (4); `tasks-` list, save, delete, toggle, run-now (5); `automations-` ask, status, pause (3); `runs-` list, get, rerun (3) |
| Atualização (4) | `ipc-schemas/app.ts` **novo** | `update-` get, check, download, quit |
| Eventos (5) | `whatsapp.ts` e `app.ts` | `whatsapp-click`, `whatsapp-pair-cancel`, `whatsapp-viewing`, `open-link`, `csp-violation` |

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/ipc-schemas/{meetings,chat,settings}.ts` | **novos** (parte A) |
| `src/main/ipc-schemas/{whatsapp,calendar,accounts,mcp,automations,app}.ts` | **novos** (parte B) |
| `src/main/ipc-schemas/index.ts` | junta os novos mapas; na parte B, o tipo passa a ser total sobre `InvokeChannel` e `RendererEvent` (CA9) |
| `src/main/ipc-schemas/pending.ts` | parte A tira os 91 do lote 2; parte B **apaga o arquivo** (CA9) |
| `src/main/ipc.ts` | parte B: some o ramo "pendente" do `handle`/`onEvent` e o `unchecked` do `ipcRegistry()` (CA9) |
| `src/main/index.ts` | os handlers que hoje leem o payload com `as { campo?: unknown }` ou desestruturam sem conferir (29 casos com `as {`, ex.: `index.ts:1941` `meetings-rename`, `index.ts:2105` `lock-unlock`) passam a usar o valor já validado; **o que o handler faz não muda** |
| `src/main/whatsapp/service.ts` | parte B: só `spendClick` (CA4) |
| `test/ipc-schemas.test.ts` | casos por canal dos lotes 2 e 3; `LOTE_2` e `LOTE_3` esvaziam (CA1, CA10) |
| `src/main/smoke.ts` | o passo `ipc-esquemas` passa a exigir `unchecked` vazio (CA10) e ganha os pedidos hostis do CA8 |

Nenhum outro arquivo. Serviços (fora o `spendClick` do WhatsApp), preload, renderer e os mapas de `shared/ipc.ts` sem diff.

## Critérios de aceite
Âncoras: `test/ipc-schemas.test.ts` (`describe('lote 2: reuniões, Assistente, Configurações')`, `describe('lote 3: WhatsApp, agenda, contas, MCP, automações, atualização')`, `describe('pendentes')`) e o passo `ipc-esquemas` do smoke.

- **CA1 — Mesmas regras de forma do 89 (CA8, regras 1–4).** Todo esquema novo é tipado `z.ZodType<…request>` pelo tipo mapeado; objetos `.strict()`; identificador do app com formato (`automationIdSchema` de `shared/automations-schema.ts:43`, `WHATSAPP_CHAT_ID_PATTERN`, ids de reunião); conteúdo digitado pela pessoa só com o tipo (título, nome de pasta, senha do bloqueio, chave da AssemblyAI, texto da pergunta ao Assistente, mensagem do WhatsApp, prompt de agente). Onde o serviço **já lança exceção** para o mesmo pedido inválido, o esquema do IPC pode ser o do serviço (ex.: `patchSchema` por trás de `parseSettingsPatch`, `settings/schema.ts:236`; `agentInputSchema` e `taskInputSchema`, `shared/automations-schema.ts:81, 168`; `aiNotesRunRequestSchema`): a resposta visível (rejeição) é a mesma. *Teste:* por canal, o payload real do renderer (com `arquivo:linha` no nome do caso) passa e um de tipo errado é recusado com `` `${canal}: pedido inválido` ``.
- **CA2 — Canais de fim de gravação.** Os 8 de `RECORDING_SESSION_CHANNELS` (`meetings-create`, `transcript-save`, `notes-save`, `analyses-save`, `analyses-add`, `audio-finish`, `summary-generate`, `ai-notes-cancel`) validam só o 1º argumento; o 2º (`{ recordingSession }`) continua com o `passesWhileLocked`. *Teste:* bloqueado, com o token da sessão e payload válido, `scribe:transcript-save` chama o handler; com o token e payload inválido, rejeita `pedido inválido`; sem o token, `LOCKED_ERROR` (a ordem do CA2 do 89).
- **CA3 — Binários.** `scribe:audio-append` (`{ id, data }`, a cada 5 s da gravação) e `scribe:whatsapp-send-media` (`bytes`) usam `z.instanceof(Uint8Array)`; o teto continua o do serviço. *Teste:* `data` como `number[]` é recusado; um `Uint8Array` de 5 s do smoke passa.
- **CA4 — Canais com gesto (85).** `scribe:claude-path-set` (`{ path: string | null; clickToken }`), `scribe:claude-path-pick` (`{ clickToken }`) e `scribe:mcp-test` (`{ draft, clickToken }` ou `{ key }`) validam a forma que o 85 definiu (CA2 e CA5 dele); a recusa pelo esquema também gasta o token, pelo `onRejected` (como o CA5 do 89), no `execGuard` que o 85 criou em `index.ts`. Os canais do WhatsApp com token (`whatsapp-send`, `whatsapp-send-media`, `whatsapp-react`) ganham o mesmo `onRejected`, gastando o token no guarda do WhatsApp (`whatsapp.registerClick` ganha o par `spendClick(senderId, token, chatId)`, que chama o `guard.consume` de `whatsapp/service.ts:733` e joga fora o resultado; o arquivo entra na Superfície da parte B só com isso). *Teste:* token UUID registrado, pedido malformado, depois pedido válido com o mesmo token: `{ ok: false, error: 'click' }`.
- **CA5 — Handler sem leitura crua.** Nos handlers dos lotes 2 e 3, `rg -n "as \{ [a-zA-Z]+\?: unknown" apps/desktop/src/main/index.ts` devolve **0** linhas (hoje 29). O valor que chega ao serviço é o mesmo de antes para todo payload válido.
- **CA6 — Desestruturação protegida.** `scribe:meetings-rename` com payload `undefined`: hoje lança `TypeError` dentro do handler (`index.ts:1941`); depois, rejeita `scribe:meetings-rename: pedido inválido` sem chamar `meetings.rename`. *Teste* do caso.
- **CA7 — Eventos.** Os 11 eventos têm esquema: `exec-click` string até 100 (como `email-click`); `open-link` string até 2 048 (só a forma: o filtro `isHttpsUrl` continua no handler, `index.ts:2320-2322`); `csp-violation` `{ directive, blockedUri, sourceFile }` strings até 2 048; `open-privacy-settings` `z.enum(['microphone','audio-capture','calendars'])`; `whatsapp-viewing` `{ chatId: string|null }`; `chat-close`/`chat-leave` `{ id }`; os `undefined` com `z.undefined()`. O listener `ipcMain.on('scribe:csp-violation')` que o smoke instala (`smoke.ts:11174`) fica como está (só existe no smoke).
- **CA8 — Pedidos hostis no smoke.** O passo `ipc-esquemas` manda, pela janela principal: `scribe:meetings-rename` sem argumento, `scribe:settings-update` com `{ claudePath: '/bin/sh' }` (chave fora do patch), `scribe:whatsapp-messages` com `{ chatId: 1 }`, `scribe:mcp-save` com `{}` e `scribe:update-download` com `{ x: 1 }`: os cinco rejeitam com `pedido inválido`, e `scribe:settings-get` responde normal logo depois.

**Fim da migração (parte B)**
- **CA9 — Zero canal sem esquema.** `src/main/ipc-schemas/pending.ts` não existe; `INVOKE_SCHEMAS` é `{ readonly [C in InvokeChannel]: z.ZodType<InvokeChannels[C]['request']> }` e `RENDERER_EVENT_SCHEMAS` `{ readonly [C in RendererEvent]: z.ZodType<RendererEvents[C]> }`; `ipc.ts` não tem mais ramo que registre sem conferir (o `sem esquema de entrada` do 89 continua para canal fora do mapa). `rg -n "PENDING|unchecked" apps/desktop/src/main` devolve 0.
- **CA10 — O teste e o smoke dizem zero.** Em `test/ipc-schemas.test.ts`, todo canal de `INVOKE_CHANNELS` (201) e `RENDERER_EVENT_CHANNELS` (15) tem esquema, e `LOTE_2`/`LOTE_3` saem do arquivo. No smoke, `ipcRegistry()` devolve `checked` com os 216 canais e nenhum outro campo de pendentes.
- **CA11 — Canal novo depois disto.** Acrescentar um canal de prova a `InvokeChannels` e `INVOKE` sem esquema faz `pnpm --filter @meeting-scribe/desktop typecheck` falhar em `src/main/ipc-schemas/index.ts` (conferir à mão e desfazer; registrar a saída no relatório).

## Invariantes
- **Payload válido, comportamento igual.** Todos os testes que já existem passam **sem alteração** (fora `test/ipc-schemas.test.ts` e o mock do `test/lock-ipc.test.ts`, que são do 89), em especial `meetings-store`, `meetings-folders`, `transcripts-store`, `meeting-notes`, `meeting-summary`, `meeting-analysis`, `ai-notes`, `chat`, `assistant`, `settings-service`, `settings-store`, `lock`, `whatsapp*`, `calendar`, `google-*`, `microsoft-account`, `mcp`, `conectores`, `automations-*`, `updates`. Todos os passos do smoke passam com os mesmos textos e prints.
- Mesmas respostas de negócio para conteúdo digitado errado (ex.: `scribe:folders-create` com nome vazio continua `null`; `scribe:lock-unlock` com senha errada continua o `LockResponse` de hoje; `scribe:key-save` com chave ruim continua o `KeySaveResult` de hoje).
- A gravação em curso não sente o esquema: `audio-append`, `claude-translate`, `translate-turn` e `transcription-token` continuam no mesmo ritmo (o passo de gravação do smoke não ganha tempo de espera).
- `WHEN_LOCKED`, `RECORDING_SESSION_CHANNELS`, `RENDERER_EVENTS_WHEN_LOCKED` e as listas de eventos só do preload sem diff. Nenhum valor de payload em log ou mensagem de erro.

## Fora de escopo
- Derivar os tipos de `shared/ipc.ts` dos esquemas (T3, "quando possível"): microtarefa própria, se o Andrew quiser.
- Esquema nos eventos de main para renderer (`MainEvents`) e nas respostas.
- Mudar regra de negócio de qualquer serviço; tirar a validação de dentro deles.
- F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde em todos os passos, **ao fim de cada parte**.
- Parte A: `IPC_PENDING_INVOKE.length === 77` e `IPC_PENDING_EVENTS.length === 5`. Parte B: CA9 e CA10.
- `rg -n "as \{ [a-zA-Z]+\?: unknown" apps/desktop/src/main/index.ts` = 0 ao fim da parte B (CA5).
- `git diff --stat` só com os arquivos da Superfície da parte. Sem commit: quem coordena commita pelo agente de commits, um commit por parte.

## Dúvidas para o coordenador
- **D-90a — `spendClick` no WhatsApp (CA4).** É uma linha em `whatsapp/service.ts`, que a A3 (contrato 95) também toca (fila de `links.json`/`aceite.json`). Se o 95 estiver aberto na mesma wave, a parte B espera o commit dele.
- **D-90b — `scribe:open-link`.** O 87 (CA7) põe o link atrás de `decideOpenLink` e de um diálogo nativo no main; o esquema daqui é só a forma (string até 2 048) e não substitui nada disso. Conferir com o texto final do 87 antes da parte B.
