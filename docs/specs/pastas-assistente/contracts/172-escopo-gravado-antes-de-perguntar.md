# Contrato 172 — Assistente: a troca de fonte no Contexto vale já na pergunta seguinte

Feature: pastas-assistente (correção de produto encontrada no smoke do 169; vale para todas as fontes)  ·  Wave: 5  ·  Depende de: 169  ·  Gate humano: —

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-pastas-assistente`, branch `pastas-assistente`, 169 commitado; gates rápidos verdes.
- Só renderer: `apps/desktop/src/renderer/src/features/chat/ChatConversation.tsx` e um teste. Nada no main, nada em `ChatMessages.tsx` (outra frente vai tocá-lo), nada no smoke além de, opcionalmente, remover a espera que o 169 pôs em `setPastas` se ela ficar desnecessária (deixar como está é aceitável).

## Contexto mínimo
Numa conversa salva, trocar uma fonte no painel Contexto só grava o escopo 300 ms depois (`changeScope` → `pendingScope` → timer `SCOPE_DELAY_MS` → `useChat.update(chatId, { scope })`, `ChatConversation.tsx:46, :236-247`). Se o usuário perguntar antes disso, `send()` (`:171-194`) manda a pergunta sem o escopo novo e o main usa o `chat.scope` antigo: desligar Pastas (ou Email, WhatsApp…) e perguntar em seguida ainda envia a fonte ao Claude, contra o que a tela mostra. O `flushScope` seguinte é recusado ("Espere a pergunta começar…"). O smoke do 169 contornou esperando a gravação; este contrato corrige o produto.

## Superfície
- `ChatConversation.tsx`: em `send()` e em `redo()` (e em qualquer outro caminho que dispare uma pergunta), se houver `scopeTimer.current`/`pendingScope` pendente, limpar o timer e **aguardar** `useChat.getState().update(chatId, { scope: pendingScope })` antes de enviar; falha na gravação → não envia e mostra o erro como as outras falhas de `update`. Extrair a lógica para uma função pura/testável (`flushPendingScope`) se ajudar.
- Teste: `apps/desktop/test/renderer/chat-scope-flush.test.ts` (ou acréscimo no teste existente de `ChatConversation`/`useChat` se houver): troca de fonte + `send` imediato → `update` chamado com o escopo novo **antes** de `send`; sem troca pendente → `update` não é chamado; troca + espera > 300 ms + `send` → `update` uma vez só (pelo timer), não duas.

## Critérios de aceite
- CA1: Com `pendingScope` diferente do escopo gravado, `send()` grava o escopo e só depois envia; a ordem é provada por teste (espião com registro de chamadas).
- CA2: `redo()` segue a mesma regra.
- CA3: Sem troca pendente, nenhum `update` extra; o timer de 300 ms continua valendo quando não há pergunta.
- CA4: Se `update` falhar, a pergunta não é enviada e a mensagem de erro aparece como as demais.
- CA5: typecheck, lint e testes verdes; o comportamento visível das fontes no smoke não muda (`pnpm gates` roda na junção final, não aqui).

## Invariantes
- Nenhum arquivo do main; nenhum canal novo; `ChatMessages.tsx` intocado.

## Fora de escopo
- Mudar o atraso de 300 ms; persistir o escopo a cada clique.

## Gates
- `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` da raiz do worktree.

## Relatório esperado do implementador
≤ 20 linhas: arquivos, contagem de testes, como garantiu a ordem, dúvidas resolvidas sozinho.
