# Contrato 101 — Quarentena e `version` uniformes em todos os stores
Feature: arquitetura-seguranca · Wave: 6 · Depende de: 94, 95, 96, 97, 98, 99, 100 · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa A9 do plan (R14, R15, N1, N2). Depois de 94–100, todo store grava pela API do contrato 93, mas cada um
ainda trata arquivo inválido do seu jeito (descarta, ignora, `.invalid`, `.bad`, `.corrupt-` tardio) e alguns não
têm `version`. Este contrato liga, store por store, a quarentena padrão e a cadeia de migrações do 93. **É o único
contrato da feature que altera testes de store e fixtures do smoke** (N2, plan "Gates").

## Pré-condições
- 94–100 commitados; gates verdes. Ler o contrato 93 (CA1: `QuarantinePolicy`, `quarantineTargets.corruptIso`,
  `onInvalid`/`InvalidEvent`, `version` + `migrations`; CA10, CA11) e 94–100 (a opção que cada store ficou usando:
  quase todos `{ kind: 'keep' }`, que é o que este contrato troca).
- Ler antes: cada store da tabela abaixo, os testes listados em CA6 e os passos de smoke do CA7.
- Conferido no código em 20/11/2026 (main `bf9ceba`). **Divergência com a spec:** R15 diz que faltam `version` em
  "summaries, chat, runs, insights"; o resumo **tem** (`SUMMARY_VERSION = 1`, `src/shared/meeting-summary.ts:8`,
  `meeting-summary-schema.ts:19`). Faltam em `chats/<id>.json`, `schedule-runs/<id>.json`, `whatsapp/insights.json`,
  `whatsapp/transcripts.json`, `whatsapp/links.json` e `whatsapp/aceite.json`.

## Comportamento por store (hoje → depois)
"Quarentena" = a opção do 93 `{ kind: 'rename', target: quarantineTargets.corruptIso, when: 'on-read', chmod: true,
renameError: 'ignore' }` (nome `<nome>.corrupt-<ISO com : e . trocados por ->`, 0600) com o `onInvalid` ligado ao
registro novo `storage/invalid-log.ts` (store, arquivo, motivo `json` | `shape` | `version`, instante; **sem conteúdo**),
e o store segue com o vazio/padrão. "Descarte registrado" = `{ kind: 'keep' }` com o mesmo `onInvalid`.
| Arquivo (em `userData/`) | `version` hoje | Inválido hoje | Depois |
|---|---|---|---|
| `meetings.json` | 1 | `.corrupt-` na leitura | igual (já é o padrão) |
| `meetings/<id>.json` (transcrição) | 1 | `.corrupt-` na leitura | igual |
| `meetings/<id>.summary.json` | 1 | ignorado ("sem resumo"), sobrescrito ao gerar | quarentena |
| `meetings/<id>.notes.json` | 1 | ignorado, sobrescrito no próximo salvar | quarentena |
| `meetings/<id>.analyses.json` | 1 | ignorado | quarentena |
| `settings.json` | 1 | padrões; `.corrupt-` só na próxima gravação; campo inválido → padrão do campo | quarentena **na leitura** (JSON ou `version`); leniência por campo continua |
| `agents.json` | 1 | arquivo inválido → lista vazia e **sobrescrito no próximo salvar**; agente inválido sai | quarentena do arquivo; item inválido continua saindo, contado no evento |
| `schedules.json` | 1 | inválido → vazio; tarefa inválida sai | quarentena; item como agents |
| `schedule-runs/<id>.json` | — | ilegível fica de fora | `version: 1` (v0→v1 sem mudar campos); quarentena |
| `chats/<id>.json` | — | ignorado (some da lista) | `version: 1` (v0→v1); quarentena |
| `chat-events.json` | 1 | `chat-events.<ms>.bad` | `chat-events.json.corrupt-<ISO>` |
| `mcp-servers.json`, `mcp-cli-enabled.json` | 1 | vazio (**sobrescrito** na próxima gravação) | quarentena; servidor inválido sai, contado |
| `email/<conta>.json` | 1 | vazio (perde os UIDLs do POP3) | quarentena (o `.eml` do POP3 pode ser a única cópia) |
| `email/<conta>.rules-state.json` | 1 | `{}` | quarentena |
| `email/<conta>.folders/index.json` e `<hash>.json`, `<conta>.bodies/*.json` | 1 / — | vazio / `null` | **descarte registrado** (cache refeito do servidor; ver Dúvidas) |
| `email/batches.json` | 1 | vazio | quarentena |
| `email/invites.json` | 1 | `invites.json.invalid` (sobrescreve) | `invites.json.corrupt-<ISO>` |
| `lock.json` | 1 | "sem senha" | quarentena, e continua "sem senha" (é o "Esqueci a senha", CA5 do contrato 22) |
| `drive-queue.json` | 1 | vazio | quarentena |
| `calendar-cache.json` | 1 | ignorado | descarte registrado (cache) |
| `whatsapp/insights.json` | — (registro por conversa no topo) | descartado | `{ version: 1, entries: {…} }` (v0→v1 embrulha); quarentena |
| `whatsapp/transcripts.json` | — (registro no topo) | descartado | `{ version: 1, entries: {…} }`; quarentena (refazer custa AssemblyAI) |
| `whatsapp/links.json` | — (registro no topo) | vazio, sobrescrito no próximo save | `{ version: 1, links: {…} }`; quarentena |
| `whatsapp/aceite.json` | — | vazio, sobrescrito no próximo save | `version: 1` no objeto; quarentena |
Fora: `secrets.bin`, `accounts/*.bin`, `whatsapp/service.bin` (F5), `chat-corpus/`, `chat-scope/`, `claude-cwd/`,
`tmp/` (derivados, refeitos pelo app), `whatsapp/{venv,bridge,session}` (instalação e sessão da ponte, F6).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| os stores da tabela (`meetings/{summaries,notes,analyses}.ts`, `settings/store.ts`, `agents/store.ts`, `schedules/store.ts`, `chat/{store,events-store}.ts`, `mcp/store.ts`, `email/{email-store,batches}.ts`, `invites/store.ts`, `lock/store.ts`, `google/drive-sync.ts`, `calendar/service.ts`, `whatsapp/{insights,transcripts,service}.ts`) | só a configuração de quarentena/descarte e a cadeia de migrações na chamada da API do 93 |
| `src/shared/whatsapp-insights-schema.ts` (`insightsCacheSchema`), `src/shared/automations-schema.ts` (`runSchema`) | o campo `version` nos esquemas de arquivo (o tipo em memória não muda); o `chatSchema` fica em `chat/store.ts:304` |
| `src/main/storage/invalid-log.ts` | **novo**: `recordInvalid(store, event)` e `invalidEvents()` — anel em memória dos últimos 200 `InvalidEvent` (o 93 não guarda nada, só chama `onInvalid`) |
| `src/main/storage/quarantine.ts` | **novo**: `listQuarantine(dir, base)` → os três estilos (CA5), só leitura |
| os testes do CA6 e `src/main/smoke.ts` (passos do CA7) | ajustados ao comportamento novo |
| `test/storage-quarantine-uniform.test.ts` | **novo**: CA1–CA5 |

## Critérios de aceite
Âncora: `test/storage-quarantine-uniform.test.ts` (`describe('quarentena e versão uniformes')`), um `it.each` pela tabela.
- **CA1 — Nome único.** Para cada linha "quarentena" da tabela, dado o arquivo com `{ não é json`, quando o store lê,
  então existe exatamente `<nome>.corrupt-2026-11-20T12-00-00-000Z` (relógio fixo), com o conteúdo original byte a
  byte e modo `0o600`, e a leitura volta o vazio/padrão daquele store. *Asserção:* `readdirSync` + `readFileSync` + `stat`.
- **CA2 — Evento registrado, sem conteúdo.** Cada quarentena, descarte registrado e item de lista descartado gera um
  evento em `invalidEvents()` com `{ store, path, reason, quarantinedAs, at, dropped? }`; o evento não contém nenhum valor do arquivo.
  *Teste:* arquivo com um título `SEGREDO-X` inválido → nenhum evento nem log contém `SEGREDO-X`.
- **CA3 — Versão desconhecida.** `version` maior que a conhecida pelo store → quarentena com motivo `version` (nunca
  gravar por cima de um arquivo de versão mais nova). *Teste:* um caso por store com `version: 99`.
- **CA4 — Migração v0 → v1 (N1).** Para os seis arquivos sem `version`: dado o arquivo no formato de 0.18.0
  (fixture escrita à mão no teste), quando o store lê, então devolve os mesmos dados de antes; a primeira gravação
  sai com `version: 1` (e embrulhado, nos três registros do WhatsApp); um segundo store na mesma pasta lê o v1 igual.
  Nada é migrado só por ler (gravação só quando o store já gravaria).
- **CA5 — Nomes antigos reconhecidos.** `invites.json.invalid` e `chat-events.<n>.bad` que já existem no disco não são
  apagados nem renomeados; `listQuarantine(dir, base)` devolve os três padrões (`<base>.corrupt-<ISO>`, `<base>.invalid`,
  `<radical>.<n>.bad`) com nome, tamanho e mtime — é o que o contrato 104 mostra.
- **CA6 — Testes de store que mudam** (cada um passa a esperar a quarentena e o evento; nenhum outro teste muda):
  `test/invites-store.test.ts:90` (`.invalid` → `.corrupt-`), `test/chat-events-store.test.ts:56` (`.bad` → `.corrupt-`),
  `test/automations-service.test.ts:414` (schedules estragado), `test/chat.test.ts:515` (conversa inválida),
  `test/mcp.test.ts:96` (arquivo inválido), `test/lock.test.ts:206` (lock inválido), `test/meeting-summary.test.ts:109`,
  `test/meeting-notes.test.ts:83`, `test/meeting-analysis.test.ts:227`, `test/whatsapp-insights.test.ts:128` e
  `test/whatsapp-media.test.ts:259` (insights e transcrições embrulhados), `test/settings-store.test.ts:581` (quarentena
  na leitura) e os casos de arquivo inválido de `agents.json`, `batches.json` e `drive-queue.json` que existirem em
  `test/automations-*.test.ts`, `test/email-organize.test.ts` e `test/google-drive.test.ts` (o implementador lista os
  achados no relatório). `test/email-folders.test.ts:112` (função pura `migrateAccountData`) **não** muda.
- **CA7 — Smoke.** Passos que mudam: o cache de "Detalhes" (`smoke.ts:5625`, lê `insights.json[WA_ANA]` → `entries[WA_ANA]`)
  e a transcrição de áudio do WhatsApp (`smoke.ts:5879`, `Object.values(...)` → `Object.values(...entries)`). Passo
  **novo** ao fim do smoke de Configurações: com o app fechado entre duas aberturas (ou antes da primeira), grava
  `agents.json` com `{ não é json`; o app sobe, a tela Automações abre sem agentes de exemplo novos e existe
  `agents.json.corrupt-*` na pasta (verificação 8 da spec, parte do arquivo; a parte da tela é do 105).

## Invariantes
- Nenhum dado do usuário some em silêncio: todo arquivo que o app deixaria de ler fica em quarentena ou é um cache
  da tabela, com evento registrado. Âncora: CA1, CA2.
- Nenhum arquivo é gravado numa versão que o store não conhece (CA3). Formato de 0.18.0 abre sem passo manual (CA4).
- Interfaces dos stores sem mudança; só os esquemas de arquivo ganham `version`.

## Fora de escopo
- Tela que mostra a quarentena (105) e o serviço que lista (104). Limpar quarentena antiga. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- `git diff --stat`: só a Superfície; o diff de testes só nos arquivos do CA6. Sem commit pelo implementador.

## Dúvidas para o coordenador
- **Caches de email e da agenda com "descarte registrado" em vez de quarentena.** Corpos e pastas do IMAP podem ser
  milhares de arquivos refeitos do servidor; quarentenar cada um encheria a pasta. A spec pede quarentena em "todo
  store"; recomendo a exceção, com o evento. Confirmar com o Andrew.
- **Downgrade.** Os três registros do WhatsApp embrulhados deixam de ser lidos pela 0.18.0 (insights e transcrições
  viram vazios lá; `links.json` perde os vínculos). N1 só fala de subir de versão; registrar como limitação ou manter
  o formato antigo nesses três e guardar a `version` num arquivo ao lado.
- **Teto de quarentenas.** Sem teto, um arquivo que corrompe toda vez acumula cópias. Proposta: nenhum teto agora,
  a tela Sistema mostra a contagem; limpar fica para depois.
