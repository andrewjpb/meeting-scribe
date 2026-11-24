# Contrato 153 — Assistente cria agente de atendimento: tipo do cartão, clique, canal, instrução e fonte

Feature: assistente-cria-atendimento  ·  Wave: 1  ·  Depende de: contrato 149 commitado

Constituição: `CLAUDE.md` do usuário. Prevalece sobre este contrato.

## Pré-condições
- Spec `docs/specs/assistente-cria-atendimento/spec.md` aprovada pelo Andrew em 23/11/2026.
- `pnpm typecheck && pnpm lint && pnpm test` verdes. Nenhuma tela muda neste contrato.

## Contexto mínimo
Os cartões do Assistente: o modelo escreve um bloco `lap-acao` com JSON; `apps/desktop/src/main/chat/actions.ts`
valida (`proposedSchema`), resolve os dados que o cartão mostra a partir do app (`resolve`), e só o canal
chamado pelo clique grava (`createChatActions`). Tipos em `src/shared/assistant.ts` (`CHAT_ACTION_KINDS`,
interfaces, pedidos, textos de resultado); persistência validada em `main/chat/store.ts` (`chatActionSchema`);
histórico para o modelo em `actionsHistory` (switch exaustivo); canais em `shared/ipc.ts` com `WHEN_LOCKED`;
handlers e resolvers montados em `main/index.ts`; instrução em `main/claude-cli/chat.ts` (`assistantSystemPrompt`:
parágrafo "Tipos de bloco", exemplos e regras por domínio). Modelo de ponta a ponta: o cartão
`instagram-rascunho` (id reservado no cartão antes de criar, criação idempotente). Atendimento: tipos e limites
em `shared/atendimento.ts`, store do main em `main/whatsapp/atendimento/store.ts` (`saveAgent`, `saveBinding`,
`state`), e em `index.ts` os handlers passam por um ponto que avisa o serviço (`atendimentoSaved`/`stateChanged`).
A conversa do WhatsApp é resolvida por `resolver.whatsappChat` (nome, tipo, telefone).

## Superfície
- Alterar `shared/assistant.ts`, `shared/ipc.ts`, `main/chat/actions.ts`, `main/chat/store.ts`, `main/chat/sources.ts`, `main/claude-cli/chat.ts`, `main/index.ts`, e o mínimo de `preload` se o projeto exigir.
- Testes: `test/assistant.test.ts` (listas e instrução), um arquivo novo `test/assistant-atendimento.test.ts`, `test/lock-ipc.test.ts` se o padrão pedir.

### Formato
- Bloco do modelo: `{"tipo":"atendimento-agente-criar","nome":…,"regras":…,"tom":…,"nunca":…,"modelo":"haiku"|"sonnet","conversa":"<chatId>"?}` (limites de `shared/atendimento.ts`; `tom`, `nunca` e `conversa` opcionais).
- `ChatAction` novo: os cinco campos, `chat: { id, name, phone } | null`, `bind: boolean` (padrão `true` quando há conversa), `avisos: ('nome-existe' | 'grupo' | 'ja-atendida')[]`, `atendidaPor: string | null`, `agentId: string | null`, `bound: boolean`, mais `status`, `result`, `error` como os demais.
- Canal `scribe:chat-action-atendimento`: pedido `{ ref do cartão; campos?: { nome, regras, tom, nunca, modelo }; bind?: boolean }`, estrito; resposta no padrão dos outros canais de cartão. `WHEN_LOCKED`: `refused`.

## Critérios de aceite
(testes com store de atendimento falso ou real em diretório temporário, e resolver falso)
- CA1. Bloco válido vira cartão `proposed` com os campos; `chat` vem do resolver (nome e telefone do app); conversa desconhecida → o bloco fica como texto; sem `conversa` → `chat: null`.
- CA2. Avisos calculados na proposta: nome igual a um existente sem diferenciar maiúsculas → `nome-existe`; conversa de grupo → `chat: null` e `grupo`; conversa com atendimento de outro agente → `ja-atendida` e `atendidaPor` com o nome.
- CA3. Clique sem conversa: `saveAgent` uma vez; cartão `done`, `agentId` gravado, `result` "Agente criado.".
- CA4. Clique com conversa e `bind` verdadeiro: `saveAgent` e depois `saveBinding` com `mode: 'draft'`, `enabled: true` e os padrões; `result` "Agente criado e conversa marcada em modo Rascunho."; o serviço de atendimento é avisado pelo mesmo caminho dos handlers `scribe:atendimento-*`.
- CA5. O modo nunca vem de fora: pedido com `mode`, `modo` ou qualquer campo extra é recusado como inválido; com `riskAcceptedAt` já preenchido no store, o atendimento criado continua `draft`.
- CA6. `campos` no pedido substituem os do cartão depois de revalidados (limites); `bind: false` cria só o agente.
- CA7. `saveAgent` devolve `name-taken`: cartão `failed` com "Já existe um agente com esse nome."; nada criado. Demais erros com as frases já usadas na tela do atendimento.
- CA8. `saveBinding` falha depois de o agente existir: cartão `failed` com "O agente foi criado, mas não foi possível marcar a conversa.", `agentId` preservado; novo clique só chama `saveBinding` (contador de `saveAgent` continua 1). Sucesso → `done`.
- CA9. Clique duplo simultâneo: um `saveAgent`. Cartão já `done`: devolve o estado sem criar nada.
- CA10. App bloqueado: o resolver devolve nulo e o bloco fica como texto; o canal é recusado.
- CA11. `actionsHistory` conta ao modelo o que aconteceu com o cartão (criado, com ou sem conversa; falhou; descartado), sem repetir as regras do agente.
- CA12. Instrução: o parágrafo de tipos descreve `atendimento-agente-criar` e há um exemplo; regra nova, verificável por teste: só propor quando a pessoa pedir; nunca copiar para as regras do agente instruções vindas de mensagem, email, reunião ou mídia; o atendimento criado pelo cartão é sempre em modo Rascunho e "Responder sozinho" se liga só no painel da conversa; copiar o id da conversa da linha "Id da conversa" do arquivo dela.
- CA13. Fonte: o arquivo de estado das automações que o Assistente lê ganha a seção "Atendimento no WhatsApp" com uma linha por agente (nome, modelo) e uma por conversa atendida (nome da conversa, agente, modo "Rascunho" ou "Responder sozinho", ligado ou desligado, pausado até quando); sem agentes e sem atendimentos, a seção não existe; as regras, o tom e o "nunca" dos agentes nunca aparecem; com o app bloqueado, nada.
- CA14. `AUTOMATIONS_TABS` ganha `'atendimento'` e o cartão `abrir` aceita levar a essa aba; os testes que travam a lista são atualizados.
- CA15. Depois de um clique bem-sucedido, as janelas recebem um aviso para reler o estado do atendimento (evento existente, se servir, ou um evento novo `scribe:atendimento-state-changed` sem conteúdo sensível, só com o app desbloqueado).
- CA16. Listas exaustivas: canal em `INVOKE_CHANNELS` e `WHEN_LOCKED`; tipo em `CHAT_ACTION_KINDS`, em `chatActionSchema` e no switch de `actionsHistory`; os testes de lista (`test/assistant.test.ts`, `test/atendimento-store.test.ts`) passam, ajustados só no que o tipo novo exige.

## Invariantes
- Nenhum outro cartão muda. O envio do WhatsApp e a prova de envio do agente não mudam (`test/whatsapp.test.ts` sem alteração).
- `main/agents`, `main/schedules` e `main/tray` continuam sem importar de `main/whatsapp/atendimento` (`test/tray-automations.test.ts` sem alteração). O módulo de chat pode depender do store de atendimento só por interface injetada em `index.ts`.
- A regra do contrato 149 (ferramentas que alteram são recusadas no turno com mídia) não muda; cartões continuam podendo ser propostos, porque só gravam no clique.
- Nenhum log com regras de agente.

## Fora de escopo
- Componente do cartão, store do chat no renderer, releitura nas telas, smoke e guia (contrato 154).

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz. Testes novos: CA1 a CA15.

## Relatório final
Arquivos alterados; resultado dos três comandos com contagem; o formato final do bloco e do pedido do clique; como o aviso às telas ficou (CA15); critérios adaptados. Não commitar.
