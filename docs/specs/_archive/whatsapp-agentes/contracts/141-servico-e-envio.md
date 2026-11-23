# Contrato 141 — Atendimento no WhatsApp: serviço, envio pelo agente e gancho de mensagens

Feature: whatsapp-agentes  ·  Wave: 3  ·  Depende de: 138, 139, 140

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Contratos 138, 139 e 140 aceitos e commitados: existem `shared/atendimento.ts`,
  `main/whatsapp/atendimento/{store,log,reply,scheduler}.ts` e os canais `scribe:atendimento-*` de configuração.
- `pnpm typecheck && pnpm lint && pnpm test` verdes.
- Decisão do dono (23/11/2026): conversas marcadas podem ser respondidas sem clique. É a única exceção à regra "nenhuma IA envia" do contrato 24.

## Contexto mínimo
Este contrato liga as peças: cada mensagem nova do WhatsApp passa pelo serviço de atendimento,
que decide com o agendador (140), gera a resposta com o motor (139) e, no modo automático,
envia por um caminho novo e estreito. Hoje o envio só existe com token de clique
(`main/whatsapp/send-guard.ts`, `service.send` em `main/whatsapp/service.ts`, `client.send` em
`main/whatsapp/client.ts` conferindo a `SendProof`). O gancho de entrada é o `onMessage` do
serviço do WhatsApp em `main/index.ts` (procure por `scribe:whatsapp-message`). Notificação
local: mesmo mecanismo de `main/whatsapp/notify.ts`. Presença "digitando": rota
`POST /chats/:id/presence` do serviço local (veja se `client.ts` já a expõe; se não, acrescente).

## Superfície
- Criar `apps/desktop/src/main/whatsapp/atendimento/service.ts`.
- Alterar `apps/desktop/src/main/whatsapp/send-guard.ts`, `service.ts`, `client.ts`.
- Alterar `apps/desktop/src/main/index.ts` (instanciar, ligar ao `onMessage`, handlers, `dispose` na saída).
- Alterar `apps/desktop/src/shared/atendimento.ts`, `shared/atendimento-schema.ts`, `shared/ipc.ts`, `apps/desktop/src/preload/index.ts` (canais e tipos novos abaixo).
- Alterar `apps/desktop/test/whatsapp.test.ts` (invariantes do envio). Criar `apps/desktop/test/atendimento-service.test.ts`.

### Prova de envio do agente (`send-guard.ts`)
`AgentSendProof`: ligada a um `chatId`, uso único, validade de 30 s. Só é emitida por uma
autoridade criada na montagem do app e entregue **apenas** ao serviço de atendimento. `client.send`
aceita `SendProof` (clique) ou `AgentSendProof`; confere tipo, validade, uso único e que o
`chatId` da prova é o do envio.

### Canais novos (todos `refused` em `WHEN_LOCKED`)
- `scribe:atendimento-runtime` → `{ [chatId]: { dueAt: string | null; draft: { text: string; at: string; agentId: string } | null; handedOffAt: string | null } }`.
- `scribe:atendimento-agent-test` (`{ agent: campos do formulário; about: string; message: string }`) → `{ ok: true, decision } | { ok: false, error }`.
- `scribe:atendimento-draft-send` (`{ chatId; text }`, com token de clique no mesmo esquema do `scribe:whatsapp-send`: o preload exige `navigator.userActivation.isActive` e registra o clique antes).
- `scribe:atendimento-draft-discard` (`{ chatId }`).
- Evento `scribe:atendimento-changed` (`{ chatId }`) para as janelas, só com o app desbloqueado.
- Os handlers de `binding-save`, `binding-delete`, `agent-delete` e `pause-all` do contrato 138 passam a avisar o serviço (ver CA12 e CA13).

## Critérios de aceite
Testes com relógio, temporizador, motor e cliente do WhatsApp falsos, salvo indicação.

- CA1. Mensagem `fromMe: false` em conversa **sem** atendimento: nenhuma chamada ao agendador, ao motor ou ao cliente; nenhuma linha no histórico.
- CA2. Atendimento `auto`, atraso 0, motor devolvendo `responder`: exatamente um `client.send` para aquele `chatId` com o texto do motor; linha `sent` com o `messageId` devolvido; `scheduler.recordSent` chamado.
- CA3. `typing: true` e texto de 60 caracteres: a presença "digitando" é enviada, o envio acontece 4 s depois (1 s a cada 15 caracteres, mínimo 2 s, máximo 12 s) e a presença é encerrada. `typing: false`: nenhuma chamada de presença.
- CA4. Antes de enviar (depois da espera do "digitando"), o serviço relê o estado: se o atendimento foi desligado, pausado, trocado para `draft`, ou `pausedAll` foi ligado nesse intervalo, não envia e registra `cancelled`.
- CA5. Modo `draft`: nenhum `client.send`; a proposta fica em memória (uma por conversa, a nova substitui a anterior); linha `drafted`; evento `scribe:atendimento-changed`; `atendimento-runtime` devolve o `draft`.
- CA6. `draft-send` com token de clique válido: envia pelo caminho de clique existente (`SendProof`), com o texto recebido (pode ter sido editado), limpa a proposta e registra `draft-sent`. Sem token de clique válido: recusado, proposta mantida. `draft-discard`: limpa e registra `draft-discarded`.
- CA7. Motor devolve `passar`: nenhum envio; linha `handed-off` com o motivo; notificação local "<agente> passou a conversa com <nome> para você"; `handedOffAt` preenchido no runtime.
- CA8. Motor devolve `falhou` (ou lança): nenhum envio; linha `failed`; mesma notificação do CA7.
- CA9. Mensagem `fromMe: true` cujo id **não** saiu do atendimento: resposta pendente cancelada (`cancelled` se havia pendência), proposta descartada, `pausedUntil = agora + pauseOnMyReplyMinutes` gravado (nada gravado se for 0), linha `paused`, `handedOffAt` zerado.
- CA10. Mensagem `fromMe: true` que é eco de um envio do próprio atendimento (automático ou `draft-send`) **não** pausa: vale tanto quando o eco chega depois do retorno do envio (id conhecido) quanto quando chega antes (conversa marcada como "enviando").
- CA11. Resultado `skipped` do agendador com `out-of-hours` ou `rate-limited` gera a linha correspondente no histórico (no máximo uma por conversa a cada 10 min, para não inundar); os outros motivos não geram linha.
- CA12. `pause-all` com `true`: todas as pendências canceladas (uma linha `cancelled` por conversa) e nenhuma mensagem nova é agendada; com `false`, volta ao normal sem responder ao que chegou durante a pausa.
- CA13. Salvar um atendimento com `enabled: false`, apagar o atendimento ou excluir o agente: pendência e proposta daquela(s) conversa(s) são descartadas.
- CA14. Evento com `at` anterior ao início do serviço, ou mais velho que 5 minutos, é ignorado (reconexão do SSE não gera resposta a mensagem antiga).
- CA15. O histórico usado no prompt são as últimas 50 mensagens daquela conversa, lidas do serviço local no momento de responder; `firstReplyToday` é verdadeiro quando não há linha `sent` ou `draft-sent` daquela conversa no dia local corrente; `ownerName` vem de onde o app já guarda o nome da conta conectada.
- CA16. O envio do agente **não** passa pela correção ao enviar (`main/whatsapp/correct.ts`); o envio com clique continua passando como hoje.
- CA17. `client.send` sem prova, com `AgentSendProof` vencida, já usada ou emitida para outro `chatId`: recusado. `AgentSendProof` para `chatId` terminando em `@g.us` nunca é emitida.
- CA18. Teste estático: a função que emite `AgentSendProof` só é referenciada em `main/whatsapp/send-guard.ts`, `main/whatsapp/atendimento/service.ts` e na montagem em `main/index.ts`. `apps/desktop/test/tray-automations.test.ts` passa **sem alteração**.
- CA19. `agent-test`: devolve a decisão do motor para a mensagem de exemplo; não grava histórico, não agenda, não envia, não notifica.
- CA20. Com o app bloqueado, o serviço continua recebendo, agendando e respondendo; os canais IPC acima são recusados; o evento `atendimento-changed` não é emitido; a notificação de passagem segue a mesma regra de conteúdo que `notify.ts` aplica com o app bloqueado.
- CA21. Na saída do app, `dispose` limpa temporizadores e propostas; nenhum envio ocorre depois.
- CA22. Nenhum log do app contém texto de mensagem, de resposta ou das regras do agente.

## Invariantes
- Envio com clique na tela do WhatsApp continua igual (token de uso único, 10 s). Os casos existentes de `whatsapp.test.ts` continuam passando; os do describe "nenhum caminho fora do clique alcança o envio (CA4)" só mudam onde for necessário para reconhecer a segunda prova, sem afrouxar nenhuma outra verificação.
- "Rascunho com o Claude", notificações, Detalhes e demais recursos do WhatsApp não mudam.
- Automações, tarefas agendadas, chat e Assistente continuam sem acesso ao envio.
- Nenhuma tela muda.

## Fora de escopo
- Componentes React e store do renderer (contratos 142 e 143).
- Checks e prints do smoke para a feature (contrato 144); o smoke existente precisa continuar verde.
- Grupos, mídia, mensagens antigas.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz (8 passos, cerca de 20 minutos; exige a tela do Mac acesa e desbloqueada). Testes novos: um caso por critério CA1 a CA21.

## Relatório final
Arquivos criados e alterados; resultado de cada passo dos gates com contagens; o que mudou em `whatsapp.test.ts` e por quê; critérios não cumpridos ou adaptados. Não commitar.
