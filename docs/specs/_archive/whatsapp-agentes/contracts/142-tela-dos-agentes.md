# Contrato 142 — Atendimento no WhatsApp: store do renderer e aba "Atendimento" das Automações

Feature: whatsapp-agentes  ·  Wave: 4  ·  Depende de: 141

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contrato 141 aceito e commitado: canais `scribe:atendimento-*` e o método `atendimentoDraftSend` do preload existem.
- Desenho aprovado pelo Andrew em 23/11/2026: `docs/specs/whatsapp-agentes/mockups/png/04-automacoes-atendimento-claro.png`, `-escuro.png` e `05-formulario-agente-claro.png` (fonte: `mockups/WhatsAppAtendimento.dc.html`, telas 04 e 05). Em dúvida de aparência, vale o mockup; em dúvida de texto, vale este contrato.
- `pnpm typecheck && pnpm lint && pnpm test` verdes.

## Contexto mínimo
Os agentes de atendimento (tipo `AtendimentoAgent`, `shared/atendimento.ts`) são separados dos agentes das
Automações, mas a tela deles é uma quarta aba em Automações. Siga os padrões da aba Agentes:
`features/agents/AutomationsScreen.tsx` (constante `TABS`, `TABS_ID = 'automations'`), `AgentsTab.tsx`
(lista de cartões, formulário no lugar da lista, exclusão confirmada na própria linha), `AgentForm.tsx`
(`FormField`, `AREA_CLASS`, `Segmented`, seção de teste), `automationsStore.ts` (carga, `rereadWhenUnlocked`,
tradução de erro) e a tabela à mão de `features/schedules/RunsTab.tsx`. O renderer chama
`window.__scribeApi.invoke(canal, payload)` e assina eventos com `window.__scribeApi.on(canal, cb)`.
Não existe teste de componente no projeto (vitest em `node`): a lógica testável fica em funções puras e no store.

## Superfície
- Criar `apps/desktop/src/renderer/src/features/atendimento/atendimentoStore.ts`, `format.ts`,
  `AtendimentoTab.tsx`, `AtendimentoAgentForm.tsx`, `AtendimentoLog.tsx`.
- Alterar `features/agents/AutomationsScreen.tsx` e o tipo `AutomationsTab` em `features/agents/automationsStore.ts` (quarta aba, valor `'atendimento'`).
- Alterar `apps/desktop/src/main/smoke.ts` **somente** na lista esperada de abas das Automações (hoje `['Agentes','Agendamentos','Execuções']`, perto da linha 8378), que passa a terminar com `'Atendimento'`.
- Criar `apps/desktop/test/renderer/atendimento-store.test.ts` e `apps/desktop/test/renderer/atendimento-format.test.ts`.

### Store (`useAtendimento`) — completo, já servindo o contrato 143
Estado: `loaded`, `failure: string | null`, `state: AtendimentoState | null`, `runtime: AtendimentoRuntime`,
`log: AtendimentoLogEntry[]`, `logChatId: string | null` (filtro do histórico).
Ações: `load()`, `loadRuntime()`, `loadLog(chatId?)`, `saveAgent(input)`, `deleteAgent(id)`,
`testAgent({ agent, about, message })`, `saveBinding(input)`, `deleteBinding(chatId)`, `pauseAll(paused)`,
`acceptRisk()`, `discardDraft(chatId)`, `setLogChatId(chatId | null)`.
O envio da proposta **não** entra no store: é chamado direto do `onClick` (contrato 143).

### Funções puras (`format.ts`)
`logActionLabel(action)`, `logDetail(entry)`, `logWhen(iso, now)`, `agentUsage(agentId, bindings)`,
`duplicateName(name, existing)`, `chatLabel(chatId, chats)`.

## Critérios de aceite

### Store (testes com `window.__scribeApi` falso, no padrão de `test/renderer/email-store.test.ts`)
- CA1. `load()` chama `scribe:atendimento-state` e `scribe:atendimento-runtime`, preenche `state` e `runtime` e marca `loaded`. Chamadas seguidas enquanto uma está em curso viram uma só leitura extra.
- CA2. `load()` com recusa por app bloqueado usa `rereadWhenUnlocked` (não grava `failure`); com outra falha, `failure = 'Não foi possível ler os atendimentos.'`.
- CA3. Na primeira `load()`, o store assina `scribe:atendimento-changed` uma única vez; a cada evento, relê só o runtime.
- CA4. `saveAgent`, `deleteAgent`, `saveBinding`, `deleteBinding`, `pauseAll` e `acceptRisk`: com `ok: true`, o `state` devolvido pelo canal substitui o do store sem nova leitura (se a resposta não trouxer `state`, chama `load()`); com `ok: false`, devolvem `{ ok: false, reason }` com a frase abaixo e não mudam o store.
- CA5. Frases de erro: `name-taken` → "Já existe um agente com esse nome."; `agent-not-found` → "Esse agente não existe mais."; `group-not-allowed` → "Atendimento não funciona em grupos."; `not-found` → "Não encontrado. Atualize a tela."; `invalid` → "Confira os campos e tente de novo."; qualquer outro → "Não foi possível salvar." `risk-required` **não** vira frase: `saveBinding` devolve `{ ok: false, reason: 'risk-required' }` para o painel abrir o aviso (contrato 143).
- CA6. `testAgent` devolve `{ ok: true, decision, ms }` (tempo medido no renderer) ou `{ ok: false, reason: 'Não foi possível testar agora.' }`; não altera `state`, `runtime` nem `log`.
- CA7. `loadLog(chatId?)` chama `scribe:atendimento-log-list` com `{ limit: 200, chatId }` e guarda as entradas na ordem recebida (mais recente primeiro). `setLogChatId` guarda o filtro e relê.
- CA8. `discardDraft(chatId)` chama `scribe:atendimento-draft-discard` e relê o runtime.

### Funções puras (um teste por linha)
- CA9. `logActionLabel`: `sent` "Respondeu"; `drafted` "Propôs"; `draft-sent` "Você enviou a proposta"; `draft-discarded` "Você descartou a proposta"; `handed-off` "Passou para você"; `paused` "Pausou"; `cancelled` "Cancelou a resposta"; `rate-limited` "Limite atingido"; `out-of-hours` "Fora do horário"; `failed` "Não conseguiu responder".
- CA10. `logDetail(entry)` devolve `entry.reason` quando existe e `''` quando não; nunca devolve `messageId`.
- CA11. `logWhen`: mesmo dia local → "Hoje, 14:51"; dia anterior → "Ontem, 23:10"; mais antigo → "20/11, 09:02".
- CA12. `agentUsage(agentId, bindings)` conta só atendimentos com `enabled: true`: 0 → "Nenhuma conversa"; 1 `auto` → "1 conversa · Responder sozinho"; 2 `draft` → "2 conversas · Rascunho"; modos misturados → "3 conversas · Rascunho e sozinho".
- CA13. `duplicateName('Recados', ['Recados'])` → "Recados (cópia)"; já existindo essa, "Recados (cópia 2)"; o resultado nunca passa de 60 caracteres (corta o nome original).
- CA14. `chatLabel(chatId, chats)` devolve o nome da conversa quando ela está na lista do WhatsApp; senão, o número antes do `@` (sem o sufixo).

### Tela (conferida por leitura do código e pelo smoke do contrato 144)
- CA15. `TABS` tem quatro itens, nesta ordem: "Agentes", "Agendamentos", "Execuções", "Atendimento". Os ids das três primeiras não mudam (`#automations-tab-tarefas`, `#automations-tab-execucoes`); a nova é `#automations-tab-atendimento` e o painel leva `data-automations-tab="atendimento"`.
- CA16. Ao abrir a aba, `useAtendimento.load()` e `loadLog()` são chamados. Sem `loaded` e com `failure`, mostra a frase; sem `loaded`, `aria-busy`.
- CA17. Topo: frase "Respondem as conversas do WhatsApp que você marcar. Cada um só lê a conversa em que atua." e botão "Novo agente" (`data-action="atendimento-agent-new"`). Sem agentes: `<p data-atendimento-empty>` com "Nenhum agente de atendimento ainda. Crie um e depois marque a conversa na tela do WhatsApp."
- CA18. Cada cartão (`data-atendimento-agent="<id>"`): nome, primeira linha das regras (cortada com reticências), "<Haiku|Sonnet> · <agentUsage>" e as ações "Editar", "Duplicar", "Excluir". "Duplicar" salva uma cópia com `duplicateName`. "Excluir" confirma na própria linha: "Excluir este agente? As conversas que ele atende ficam desligadas." / "Excluir" / "Cancelar". Erro em `Note role="alert"`.
- CA19. Formulário (no lugar da lista), título "Novo agente de atendimento" ou "Editar agente de atendimento". Campos e dicas, com estes textos:
  - "Nome" (máximo 60).
  - "Regras" (textarea, contador "N/8.000"): "O que o agente pode tratar e quando passa a conversa para você. Com criança ou adolescente na conversa, limite os assuntos e mande passar para você em tema sensível."
  - "Tom" (máximo 500): "Como ele escreve."
  - "Modelo" (`Segmented` "Haiku" / "Sonnet"): "Haiku responde mais rápido. Sonnet entende melhor conversas longas."
  - "Nunca diga ou prometa" (textarea, contador "N/2.000"): "Vale acima das regras. Perguntado se é um robô, o agente sempre passa para você."
  - Rodapé "Salvar" (`data-action="atendimento-agent-save"`, desabilitado com nome ou regras vazios) e "Cancelar". Os limites vêm das constantes de `shared/atendimento.ts`, não de números repetidos.
- CA20. Seção "Testar" (`data-atendimento-test`) dentro do formulário: texto "Escreva uma mensagem de exemplo e veja a resposta que o agente daria, com as regras como estão no formulário."; campo da mensagem (máximo 2.000); botão "Testar" (`data-action="atendimento-agent-test"`), desabilitado com mensagem ou regras vazias e enquanto roda. Usa os valores **atuais do formulário**, sem salvar, e `about: ''`. Resultado: "Responderia" + o texto, ou "Passaria para você" + o motivo, seguido de "<Modelo> · <segundos com uma casa> s"; falha em `Note role="alert"`. Rodapé fixo: "Nada é enviado. O teste não entra no histórico."
- CA21. Histórico (`data-atendimento-log`), abaixo dos cartões: título "Histórico", frase "Só o que aconteceu, sem o texto das mensagens", filtro `Select` com "Todas as conversas" e uma opção por conversa que tem atendimento ou linha no histórico (rótulo por `chatLabel`). Tabela com as colunas "Quando" | "Conversa" | "Agente" | "O que fez" | "Detalhe", preenchidas por `logWhen`, `chatLabel`, nome do agente (ou "Agente excluído"), `logActionLabel` e `logDetail`. Sem linhas: "Nada aconteceu ainda."
- CA22. Design: só componentes de `src/renderer/src/design/` e classes já usadas nas abas vizinhas; nenhuma cor fora das variáveis; nenhum modal; ícones `lucide-react` de 16 px; tema claro e escuro sem código próprio por tema.

## Invariantes
- As abas Agentes, Agendamentos e Execuções não mudam (nem textos, nem ids, nem comportamento).
- `AUTOMATIONS_TABS` em `shared/assistant.ts` não muda (o "Abrir" do Assistente não abre a aba nova) e `test/assistant.test.ts` passa sem alteração. Se o typecheck exigir tocar nessa lista, pare e relate em vez de alterar.
- O renderer não importa `shared/atendimento-schema.ts` nem nada de `src/main`.
- Nenhum arquivo de `src/main` muda, fora a linha do smoke citada. Nenhum canal novo.
- A tela do WhatsApp não muda neste contrato.

## Fora de escopo
- Painel da conversa, selos, proposta, "Pausar todos", aviso de risco (contrato 143).
- Checks e prints novos no smoke, README e guia (contrato 144).
- Abrir a aba pelo Assistente.

## Gates
`pnpm typecheck && pnpm lint && pnpm test`, da raiz. O smoke completo roda no contrato 143; por isso a linha
da lista de abas em `smoke.ts` tem de ser atualizada aqui. Testes novos: CA1 a CA14.

## Relatório final
Arquivos criados e alterados; resultado dos três comandos com contagem de testes; o que ficou diferente do
mockup e por quê; critérios não cumpridos ou adaptados. Não commitar.
