# Contrato 89 — IPC com esquema no registro, lote 1 (email e convites)
Feature: arquitetura-seguranca · Wave: 3 · Depende de: 85, 87 · Spec/Plan: `docs/specs/arquitetura-seguranca/{spec,plan}.md` (RASCUNHO, aguardam aprovação)

Microtarefa S6 do plan, requisito **R3** da spec (decisão técnica T3). O registro do main (`src/main/ipc.ts`) passa a conferir a entrada de todo canal contra um esquema zod **antes** do handler; canal sem esquema não compila nem sobe. Este contrato monta o mecanismo e migra o **lote 1**: os 39 canais `invoke` de email e convites e os 4 eventos do renderer da mesma área. Os outros 162 `invoke` e 11 eventos ficam numa lista de pendentes, explícita e que só encolhe; o contrato 90 a esvazia.

Números conferidos na `main` em `bf9ceba` (20/11/2026): `INVOKE` de `src/shared/ipc.ts` tem **200** canais e `RENDERER_EVENTS` tem **14** (214 registros em `src/main/index.ts`, um por canal, nenhum fora dele). O 85, que vem antes, acrescenta o `invoke` `scribe:claude-path-pick` e o evento `scribe:exec-click` (`85-gesto-nos-canais-que-executam.md`, Superfície): os números deste contrato já contam com eles, **201 + 15 = 216**. A spec fala em "~197": vale a contagem daqui; se o texto final do 85 mudar os nomes, o implementador corrige as listas e os números antes de começar.

## Pré-condições
- Os contratos **85** (gesto em `claude-path-set` e `mcp-test`, mexe em `preload/index.ts` e `main/index.ts`) e **87** (anexo com quarentena e gravação atômica no handler de `scribe:email-attachment-save`, `main/index.ts:2240-2251`) estão commitados na `main`. Conferir com `git log --oneline -10` e `git status` limpo. Nenhum outro contrato que mexa em `main/index.ts` roda em paralelo (regra de wave do plan).
- Gates verdes na `main` antes da primeira linha.
- Ler antes: `src/main/ipc.ts` (inteiro, 73 linhas), `src/shared/ipc.ts` (mapas `InvokeChannels`, `RendererEvents`, `INVOKE`, `WHEN_LOCKED`, `RECORDING_SESSION_CHANNELS`), `src/main/index.ts:2200-2282` (os registros do lote), `src/preload/index.ts` (o que cada método manda), os esquemas que já existem em `src/main/email/service.ts:197-284`, `src/main/invites/service.ts:115-125`, `src/main/invites/suggest.ts:213-215` e `src/shared/invite-suggest-schema.ts`, e `test/lock-ipc.test.ts`.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/ipc.ts` | `handle` e `onEvent` buscam o esquema do canal, validam e passam ao handler o valor validado; recusa e registro sem esquema (CA2–CA6); `ipcRegistry()` para o smoke (CA9) |
| `src/main/ipc-schemas/index.ts` | **novo**: `INVOKE_SCHEMAS` e `RENDERER_EVENT_SCHEMAS`, tipados sobre os mapas de `shared/ipc.ts` menos os pendentes (CA1) |
| `src/main/ipc-schemas/pending.ts` | **novo**: `IPC_PENDING_INVOKE` e `IPC_PENDING_EVENTS` (`as const`), os canais dos lotes 2 e 3 (CA7) |
| `src/main/ipc-schemas/email.ts` | **novo**: esquemas de forma dos 29 `scribe:email-*` e dos eventos `email-click`, `email-viewing`, `email-folder-watch` (CA8) |
| `src/main/ipc-schemas/invites.ts` | **novo**: esquemas dos 10 `scribe:invite-*` e do evento `invite-suggest-click` (CA8) |
| `src/main/email/service.ts` | só `spendClick(senderId, token: unknown): void` no `EmailService`, que gasta um token registrado sem enviar nada (CA5) |
| `src/main/invites/suggest.ts` | só `spendClick` no `InviteSuggestChannels`, idem (CA5) |
| `src/main/index.ts` | os três registros com token de clique ganham `onRejected` (CA5); nenhum outro registro muda de texto |
| `src/main/smoke.ts` | passo `ipc-esquemas` (CA9, CA10) |
| `test/ipc-schemas.test.ts` | **novo** (CA1–CA8, CA11) |
| `test/lock-ipc.test.ts` | só o `vi.mock` do registro de esquemas (CA12); os casos não mudam |

Nenhum outro arquivo. Em particular, nada no renderer, no preload, nos mapas de `shared/ipc.ts` nem nas regras de negócio dos serviços.

## Critérios de aceite
Âncoras: `test/ipc-schemas.test.ts` (`describe('registro com esquema')`, `describe('lote 1: email e convites')`, `describe('pendentes')`), com o `ipcMain` falso igual ao de `test/lock-ipc.test.ts:5-13`; e o passo `ipc-esquemas` do smoke.

**Mecanismo**
- **CA1 — Registro tipado.** `src/main/ipc-schemas/index.ts` exporta
  `INVOKE_SCHEMAS: { readonly [C in Exclude<InvokeChannel, PendingInvoke>]: z.ZodType<InvokeChannels[C]['request']> }` e
  `RENDERER_EVENT_SCHEMAS: { readonly [C in Exclude<RendererEvent, PendingEvent>]: z.ZodType<RendererEvents[C]> }`,
  com `PendingInvoke = (typeof IPC_PENDING_INVOKE)[number]` (idem eventos). Canal novo em `InvokeChannels` que não esteja nos pendentes e não tenha esquema = erro no `pnpm typecheck` (passo 1/8 dos gates). Canal com `request: undefined` usa `z.undefined()`. *Teste:* um `// @ts-expect-error` num objeto de prova sem uma chave do lote 1.
- **CA2 — Ordem das conferências no `handle`.** Para cada chamada: (1) origem (`isTrustedSender`, erro `` `${channel}: origem não autorizada` `` como hoje), (2) bloqueio (`passesWhileLocked`, erro `LOCKED_ERROR` como hoje), (3) quantidade de argumentos: mais de 1 recusa, salvo canal de `RECORDING_SESSION_CHANNELS`, que aceita até 2 (o segundo continua conferido só pelo `passesWhileLocked`), (4) `schema.safeParse(args[0])`, (5) handler com `parsed.data` no lugar de `args[0]`. *Teste:* origem errada com payload inválido devolve o erro de origem; bloqueado com payload inválido devolve `LOCKED_ERROR` (o esquema nunca vê pedido bloqueado).
- **CA3 — Recusa do `invoke`.** Payload que não passa: o handler **não** é chamado e a promessa rejeita com `Error` de mensagem exatamente `` `${channel}: pedido inválido` ``. No renderer isso chega como `Error invoking remote method '<canal>': Error: <canal>: pedido inválido`. *Teste:* `scribe:email-messages` com `{ accountId: 1 }`, com `{ accountId: '<id válido>', extra: true }` e com dois argumentos: os três rejeitam com essa mensagem e o contador do handler fica em 0.
- **CA4 — Recusa do evento.** `onEvent` com payload que não passa ignora a mensagem (como a origem errada hoje): listener não chamado, nada lançado. *Teste:* `scribe:email-viewing` com `{ accountId: 'x', folder: 'trash' }`: listener com 0 chamadas.
- **CA5 — Token de clique gasto também na recusa.** Hoje `send`, `sendInviteReply` e `suggest` gastam o token antes de validar (`email/service.ts:2307-2308`, `invites/suggest.ts:265-266`). O registro aceita um 4º argumento opcional `{ onRejected?: (event, raw: unknown) => void }`, chamado só na recusa do passo (4); `scribe:email-send` e `scribe:invite-reply` ligam `email.spendClick(event.sender.id, raw?.clickToken)` e `scribe:invite-suggest` liga `inviteSuggest.spendClick(...)`. *Teste:* registrar um token UUID `T` (o guarda só aceita `^[0-9a-f-]{36}$`, `email/service.ts:153`), mandar `scribe:email-send` com `to: 5` e `clickToken: T` (recusado pelo esquema), depois um envio válido com `T`: o segundo volta `{ ok: false, error: 'click' }`. O mesmo para `scribe:invite-suggest`.
- **CA6 — Canal sem esquema não sobe.** `handle`/`onEvent` de um canal que não está em `INVOKE_SCHEMAS`/`RENDERER_EVENT_SCHEMAS` nem nos pendentes lança na hora do registro: `` `${channel}: sem esquema de entrada` ``. Canal pendente registra como hoje (sem conferir o payload) e entra em `ipcRegistry().unchecked`. *Teste:* `handle('scribe:canal-novo' as InvokeChannel, …)` lança; `handle('scribe:meetings-list', …)` (pendente) não lança.
- **CA7 — Pendentes explícitos e que só encolhem.** `pending.ts` lista exatamente os **162** `invoke` e **11** eventos dos lotes 2 e 3 (as listas por lote estão no contrato 90). O teste tem, em literal, as listas `LOTE_2` (85 + 6) e `LOTE_3` (77 + 5) e exige: (a) todo canal de `INVOKE_CHANNELS` e `RENDERER_EVENT_CHANNELS` está em exatamente um entre esquema e pendente; (b) `IPC_PENDING_* ⊆ LOTE_2 ∪ LOTE_3` (canal novo não entra como pendente); (c) nenhum canal do lote 1 está pendente; (d) `IPC_PENDING_INVOKE.length === 162` e `IPC_PENDING_EVENTS.length === 11` neste contrato (o 90 baixa os números).

**Lote 1 (43 canais)**
- **CA8 — Esquemas de forma.** Têm esquema os 39 `invoke`: `scribe:email-` `accounts`, `autoconfig`, `add-account`, `remove-account`, `messages`, `get-body`, `mark-read`, `delete`, `send`, `test`, `attach-pick`, `remote-images`, `attachment-save`, `attachments`, `folders`, `open-folder`, `move`, `folder-create`, `folder-rename`, `folder-delete`, `signature-get`, `signature-set`, `rules-get`, `rules-set`, `rules-preview`, `rules-run`, `organize-state`, `batch-get`, `batch-undo` (29) e `scribe:invite-` `reply`, `state`, `add`, `update`, `remove`, `calendars`, `request-access`, `open-ics`, `suggest`, `suggest-add` (10); e os 4 eventos `scribe:email-click`, `scribe:invite-suggest-click` (string até 100), `scribe:email-viewing` (`{ accountId, folder: 'inbox'|'sent' }` estrito ou `null`), `scribe:email-folder-watch` (`{ accountId, path: string|null }` estrito ou `null`). Regras de "forma" que todo esquema do lote segue:
  1. tipos e chaves do tipo TS do canal; objetos `.strict()`; campos opcionais do tipo são `.optional()`; uniões literais do tipo (`partstat`, `availability`, `folder`) viram `z.enum`;
  2. identificador gerado pelo app tem o formato dele: `accountId` com `EMAIL_ACCOUNT_ID_PATTERN`, `id` de mensagem string de 1 a 1 024 sem caractere de controle, `uids` inteiros positivos até `0xffffffff`, `index` inteiro ≥ 0, `bytes` com `z.instanceof(Uint8Array)`;
  3. **conteúdo digitado pela pessoa só tem o tipo conferido** (endereço, senha, nome de pasta, assunto, texto, assinatura, regras, título e data da sugestão): o formato continua com o serviço, que já devolve a resposta de negócio;
  4. o esquema nunca é mais estrito que o do serviço para o mesmo campo (comparar com `email/service.ts:197-284` e `invites/service.ts:115-119`).
  *Teste:* para cada um dos 43, o payload que o renderer manda de verdade (copiado da chamada, com o `arquivo:linha` no nome do caso: ex. `emailStore.ts:226`, `inviteStore.ts:84`, `preload/index.ts:62-75`) passa; e um payload de tipo errado por canal é recusado (CA3/CA4).
- **CA9 — Mesma resposta de negócio.** Pela cadeia completa (registro → handler de `index.ts` → serviço falso dos testes existentes), payload com a forma certa e o conteúdo errado devolve o **mesmo** valor de hoje: `scribe:email-autoconfig` `{ address: 'sem-arroba' }` → `null`; `scribe:email-add-account` com `address: 'x'` → `{ ok: false, error: 'invalid' }`; `scribe:email-folder-create` com `name: 'a/b'` numa conta de delimitador `/` → o `folderFailure('invalid')` de hoje; `scribe:invite-suggest-add` com `date: '2026-02-30'` → `invalidAdd` de hoje. *Teste* em `describe('lote 1: email e convites')`.

**Smoke e registro completo**
- **CA10 — Passo `ipc-esquemas` no smoke.** Depois de o app subir, `ipcRegistry()` devolve `{ checked, unchecked }` com: `checked ∪ unchecked` = os 216 canais, sem repetição; `unchecked` igual a `IPC_PENDING_INVOKE ∪ IPC_PENDING_EVENTS`; os 43 do lote em `checked`. O passo falha com a lista do que sobrou ou faltou.
- **CA11 — Pedido hostil pela janela de verdade.** No mesmo passo, pelo `window.__scribeApi.invoke` da janela principal: `scribe:email-messages` com `{ accountId: 1 }` rejeita com mensagem que contém `scribe:email-messages: pedido inválido`; `scribe:invite-state` com `{ accountId: '<conta do smoke>', id: 'x', a: 1 }` idem; e logo depois `scribe:email-accounts` sem argumento responde a lista normal (o canal não ficou travado).
- **CA12 — Teste do bloqueio intacto.** `test/lock-ipc.test.ts` ganha só `vi.mock('../src/main/ipc-schemas', …)` com `z.unknown()` para todo canal (inclusive o `scribe:canal-novo` do teste): todos os casos de hoje passam sem outra alteração.

## Invariantes
- **Payload válido, comportamento igual.** `test/email-service.test.ts`, `test/invites-service.test.ts`, `test/invite-suggest.test.ts`, `test/email-folders.test.ts`, `test/email-rules.test.ts`, `test/email-signature.test.ts` e `test/email-organize.test.ts` passam **sem alteração**; todos os passos de email e convite do smoke passam sem alteração (mesmos textos, mesmos prints). Os `.catch(() => …)` dos registros de `index.ts:2201-2282` ficam como estão.
- O esquema nunca vê nem registra o valor do payload: a recusa não loga conteúdo (só o canal), e nenhuma mensagem de erro inclui o valor recebido. Âncora: o teste do CA3 confere a mensagem exata.
- `WHEN_LOCKED`, `RENDERER_EVENTS_WHEN_LOCKED`, `PRELOAD_ONLY_EVENTS` e `EMAIL_PRELOAD_ONLY_EVENTS` sem diff. O preload continua sendo a primeira barreira (`assertChannel`); o esquema é a segunda.
- O handler de `scribe:email-attachment-save` mantém o que o 87 entregou (quarentena e gravação atômica).
- Os 162 `invoke` e 11 eventos pendentes funcionam exatamente como antes (sem conferência nova).

## Fora de escopo
- Lotes 2 e 3: contrato 90.
- Derivar os tipos de `shared/ipc.ts` dos esquemas (T3 diz "quando possível"): fica para depois do 90; aqui o esquema é tipado contra o tipo que já existe.
- Mudar as regras de negócio ou as mensagens dos serviços de email e convites; tirar a validação de dentro dos serviços (ela continua, em dobro de propósito).
- Os eventos de main para renderer (`MainEvents`): saem do main, não precisam de esquema de entrada.
- F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde em todos os passos (8, ou 9 se o 88 já entrou).
- `test/ipc-schemas.test.ts` novo e verde; `test/lock-ipc.test.ts` verde só com o mock.
- `rg -n "^\s*(handle|onEvent)\('scribe:(email|invite)-" apps/desktop/src/main/index.ts | wc -l` = 43, e o `git diff` dessas linhas só acrescenta o `onRejected` em 3 delas.
- `git diff --stat` só com os arquivos da Superfície. Sem commit: quem coordena commita pelo agente de commits.

## Decisões deste contrato (para o Andrew conferir)
- **E1 — Esquema num registro central, não como parâmetro de cada `handle`.** T3 fala em `handle(channel, schema, fn)`. Aqui o esquema mora em `ipc-schemas/` e o `handle` o busca pelo nome: as 216 linhas de registro não mudam de texto, e a cobertura total vem do tipo mapeado (CA1), que reprova canal sem esquema no typecheck do mesmo jeito. Se o Andrew preferir o parâmetro, o tipo e o teste continuam iguais e só muda a chamada.
- **E2 — "Forma" no IPC, "conteúdo" no serviço** (CA8, regra 3). Validar endereço ou nome de pasta no IPC trocaria a resposta `invalid`, que a tela mostra, por uma exceção genérica.
- **E3 — `scribe:email-viewing` inválido passa a ser ignorado.** Hoje (`index.ts:2277-2282`) um payload inválido zera a pasta vista da janela; com o esquema ele é descartado e fica a anterior. O renderer de verdade só manda `{ accountId, folder }` ou `null` (`EmailScreen.tsx:313-314`), então não muda nada para quem usa.

## Dúvidas para o coordenador
- O CA5 pede `spendClick` em dois serviços (uma linha cada, sem regra nova). A alternativa é deixar o token vivo na recusa pelo esquema (ele expira sozinho em 10 s, `EMAIL_CLICK_TTL_MS`): mais simples, mas um pedido malformado deixaria de gastar o clique, o contrário do que `email/service.ts:2307` garante hoje. Recomendo o `spendClick`; confirmar.
