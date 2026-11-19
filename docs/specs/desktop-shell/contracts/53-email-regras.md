# Contrato 53 — Regras de email (núcleo)
Feature: email-organizacao · Wave: 2 · Depende de: 52 · Spec: `docs/specs/email-organizacao/spec.md` (R4, R5, N1, N2, N3, N6) · Plan: `docs/specs/email-organizacao/plan.md`

Só main + shared + IPC + testes. O editor de regras na aba Email é do contrato 55.

## Pré-condições
- Contrato 52 commitado (b624852): `moveMessages`, `listFolders`, cache de pastas em `<conta>.folders/`, fila `enqueue`, `rt.movedIn`.
- Ler antes: `apps/desktop/src/main/email/{service,email-store,imap-client,notify,fake-email}.ts`, `apps/desktop/src/shared/email.ts`, o settings (`main/settings/{schema,store}.ts`, onde ficam `emailAccounts` e `emailSignatures`).

## Critérios de aceite
- CA1 — Modelo em `shared/email-rules.ts`:
  `EmailRule = { id, name (1–80), enabled, match: 'all' | 'any', conditions[] (1–10), actions[] (1–5), stop: boolean, lastError: { at, message } | null, lastRunAt | null }`.
  Condições: `{ field: 'from' | 'to' | 'subject' | 'body', op: 'contains' | 'not-contains' | 'equals', value (1–200) }` e `{ field: 'has-attachment' }`.
  `to` cobre Para e Cc. Comparação sem maiúscula e sem acento. Ações: `{ type: 'move', path }`, `{ type: 'mark-read' }`,
  `{ type: 'flag' }`, `{ type: 'trash' }`, `{ type: 'no-notify' }`. Zod `.strict()`.
- CA2 — Settings: `emailRules: Record<accountId, EmailRule[]>` na raiz do `settings.json` (mesmo padrão de `emailSignatures`),
  máx. 50 por conta; regra inválida no arquivo cai sozinha sem levar as outras; remover a conta remove as regras.
- CA3 — Funções puras: `matchRule(message, body | null, rule)` e `planActions(message, body | null, rules)` → lista ordenada de
  ações já resolvida: na ordem das regras, `stop` interrompe; `trash` e `move` são finais (a primeira vence, as seguintes de
  mover/apagar são ignoradas); `mark-read`, `flag`, `no-notify` acumulam. Condição `body` só casa se o corpo foi baixado.
- CA4 — Ao chegar email novo (`fetchNew` do IDLE e o poll do POP3), ANTES de notificar: aplicar as regras habilitadas da conta.
  - `body` só é baixado (`BODY.PEEK`, limite atual de tamanho) se alguma regra habilitada da conta tem condição `body`.
  - Executar na fila `enqueue` da conta. `move` usa `moveMessages` do 52; `trash` = mover para a pasta `\Trash`
    (sem `\Trash`: ação ignorada e `lastError` "conta sem Lixeira") — nunca `EXPUNGE` direto (N3); `mark-read` = `\Seen`;
    `flag` = `\Flagged`; `no-notify` = não chama o `notify`.
  - Email movido/apagado por regra não notifica.
  - POP3 (N2): só `mark-read` (local) e `no-notify`; `move`/`trash`/`flag` são ignorados sem erro e o planejador já os descarta.
  - Falha (pasta sumiu, sem conexão, servidor recusou) (N6): o email fica onde está, notifica normalmente, a regra ganha
    `lastError`; o próximo sucesso limpa o `lastError`.
- CA5 — "Executar agora": `email:rules-run-now(accountId, ruleId, dryRun)`. `dryRun: true` devolve `{ count, sample: até 5 assuntos }`
  usando as 200 do cache da INBOX (corpo só do cache de corpos). `dryRun: false` executa em lote (agrupado por ação), na fila,
  e devolve `{ moved, trashed, marked, flagged, failed }`. Grava `lastRunAt`.
- CA6 — IPC no padrão do repo: `scribe:email-rules-get`, `scribe:email-rules-set` (lista inteira da conta, validada),
  `scribe:email-rules-run-now`. Zod `.strict()`, erros tipados (`missing | invalid | pop3 | storage | unavailable`),
  `refused` com o app bloqueado.
- CA7 — N2 do revisor do 52: quando uma pasta sai do cache pelo teto de 30, apagar também os corpos `box:` das mensagens dela
  em `<conta>.bodies/`. Teste.
- CA8 — Testes: `matchRule` (cada campo/op, sem acento, any/all, anexo, corpo ausente), `planActions` (ordem, stop, move/trash
  finais, acumulação), aplicação no IDLE com o IMAP falso (move, trash para `\Trash`, sem `\Trash`, mark-read, flag, no-notify,
  falha → `lastError` + notifica), POP3, "Executar agora" dry-run e real, limite de 50, regra inválida no arquivo,
  remover conta. Smoke: regra fake "assunto contém X → mover para Arquivo" aplicada a um email novo do servidor falso.

## Invariantes
- Sem regras, o fluxo de chegada e notificação é idêntico ao de hoje (mesma ordem, mesmo número de idas ao servidor).
- Envio, assinatura, contrato 51, `buscar_emails`/`ler_email`: iguais.

## Fora de escopo
- Regras no servidor (Sieve), regra no envio, editor de regras (55), agente criando regra (N4).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Nenhuma neste contrato (o editor é do 55). Efeito visível: emails novos que casam com uma regra vão direto para a pasta.
