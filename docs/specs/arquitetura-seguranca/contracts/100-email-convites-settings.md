# Contrato 100 — Email, convites e settings no helper
Feature: arquitetura-seguranca · Wave: 5 · Depende de: 93 · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa A8 do plan (R11). Os três stores mais sensíveis passam a gravar pela API do contrato 93, **sem
mudar** interface, formato em disco, permissões nem comportamento com arquivo inválido (N1, N3, T5):
`src/main/email/email-store.ts` (cache por conta: `<conta>.json`, `<conta>.bodies/`, `<conta>.folders/` com
`index.json`, `<conta>.rules-state.json`), `src/main/invites/store.ts` (`email/invites.json`) e
`src/main/settings/store.ts` (`settings.json`, que guarda as senhas de email cifradas pelo `safeStorage` em
base64, `settings/schema.ts:256-271`). A uniformização da quarentena é do 101, não daqui.

## Pré-condições
- Contrato 93 commitado; gates verdes antes de começar. Este contrato não depende de 94–99 e pode rodar em
  paralelo com eles se não houver arquivo em comum (não há).
- Ler antes: os três stores inteiros; `src/main/storage/json-file.ts` e o contrato 93 (CA1: `serialQueue`, `writeAtomic`,
  `ensureDir`, `createJsonFile`, `createJsonDir`, `quarantineTargets`, `QuarantinePolicy`, `cache`); `src/main/settings/schema.ts`
  (`StoredEmailAccount`, `checkEmailAccounts`, `parseEmailAccounts`); `test/settings-store.test.ts`,
  `test/settings-service.test.ts`, `test/email-folders.test.ts` (inclui `migrateAccountData`),
  `test/email-rules.test.ts`, `test/email-signature.test.ts`, `test/email-pop3.test.ts`,
  `test/email-service.test.ts`, `test/invites-store.test.ts`.
- Comportamento de hoje que **fica igual** (N3) e que a API do 93 precisa permitir configurar:
  | Arquivo | Ausente | Inválido | Gravação |
  |---|---|---|---|
  | `email/<conta>.json` | vazio (`emptyAccountData`) | vazio, sem renomear (`migrateAccountData` → `null`) | JSON compacto + `\n`, 0600 com `chmod`, fila **por conta** |
  | `<conta>.bodies/<hash>.json` / `.eml` | `null` | `null` | atômica; `.eml` é `Buffer` |
  | `<conta>.folders/index.json` e `<hash>.json` | vazio / `null` | vazio / `null` | atômica, fila da conta, teto de 30 pastas |
  | `<conta>.rules-state.json` | `{}` | `{}` | atômica, fila da conta |
  | `email/invites.json` | vazio | linha inválida sai sozinha; JSON quebrado ou `version` ≠ 1 → `invites.json.invalid` (0600, sobrescreve) | atômica, fila única, teto `INVITES_MAX` |
  | `settings.json` | padrões | campo inválido cai no padrão; JSON quebrado → padrões e `settings.json.corrupt-<ISO>` **só na próxima gravação** | JSON com 2 espaços + `\n`, 0600, fila única, cache em memória |

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/email/email-store.ts` | `writeAtomic`, `readJson` e o `serial` por conta (`email-store.ts:245-302` de hoje) saem; tudo pela API do 93 (CA1–CA4). Esquemas, `migrateAccountData`, `toDisk`, `capInbox` e a interface `EmailStore` sem mudança |
| `src/main/invites/store.ts` | fila, gravação e o `.invalid` pela API do 93 (CA5) |
| `src/main/settings/store.ts` | fila, gravação e o `.corrupt-` tardio pela API do 93; cache em memória como hoje (CA6, CA7) |
| `src/main/storage/files.ts` | **novo**: `removePath(path, { recursive })` (o `rm -rf` de `clearBodies` e `remove`, `email-store.ts:438-446`), a única coisa do email que o 93 não cobre; com teste. Bytes (`writeAtomic` com `Uint8Array`), pasta (`ensureDir`) e listagem com `stat` (`createJsonDir().entries()`) já são do 93 |
| `test/storage-email-settings.test.ts` | **novo**: CA8 |

Nenhum outro arquivo. `email/service.ts:770` e `invites/service.ts:221` continuam criando o store por dentro
(isso muda no 102). Os testes listados nas Pré-condições ficam **sem diff**.

## Critérios de aceite
Âncoras: `test/storage-email-settings.test.ts` (`describe('email, convites e settings no helper')`) e os testes existentes.

- **CA1 — Nenhum `fs` nos três stores.** `grep -n "node:fs" src/main/email/email-store.ts src/main/invites/store.ts
  src/main/settings/store.ts` vazio. Mapeamento para a API do 93: email → um `serialQueue()` por conta (no `Map` de hoje),
  `createJsonFile` com `indent: 0`, `quarantine: { kind: 'keep' }` e `parse` = `migrateAccountData` (`null` → `{ ok: false }`)
  para `<conta>.json`, `.rules-state.json` e `index.json`; `createJsonDir` para `.bodies/` e as pastas, `writeAtomic` com
  `Uint8Array` para o `.eml`, `ensureDir({ mode: 0o700 })`; convites → `quarantine: { kind: 'rename', target:
  quarantineTargets.invalid, when: 'on-read', chmod: true }`; settings → `cache: true`, `indent: 2`, `quarantine:
  { kind: 'rename', target: quarantineTargets.corruptIso, when: 'before-next-write' }`.
- **CA2 — Fila por conta preservada.** O email continua com **uma fila por `accountId`** (hoje `queues: Map`,
  `email-store.ts:266, 295-302`): duas contas gravam em paralelo, a mesma conta em série, e `setBody` pedido antes de
  `remove` termina antes dele (comentário em `:329`). *Teste:* `update` da conta A preso numa promessa não atrasa o
  `update` da conta B (B resolve antes de A ser solto); na mesma conta, a ordem de conclusão é a de chamada.
- **CA3 — Formato e permissões de hoje.** Para cada arquivo da tabela: bytes gravados iguais aos de 0.18.0
  (mesma indentação, mesmo `\n` final, mesma ordem de chaves) e modo `0o600` nos arquivos, `0o700` nas pastas
  `email/`, `<conta>.bodies/` e `<conta>.folders/`. *Teste:* grava pelo store novo e compara com o texto esperado
  escrito à mão no teste (não com um arquivo gerado pelo código antigo); `stat().mode & 0o777`.
- **CA4 — Corpos, `.eml`, pastas e poda.** `setRaw` grava o `Buffer` byte a byte (*teste:* `.eml` com bytes
  `0x00`–`0xff` volta igual por `raw`); `updateFolder` mantém o teto `EMAIL_CACHED_FOLDERS_MAX` e chama
  `onEvicted`; `pruneBodies` continua tirando só `<hash>.json|eml` fora do `keep` e temporários `.tmp-` mais
  velhos que `STALE_TEMP_MS`, e com `<conta>.json` ilegível devolve `0` sem apagar nada (o `.eml` do POP3 pode ser
  a única cópia, `:393`); `clearBodies` e `remove` apagam o mesmo conjunto de hoje. *Teste:* um caso por função.
- **CA5 — Convites.** `invites.json.invalid` com o mesmo nome, modo 0600 e sobrescrita do anterior; o log continua
  só com a operação e a contagem (`test/invites-store.test.ts` sem diff cobre).
- **CA6 — Settings: senhas de email cifradas, ida e volta.** Dado um `safeStorage` falso (o de
  `test/settings-service.test.ts`), quando `setEmailAccounts([{ …, password: encrypt('s3nh@-ç') }])` grava e um
  **store novo** na mesma pasta lê com `getEmailAccounts()`, então o `password` volta **igual em base64** e
  `decrypt` devolve `'s3nh@-ç'`; no arquivo, `settings.json` contém o base64 e **não** contém `s3nh@-ç` (*asserção:*
  `readFileSync(...).includes('s3nh@-ç') === false`). O mesmo depois de `update(patch)` e de `setEmailSignature`:
  gravar settings não perde nem regrava diferente as contas, as assinaturas e as regras.
- **CA7 — Settings: arquivo quebrado.** JSON quebrado → `get()` devolve os padrões sem renomear nada; a primeira
  gravação seguinte renomeia para `settings.json.corrupt-<ISO>` e grava o novo (o caso de `settings-store.test.ts:581`
  passa sem mudança). Sem arquivo → padrões e nenhum arquivo criado até a primeira gravação. Falha na gravação →
  o cache em memória e o `onChange` **não** mudam (hoje `commit` só troca o `cached` depois do `write`; manter).
- **CA8 — Testes novos** (`test/storage-email-settings.test.ts`): CA2, CA3, CA4, CA6 e o "falha na gravação" do CA7;
  mais: `email/<conta>.json` da 0.15.0 (sem `mailbox`) abre pelo `migrateAccountData` e a gravação seguinte sai no
  formato da 0.18.0 com o `folder` antigo (o caminho do contrato 52 continua igual); conta com id fora de
  `EMAIL_ACCOUNT_ID_PATTERN` → `conta inválida` antes de tocar no disco.

## Invariantes
- A senha em claro nunca vai a disco, log nem teste de snapshot; o store não decifra nada (quem decifra é o
  `email/service.ts`). Âncora: CA6.
- Nenhuma interface muda: `EmailStore`, `InviteStore`, `SettingsStore` e os tipos de `shared/` sem diff.
- Formato em disco idêntico (N1): um `userData` da 0.18.0 abre sem passo manual, e o gravado depois abre na 0.18.0.
- Arquivo inválido continua tratado como hoje (vazio, `.invalid` ou `.corrupt-` tardio): a mudança é só do 101 (N2).

## Fora de escopo
- Quarentena e `version` uniformes (101). Criar os stores fora dos serviços e o `dataDir` (102).
- `mcp-servers.json` (segredos do MCP, contrato 94), `secrets.bin` e `accounts/` (F5). F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 depois do 88).
- Os testes de email, convites e settings existentes verdes **sem alteração**; smoke sem diff.
- `git diff --stat` só com a Superfície. Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **`storage/files.ts` novo** só para apagar pasta (`rm -r`): o 93 não tem `remove` de pasta. Alternativa: pôr
  `removePath` no próprio `json-file.ts` (mexe num arquivo do 93 já revisado).
- **Settings sem quarentena na leitura**: o 93 tem a opção `before-next-write` exatamente para manter o de hoje; o 101
  decide se passa a renomear na leitura.
