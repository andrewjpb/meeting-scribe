# Contrato 53 — Conectores do claude.ai: sessão, bloqueio e aprovação
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
- A tela (contrato 54); conectores de plugin; MCP de outros apps; OAuth dentro do app.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos, mais o CA7 registrado.
