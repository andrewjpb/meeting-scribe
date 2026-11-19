# Contrato 57 — Conectores do claude.ai: sessão, bloqueio e aprovação
Feature: desktop-shell · Wave: 1 · Depende de: 21 · PRD/Plan: `docs/specs/desktop-shell/prd-conectores-claude.md`, `plan-conectores-claude.md`

## Pré-condições
- Ler o contrato 21 (`docs/specs/_archive/desktop-shell/contracts/21-mcp-no-agente.md`) e o código: `src/main/mcp/cli.ts` e `service.ts`, `src/main/acp/agent.ts` (706-754, `mcpCallOf` e `mcpDecision`) e `src/main/acp/profiles/claude.ts` (120-175).
- O Claude real nesta máquina está logado por assinatura e tem conectores (`claude mcp list`).

## Critérios de aceite
- CA1 — **Lista:** `claude mcp list` é lido como hoje, e as linhas `claude.ai <Nome>` viram `ClaudeConnector { name, toolServer: 'claude_ai_<Nome>', state: 'connected' | 'needs-auth' | 'failed' }`. Elas deixam de cair em "não usável". Nada é lido de `~/.claude.json` para isso e nenhum endpoint do claude.ai é chamado.
- CA2 — **Gravação:** `claudeConnectors` nos 4 lugares e no índice. O padrão é vazio, ou seja, tudo desligado. Conector novo na conta nasce desligado. O `settings.json` antigo carrega igual.
- CA3 — **Sessão sem conector ligado:** as opções de `session/new` ficam IDÊNTICAS às de hoje, com `strictMcpConfig: true`. Um teste compara byte a byte com um snapshot das opções atuais.
- CA4 — **Sessão com conector ligado:** sai `strictMcpConfig`; ficam `settingSources: []` e `--restricted`. `disallowedTools` recebe o prefixo `mcp__<servidor>` de cada conector desligado, de cada servidor do escopo `user` que não foi ligado no app e de cada plugin listado. `permissions.ask` recebe `mcp__claude_ai_<Nome>` dos ligados, e as ferramentas com política Negar entram em `disallowedTools` uma a uma.
- CA5 — **Aprovação:** `mcpDecision` reconhece os conectores ligados da sessão e aplica a política. O padrão é Perguntar: o cartão do contrato 21 mostra o nome "claude.ai <Nome>", vale o tempo limite de 2 min e "Sempre permitir" grava `allow` naquela ferramenta. Conector desligado ou desconhecido é negado. Chamada que rode sem ter sido liberada cancela a resposta, como hoje. Com o app bloqueado, a chamada é negada.
- CA6 — **Onde vale:** no Assistente e nos agentes das Automações, onde os servidores MCP do 21 já valem. Tradução, resumo e análise continuam com `strictMcpConfig: true`, sem conector. Teste por tipo de sessão.
- CA7 — **Prova com o Claude real (manual, registrada no contrato):** com 2 conectores conectados, A ligado e B desligado, abrir uma sessão do Assistente e conferir:
  - pelo aviso `mcpServerStatus` do adaptador, que A está disponível e B não;
  - que uma ferramenta de B não está entre as da sessão;
  - que uma chamada a A abre o cartão.
  Se o prefixo em `disallowedTools` NÃO bloquear B, trocar pela lista de ferramentas de B vinda de `mcpServerStatus` e registrar a troca. O resultado vai, com data, em "Decisões registradas" no fim deste contrato.
- CA8 — **Login não suportado:** com `claude mcp list` sem linhas `claude.ai`, ou com estado de falta de escopo ou de chave de API, a lista fica vazia com o motivo (`'no-subscription' | 'none'`) e nada muda na sessão.
- CA9 — Testes de unidade: parser das linhas `claude.ai` (conectado, precisa autorizar, nomes com espaço e acento, colisão `(2)`), montagem das opções (CA3 e CA4), decisão (CA5), tipos de sessão (CA6) e lock-ipc, se houver canal novo.

## Invariantes
- Sem conector ligado, nada muda: mesmas opções, mesmas ferramentas e mesmos testes do contrato 21 verdes.
- Os servidores do `user` e do cadastro do app seguem com o fluxo do 21.

## Fora de escopo
- A tela (contrato 58); conectores de plugin; MCP de outros apps; OAuth dentro do app.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos, mais o CA7 registrado.

## Decisões registradas na implementação

### Automações sem conector (19/11/2026, decisão do coordenador)
Os agentes das Automações ficam SEM conector, como os servidores MCP do contrato 21 (o runner não pede `mcp`; rodam sem ninguém para responder ao cartão, e "Perguntar" só negaria depois de 2 min). O conector vale no chat que pede MCP: o Assistente e a conversa da reunião. O R6 da PRD foi corrigido pelo coordenador. Teste: `conectores.test.ts`, "o agente das Automações abre o chat sem pedir MCP".

### Conferência do que a sessão carregou (devolução, 19/11/2026)
O bloqueio por prefixo só alcança os nomes conhecidos antes de abrir. Por isso: (1) a sessão com conector usa a lista do `claude mcp list` em cache e não espera por ela; só espera quando não há cache (a primeira vez na execução, ou depois de uma mudança de MCP ou de `claudeConnectors`, que invalidam o cache; a aba Conexões que relê também o renova); com mais de 5 min, a lista renova em segundo plano depois de abrir; depois de uma falha, só tenta de novo passados 60 s (ajuste do coordenador, 19/11/2026: a lista fresca a cada sessão custava 17 s em toda conversa nova, e a segurança fica com a conferência a seguir); (2) depois do `session/new`, o app pergunta `/mcp` ao adaptador (comando local do `claude`, sem chamar o modelo; o adaptador 0.107.0 troca a resposta pela lista de `mcpServerStatus`, `dist/mcp-command.js` `formatMcpStatus`) até os conectores ligados ficarem "Connected", por até 8 s; (3) servidor carregado que não é conector ligado, nem servidor que o app passou, nem está bloqueado inteiro em `disallowedTools`, "escapou": a sessão fecha e reabre UMA vez com ele bloqueado; escapou de novo, ou a lista não veio, a conversa segue no modo estrito, sem conector, com o passo "Os conectores ficaram desligados nesta conversa: apareceu um servidor que o app não conhece." (ou "…: não deu para conferir os servidores da sessão."). Nome com `__` escapa sempre: a regra `mcp__a__b` é lida pelo `claude` como a ferramenta `b` do servidor `a` e não bloqueia o servidor, então ele leva ao modo estrito. Ligado que não conectou nos 8 s: a pergunta segue e o passo mostra "O <Nome> ainda não conectou". Código: `src/main/acp/connectors.ts` e `openAcpSession` em `agent.ts`.
Custo: com a lista em cache, abrir a sessão com conector leva a espera dos conectores (1 s a 2 s); sem cache, mais o `claude mcp list` (17 s nesta máquina); com uma reabertura, mais uma abertura.

### Ferramenta MCP sem regra `ask` no modo `default` (conferido em 19/11/2026)
- Adaptador 0.107.0 `dist/v1/acp-agent.js`: a sessão passa `permissionMode` e `canUseTool: this.canUseTool(sessionId)` ao SDK (linhas 7480-7481); `canUseTool` (linha 6576) não libera nada pelo modo da sessão (comentário das linhas 6614-6619: "Do not auto-allow here based on the session's advertised mode") e manda todo pedido ao cliente por `requestPermissionFromClient` (linha 6674), que é o `session/request_permission`.
- Agent SDK 0.3.323 `sdk.mjs` linha 165: com `canUseTool`, o `claude` sobe com `--permission-prompt-tool=stdio`, ou seja, o que precisa de permissão volta ao SDK.
- `claude` 2.1.325 (binário, sem número de linha): a ferramenta MCP responde `checkPermissions(){return{behavior:"passthrough",message:"MCPTool requires permission."}}`; sem regra `allow`, "passthrough" no modo `default` vira pergunta, que vai pelo `--permission-prompt-tool`. O app confere que o modo confirmado é `default` (`unsafeMode` do perfil). Isso é leitura do código, não prova de execução: a rede de segurança do app (ferramenta MCP que roda sem ter passado pela política cancela a resposta) continua valendo se isso mudar numa versão do `claude`.

### CA7 — prova com o `claude` real (19/11/2026, `claude` 2.1.325, adaptador 0.107.0, login por assinatura)
Roteiro: `apps/desktop/test/conectores-live.test.ts` (fora dos gates, `ACP_LIVE_CONNECTORS=1`). A = **Notion** ligado, B = **Claude Docs** desligado (o Figma oscilou entre "Conectado" e "Falhou" entre duas leituras do `claude mcp list` e foi trocado). Sessão de chat aberta pela fábrica do app, com `settingSources: []`, `--restricted`, sem `strictMcpConfig`, `permissions.ask: ["mcp__claude_ai_Notion"]` e o prefixo de cada servidor conhecido em `disallowedTools`.
- **Prova estrutural (a lista da sessão pelo `/mcp`, sem chamar o modelo):** a sessão carregou 17 servidores, todos conectores do claude.ai; nenhum do escopo `user` nem de plugin (`settingSources: []` já os deixa de fora; nenhum processo stdio do `~/.claude.json` rodou). O Notion está "Connected" e liberado. **O Claude Docs, desligado, também aparece "Connected" (8 ferramentas)**: o bloqueio por prefixo não impede o conector desligado de conectar (a rede e o login dele acontecem); ele só tira as ferramentas dele do modelo. O Claude Docs está bloqueado inteiro em `disallowedTools`, e nada ficou fora do bloqueio.
- **A conferência funcionou de verdade:** a primeira abertura achou 1 servidor fora do bloqueio (um conector da conta que o `claude mcp list` não mostra, provavelmente porque a lista o junta a um servidor do escopo `user` com o mesmo endereço) e reabriu a sessão uma vez com ele bloqueado; a segunda passou. Abertura total: 22,7 s.
- **Ferramentas (rodada anterior, pelo que o modelo disse):** 77 ferramentas `mcp__claude_ai_Notion__…`, o mesmo número do status, e nenhuma do Claude Docs nem de outro conector conectado. Fica como evidência complementar; a prova que vale é a estrutural acima.
- **Primeira pergunta:** sem a espera, a primeira pergunta logo depois de abrir não tinha nenhuma ferramenta do conector (o Notion conectou 0,8 s depois do primeiro pedido ao modelo). Com a espera, a abertura só devolve a sessão com o Notion "Connected".
- **Cartão:** "procure 'reunião' no Notion" pediu `notion-search` e abriu o cartão `server: "claude.ai Notion"`, `tool: "notion-search"`, args `{ "query": "reunião" }`; "Permitir uma vez" concluiu, 10 resultados. Nenhuma ferramenta de escrita foi chamada; nada pediu login nem aprovação fora do app.
