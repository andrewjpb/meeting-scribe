# Contrato 54 — Assinatura por conta (núcleo)
Feature: email-organizacao · Wave: 1 · Depende de: 42, 43 · Spec: `docs/specs/email-organizacao/spec.md` (R6, F2) · Plan: `docs/specs/email-organizacao/plan.md`

## Critérios de aceite
- CA1 — Settings: `emailSignatures: Record<accountId, { text: string; onNew: boolean; onReply: boolean }>`, zod
  `.strict()`, `text` até 2000 chars, padrão `{ text: '', onNew: true, onReply: true }`. Remover a conta remove a assinatura.
- CA2 — IPC `email:signature:get(accountId)` e `email:signature:set(accountId, value)`.
- CA3 — Função pura em `shared/email-signature.ts`: `withSignature(body, signature, kind: 'new' | 'reply' | 'forward')`
  → `{ text, html }`. Texto: `\n\n-- \n<assinatura>` antes da citação. HTML: `<div class="signature">` com o texto
  escapado, quebras em `<br>` e URLs `http(s)://` e emails viram links (`rel="noopener noreferrer"`). Assinatura vazia ou
  interruptor desligado: corpo igual. Sem duplicar se já houver a mesma assinatura no corpo.
- CA4 — O Composer (contrato 43) usa `withSignature` ao abrir novo, responder, responder a todos e encaminhar. A
  assinatura entra no campo, editável e apagável antes de enviar. Mudança mínima no Composer; o editor de assinatura é do 55.
- CA5 — Testes: escape de HTML (`<script>` vira texto), links, vazio, interruptores, sem duplicar, assinatura acima da citação.

## Invariantes
- Envio, token de clique, contrato 51: iguais. Tarefa agendada que envia (51) NÃO recebe assinatura automática.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Composer: a assinatura aparece sozinha no texto (o editor dela vem no contrato 55).
