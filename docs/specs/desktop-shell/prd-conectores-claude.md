---
status: especificado
feature: desktop-shell
contratos: [57, 58]
data: 2026-11-19
---

# PRD — Conectores do claude.ai no agente do app

Pedido do Andrew (19/11/2026, às 12:30): "quero usar todos os conectores do Claude MCP na ferramenta, com algo para permitir e bloquear o acesso a cada um". Hoje a tela Configurações › Conexões lista os conectores (ex.: "claude.ai Claude Docs") com a mensagem "Não dá para usar no app: este servidor não está no escopo user".

## Problema e objetivo
O Andrew já tem conectores ligados na conta do claude.ai (Notion, Figma, Google Drive e Calendar, Gmail, Microsoft 365...). O agente do app (Claude pelo ACP) não os vê, porque o app abre a sessão em modo restrito. O objetivo é deixar o Andrew ligar cada conector no app, um por um, com a mesma aprovação por ferramenta do contrato 21. O app nunca toca no login: o login do conector fica com o próprio Claude.

## Evidência técnica (investigação de 19/11, no `claude` 2.1.325 e no SDK 0.3.323)
- O app manda `strictMcpConfig: true` (`src/main/acp/profiles/claude.ts:161`), que vira `--strict-mcp-config`. O `claude` então põe a sessão no estado `restricted`: "claude.ai connectors are not loaded in this session". O adaptador ACP não filtra nada.
- Os conectores dependem do login por assinatura (OAuth com o escopo `user:mcp_servers`). Com chave de API ou provedor terceiro, não existem.
- Os nomes são: servidor `claude.ai <Nome>` e ferramentas `mcp__claude_ai_<Nome>__<ferramenta>`. Essa forma já casa com o `mcpToolServerName` do app (`shared/mcp.ts:244`).
- A lista vem de `claude mcp list`, que o app já roda: são as linhas `claude.ai …` com o estado (conectado ou precisa de autorização).
- A aprovação do contrato 21 (`src/main/acp/agent.ts:706-754`) nega hoje porque o conector não está na lista da sessão (linha 733).
- A ligar e desligar por conector se faz com `disallowedTools` por prefixo `mcp__<servidor>`. É inferência e precisa ser provada no contrato 57.

## Requisitos
- R1 QUANDO o Claude está logado por assinatura, O SISTEMA DEVE listar em Configurações › Conexões cada conector do claude.ai, com o estado (Conectado ou Precisa autorizar) e um interruptor desligado por padrão.
- R2 QUANDO o Andrew liga um conector, O SISTEMA DEVE deixar o agente usar SÓ as ferramentas dele. Conectores desligados, servidores do `~/.claude.json` desligados e conectores de plugin continuam inalcançáveis.
- R3 QUANDO o agente chama uma ferramenta de conector, O SISTEMA DEVE aplicar a política daquela ferramenta (Perguntar, Permitir ou Negar). O padrão é **Perguntar**, com o mesmo cartão, o mesmo tempo limite de 2 min e "Sempre permitir esta ferramenta" do contrato 21.
- R4 QUANDO nenhum conector está ligado, O SISTEMA DEVE abrir a sessão exatamente como hoje, com `strictMcpConfig: true`.
- R5 QUANDO o login não é por assinatura ou o conector precisa de autorização, O SISTEMA DEVE dizer isso na linha do conector, com uma frase curta e o link para autorizar no claude.ai, sem erro na conversa.
- R6 QUANDO um conector está ligado, O SISTEMA DEVE deixá-lo disponível onde os servidores MCP do contrato 21 já valem: no Assistente e no chat da reunião. Na tradução, no resumo, na análise e nas Automações, nunca. (Corrigido em 19/11: o 21 não leva MCP às Automações, porque elas rodam sem ninguém para aprovar o cartão, e um "Perguntar" seria sempre negado.)

## Regras de negócio
- N1 Bloqueio por padrão: nenhum conector liga sozinho, nem quando aparece um novo na conta.
- N2 O app não guarda nem lê token de conector. Não chama `/v1/mcp_servers` nem endpoint do claude.ai: a lista vem só de `claude mcp list`.
- N3 Sem allow por padrão: conector com ferramenta de escrita (enviar email, criar evento, apagar) começa em Perguntar. O Andrew é quem muda.
- N4 Com o app bloqueado (contrato 22), as chamadas de conector são negadas, como as de MCP hoje.

## Telas de impacto no usuário
- Configurações › Conexões: nova seção **"Conectores do claude.ai"**, com uma linha por conector: nome, estado, interruptor, "Ver ferramentas" com a política de cada uma, e o aviso de que o login fica no claude.ai. As linhas de conector deixam de mostrar "Não dá para usar no app".
- Cartão de aprovação no Assistente: igual ao de hoje, com o nome "claude.ai Gmail".
- Depois da implementação dá para gerar a apresentação com prints reais, se o Andrew quiser.

## Fora de escopo
- F1 Conectores de plugin (`plugin:…`): o login deles também fica com o `claude`. Vêm num contrato futuro.
- F2 Importar servidores MCP de outros apps do Mac (Claude Desktop, Codex, Gemini/Antigravity, Cursor, VS Code, Windsurf): é a próxima fase ("qualquer MCP do PC"). Nesta máquina já existem o `claude_desktop_config.json` (1 servidor) e o `~/.codex/config.toml` (5 servidores).
- F3 Autorizar um conector de dentro do app (o OAuth fica no claude.ai).
- F4 Outros motores (Gemini e Codex via ACP).

## Verificação end-to-end
1. Configurações › Conexões mostra os conectores da conta, todos desligados. O Assistente não vê nenhum.
2. Ligar "claude.ai Notion" e perguntar no Assistente "procura no Notion a página X": aparece o cartão Perguntar, você aprova e a resposta cita o Notion.
3. Com o Notion ligado e o Figma desligado, pedir algo do Figma: o agente não tem a ferramenta.
4. "Sempre permitir" grava a política: a próxima chamada não pergunta.
5. Desligar o Notion: a próxima pergunta já não tem a ferramenta.
6. Gmail com "Precisa autorizar": a linha mostra o aviso e o link.
