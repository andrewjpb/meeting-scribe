# Contrato 52 — Núcleo de pastas do email: listar, abrir, mover, criar, renomear e apagar
Feature: email-organizacao · Wave: 1 · Depende de: 42, 43 · Spec: `docs/specs/email-organizacao/spec.md` (R1, R2, R3, N2) · Plan: `docs/specs/email-organizacao/plan.md`

Pedido do Andrew (19/11/2026 13:00): "mover emails para pastas". Este contrato é só o main + preload + IPC + testes.
As telas (sidebar em árvore, arrastar, "Mover para…") são do contrato 55 — aqui NÃO se mexe no renderer além do
mínimo para compilar (tipos novos no `window.scribe`).

## Pré-condições
- Contratos 42 (núcleo: `main/email/*`) e 43 (telas) prontos na `main` 0.15.0.
- Ler antes: `apps/desktop/src/main/email/{email-store,imap-client,service,fake-email,export,assistant-tools}.ts`,
  `apps/desktop/src/shared/email.ts`, o preload do email e os testes `apps/desktop/test/email-*.test.ts`.

## Critérios de aceite
- CA1 — Store por pasta. `EmailMessage.folder: 'inbox' | 'sent'` vira `mailbox: string` (path IMAP; POP3 usa `INBOX`
  e `Sent` locais). Migração no carregamento do store: `inbox` → `INBOX`; `sent` → o path da pasta `\Sent` da conta
  (sem ela, `Sent`). Dado antigo no disco abre sem perda (teste com arquivo da 0.15.0). Todo uso de `folder` no main,
  no shared e no renderer passa a usar `mailbox` com o mesmo comportamento de hoje (Caixa de Entrada e Enviados
  continuam iguais na tela). Helpers `isInbox(m)` e `isSent(m, account)` em `shared/email.ts` evitam espalhar strings.
- CA2 — `email:folders(accountId)` → árvore: `{ path, name, delimiter, specialUse, unseen, total, children[] }`,
  pelo `LIST` + `STATUS (MESSAGES UNSEEN)`; pastas `\Noselect` aparecem como nó sem abrir. Cache em memória por conta,
  invalidado ao mover, criar, renomear, apagar e ao reconectar. POP3 devolve só `INBOX` e `Sent`, com `pop3: true`.
- CA3 — `email:openFolder(accountId, path)` → as 200 mais recentes (envelope, flags), gravadas no store para aquela
  pasta. A INBOX segue o fluxo atual (IDLE). Pasta aberta que não é a INBOX atualiza a cada 5 min enquanto o renderer
  disser que está aberta (`email:folderWatch(accountId, path | null)`); só uma por janela.
- CA4 — `email:move(accountId, fromPath, uids[], toPath)` → `messageMove` do imapflow (usa `MOVE`; sem ele, `COPY` +
  `\Deleted` + `EXPUNGE`). Devolve `{ moved: [{ fromUid, toUid | null }] }` usando o `COPYUID`/`uidMap` quando o servidor
  manda. Tira as mensagens do store de origem e atualiza as contagens. Lote até 500 UIDs. Erro do servidor não apaga
  nada local. POP3: recusa com `pop3`.
- CA5 — `email:folderCreate(accountId, parentPath | null, name)`, `email:folderRename(accountId, path, newName)`,
  `email:folderDelete(accountId, path)`. Bloqueado (erro `protected`) para `INBOX` e qualquer `specialUse`
  (`\Sent \Trash \Junk \Drafts \Archive \All \Flagged`). Nome validado: 1–100 chars, sem o delimitador, sem CR/LF.
  Apagar pasta com mensagens exige `force: true`.
- CA6 — Uma função interna do main, `moveMessages(...)`, é a que o IPC chama, para o contrato 56 (agente) reusar sem IPC.
  Idem `listFolders(...)` e `createFolder(...)`.
- CA7 — IPC no padrão do `service.ts`: zod `.strict()`, `accountId` validado, erros tipados
  (`missing | pop3 | protected | invalid | unavailable | server`). Nenhum canal envia email.
- CA8 — `fake-email.ts` ganha suporte a `LIST` aninhado, `STATUS`, `MOVE`, `COPY`/`EXPUNGE` (modo sem MOVE),
  `CREATE`, `RENAME`, `DELETE`, para os testes e o smoke.
- CA9 — Testes de unidade: migração do store; árvore de pastas com delimitador `/` e `.`; mover com e sem MOVE e o
  mapa de UIDs; pasta protegida; nome inválido; apagar com e sem `force`; POP3 recusa; contagens atualizam depois de mover.
  A busca do Assistente (`buscar_emails`) e a exportação (`export.ts`) continuam passando nos testes atuais.

## Invariantes
- Caixa de Entrada, Enviados, IDLE, notificações, envio, `buscar_emails`, `ler_email`, contrato 51: tudo igual.
- Nada é apagado no servidor por este contrato, exceto o `EXPUNGE` do mover sem MOVE e o apagar pasta pedido.

## Fora de escopo
- Telas (55), regras (53), assinatura (54), agente (56).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Nenhuma neste contrato (as telas são do 55). A tela atual de email continua igual.
