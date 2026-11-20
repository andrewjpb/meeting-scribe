# Contrato 96 — Caches pelo helper e fim do disco síncrono
Feature: arquitetura-seguranca · Wave: 3 · Depende de: 93 · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Passa quatro arquivos de cache pelo helper do 93 (R11, R13): `whatsapp/insights.json`, `whatsapp/transcripts.json`, `calendar-cache.json` e `drive-queue.json`. Os dois últimos usam `fs` **síncrono** hoje (`calendar/service.ts:158-181`; `google/drive-sync.ts:133-151`, com `persist()` chamado em 9 lugares) e passam a assíncrono. É a parte delicada: quem lia o estado logo depois de criar o serviço precisa esperar a carga. Formato em disco igual (N1, N3).

## Pré-condições
- Commit do 93 na branch (nomes do CA1 do 93).
- **A Dúvida Q1 respondida pelo coordenador antes de despachar** (o teste do Drive que lê o estado sem esperar). Os CAs abaixo seguem a opção A.
- Conferir que o 89 (S6, mesma wave 3) não está aberto em `src/main/index.ts` ao mesmo tempo: este contrato muda uma linha lá (CA6). Se estiver, parar e avisar.
- Ler antes: os quatro arquivos da Superfície, `index.ts:967-976` (criação do Drive), `index.ts:2390-2420` e `2488-2496` (ordem de subida), o contrato 93, `test/calendar.test.ts:447-473`, `test/google-drive.test.ts:61-80, 234-247`.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/whatsapp/insights.ts` | `createInsightsCache` sobre `createJsonFile` (CA1) |
| `src/main/whatsapp/transcripts.ts` | `createTranscriptsCache` sobre `createJsonFile` com cópia em memória (CA2) |
| `src/main/calendar/service.ts` | `loadCache`/`writeCache` assíncronos pelo helper (CA3) |
| `src/main/google/drive-sync.ts` | carga e `persist` assíncronos pelo helper; `ready()` novo (CA4, CA5) |
| `src/main/index.ts` | uma linha: `await services.drive.ready()` antes de `registerIpc(services)` (CA6) |
| `test/google-drive.test.ts` | **só se Q1 = A**: uma linha `await reopened.ready()` depois de `const reopened = makeSync()` (linha 241) |

Nada mais: `whatsapp/service.ts` (o `forget()` continua sendo chamado como hoje), `install.ts`, os demais testes e o `smoke.ts` sem diff.

## Critérios de aceite
Âncoras: os testes das Invariantes; "bytes iguais" = `cmp` entre o arquivo gravado no HEAD do 93 e depois, com a mesma sequência e o mesmo relógio, conferido pelo implementador e relatado.

- **CA1 — `insights.json`.** `createJsonFile` com `indent: 0`, sem `version` (o arquivo é o `Record` de `insightsCacheSchema`), `parse = zodParse(insightsCacheSchema)`, ausente ou inválido vale `{}` sem aviso, quarentena `keep`, `cache: false`, `write.mkdir: { mode: 0o700 }`. `put` é um `update` (o corte de `INSIGHTS_CACHE_MAX` dentro dele); `read` e `get` usam `read()`. Interface `InsightsCacheStore` igual.
- **CA2 — `transcripts.json` do WhatsApp.** `createJsonFile` com `indent: 0`, sem `version`, `parse = zodParse(fileSchema)`, vale `{}` ausente ou inválido, quarentena `keep`, **`cache: true`**, `write.mkdir: { mode: 0o700 }`. `set` é um `update` (corte de `TRANSCRIPTS_MAX` pelo `at`); `forget()` chama o `forget()` do helper. Diferença aceita: `get` agora espera um `set` que já estava na fila (hoje lia a cópia sem esperar); devolve o texto recém-gravado em vez do anterior.
- **CA3 — `calendar-cache.json` assíncrono.** `createJsonFile` com `indent: 0`, `version: 1`, `serialize: (calendars) => ({ version: 1, calendars })`, `parse = zodParse(cacheSchema)`, inválido ignorado (vale vazio, sem aviso), `cache: false`, `write.mkdir: false`. Ordem garantida:
  1. `start()` continua síncrono e devolve `void`; guarda `cacheLoaded = file.read().then(preenche byCalendar)` **antes** de chamar `refresh()`;
  2. `doRefresh()` começa com `await cacheLoaded` (quando houver) — a carga nunca sobrescreve uma leitura nova, porque termina antes dela;
  3. `writeCache()` vira `async` e é **aguardado** dentro de `doRefresh` (`await calendar.refresh()` sai com o arquivo já gravado ou já apagado); sem agenda escolhida, `file.remove()`; falha de gravação continua engolida (sem log de conteúdo).
  O teste `test/calendar.test.ts` "cache: só os campos do evento, 0600; …" passa sem alteração, inclusive `reopened.start(); await reopened.refresh()` lendo o cache sem internet.
- **CA4 — `drive-queue.json` assíncrono.** `createJsonFile` com `indent: 2`, `version: 1`, `serialize: (state) => state` (o objeto já tem `version` primeiro, como hoje), `parse = zodParse(fileSchema)`, ausente ou inválido vale `emptyFile()`, `cache: false`, `write.mkdir: false`. O `state` em memória continua sendo a fonte; `persist()` continua síncrono para quem chama, tira a foto `structuredClone(state)` **na hora** e enfileira `file.write(foto)`; falha → o mesmo `deps.log?.('[drive] não foi possível gravar a fila')`. Gravações saem na ordem das chamadas (fila do helper).
- **CA5 — `ready()` e a espera.** `DriveSyncService` ganha `ready(): Promise<void>`, que resolve quando a carga terminou (falha de leitura vale `emptyFile()`, nunca rejeita). Antes disso: `status`, `folderUrl` e `inDrive` respondem pelo estado vazio; `enqueue`, `retry`, `signedIn`, `clear` e `start` esperam `ready()` antes de mexer no estado **só enquanto a carga não terminou**; depois dela, mexem de forma síncrona, como hoje (sem microtarefa no meio: `sync.signedIn(email); await sync.flush()` no teste das linhas 310-328 depende disso). `retry` chamado antes da carga devolve o status do estado vazio e aplica a nova tentativa quando a carga termina. `flush()` termina com `await file.idle()`: depois dele, o arquivo em disco é o estado atual (os testes que leem `drive-queue.json` depois de `await sync.flush()` continuam certos). `dispose()` não espera nada.
- **CA6 — Subida do app.** Em `index.ts`, logo depois de `const services = createAppServices(userData)` e antes de `registerIpc(services)`: `await services.drive.ready()`. Assim o primeiro `scribe:drive-status` e o `inDrive` do índice de reuniões (`index.ts:1497`) já veem a fila carregada.
- **CA7 — Formato.** `cmp` igual entre HEAD do 93 e depois para: `insights.json` após dois `put`; `transcripts.json` após dois `set`; `calendar-cache.json` após um `refresh` com a fixture do teste; `drive-queue.json` após `enqueue` + `flush` com falha de rede. Todos `0600`.
- **CA8 — Sem síncrono, sem cópia local.** `grep -nE "Sync\(|from 'node:fs'" src/main/calendar/service.ts src/main/google/drive-sync.ts src/main/whatsapp/insights.ts src/main/whatsapp/transcripts.ts` vazio; nenhum `randomUUID` restante usado para temporário nesses quatro arquivos.

## Invariantes
- Testes verdes **sem alteração** (N3), salvo a linha do Q1: `test/calendar.test.ts`, `test/google-drive.test.ts`, `test/whatsapp-insights.test.ts`, `test/whatsapp-media.test.ts` (transcrições: corte em 20 000, arquivo estragado, `forget` depois de "Remover", linhas 261-307), `test/acp.test.ts` (só usa `insightsInput`/`insightsParser`), `test/whatsapp.test.ts`.
- Smoke sem alteração: ele não grava nenhum destes quatro arquivos.
- "Remover" e "Sair da conta" continuam apagando `insights.json` e `transcripts.json` (`install.ts:181`, `service.ts:624-625`) seguidos do `forget()`; com `cache: true` no CA2, a leitura seguinte vai ao disco.
- Nenhum token, título de evento, participante ou texto de mensagem vai para log.
- Quarentena, preservada até o 101: nenhum dos quatro renomeia; inválido vale vazio e o próximo save sobrescreve.

## Fora de escopo
- `version` em `insights.json` e `transcripts.json` (101, R15); `invalidate()` do calendário e a lógica de avisos (sem diff); o vault do WhatsApp (F5); `dataDir` (102).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou).
- `git diff --stat` só com os arquivos da Superfície (o teste só com a linha do Q1 = A); conferência de bytes do CA7 no relatório.
- Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **Q1 — R13 contra N3 no Drive.** `test/google-drive.test.ts` "a fila continua depois de reabrir o app" (linhas 234-247) cria o serviço e chama `reopened.status('m1')` na linha seguinte, sem nenhum `await` no meio: só passa se a carga for síncrona. Não há como tirar o `readFileSync` (R13) sem mudar esse teste. **A (adotada nos CAs):** carga assíncrona + `ready()`, com uma linha `await reopened.ready()` no teste — exceção explícita à regra "testes sem alteração" do plan. **B:** manter só a carga inicial síncrona (`readFileSync` no construtor, isolado numa função `loadSync` do helper) e tornar assíncronas apenas as 9 gravações; o teste fica intacto, mas R13 fica parcial para o Drive e o 103 precisa de uma exceção nomeada. Nenhuma das duas muda o que a pessoa vê.
- **Q2 — `index.ts` na wave 3.** O CA6 toca `index.ts`, que o plan não lista para A4 e que o 89 (S6) também edita na wave 3. A linha fica fora de `createAppServices` e dos handlers; se o coordenador preferir zero diff em `index.ts`, a alternativa é o Drive anunciar `onStatus` de todas as reuniões ao terminar a carga (o renderer se corrige sozinho), mas o `inDrive` do índice de reuniões pode responder `false` nos primeiros milissegundos.
