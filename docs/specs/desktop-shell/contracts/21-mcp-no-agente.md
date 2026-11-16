# Contrato 21 — Conectar o agente a servidores MCP: ver os disponíveis e adicionar pelo app
Feature: desktop-shell  ·  Wave: 19  ·  Depende de: 20 (vídeo) e 17 (motor via ACP, perfis)

## Pré-condições
- Contratos 17 a 20 aceitos; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026): "quero poder deixar a ferramenta conectar em outros MCP, mostrar quais MCP disponíveis, e poder adicionar um MCP pela ferramenta".
- Hoje (17): toda sessão ACP vai com `mcpServers: []` e `strictMcpConfig: true`; nenhum MCP entra. O ACP permite ao **cliente** passar servidores MCP no `session/new` (`mcpServers`: stdio `{ name, command, args, env }`, e HTTP/SSE `{ type: 'http'|'sse', name, url, headers }` quando o agente anuncia `mcpCapabilities` no `initialize`). Este contrato usa esse caminho: quem decide quais MCP entram é o app, nunca as configurações pessoais do Claude (que continuam fora: `settingSources: []`).
- Risco (registrar na tela): MCP dá ao agente ferramentas de fora (ler e escrever em outros sistemas). Texto de uma reunião pode tentar mandar o agente usar essas ferramentas (prompt injection). Por isso: desligado por padrão, liga por servidor e por uso, e toda chamada de ferramenta MCP pede aprovação da pessoa, salvo quando ela marca "Sempre permitir" naquela ferramenta.

## Superfície
- `src/main/acp/` (perfis passam `mcpServers`; política de permissão para ferramentas MCP), `src/main/mcp/` (novo: cadastro, descoberta, teste de conexão, segredos).
- `src/shared/` (tipos zod, IPC), preload; settings.
- `features/settings/` (aba nova **"Conexões"**), `features/chat/` e `features/video/` (pedido de aprovação, passos com o nome do servidor).
- `src/main/smoke.ts` + servidor MCP falso (stdio e HTTP, locais).

## Critérios de aceite
- CA1 — **cadastro** `McpServer` (zod): `{ id, name (1–40, único), transport: 'stdio' | 'http' | 'sse', command?, args?: string[], cwd?, env?: { key, value, secret: boolean }[], url? (só `https://`, ou `http://127.0.0.1`/`localhost`), headers?: { key, value, secret }[], enabled: boolean, uses: ('chat' | 'video' | 'analysis')[] (padrão `['chat']`; nunca tradução nem resumo), toolPolicy: Record<toolName, 'ask' | 'allow' | 'deny'> (padrão `ask`), source: 'manual' | 'import' }`. Valores marcados `secret` ficam cifrados com `safeStorage` (como a chave da AssemblyAI) e nunca voltam ao renderer (só "•••• definido"). Arquivo `userData/mcp-servers.json` com escrita atômica. Testes.
- CA2 — **ver os disponíveis**: Configurações ganha a aba **"Conexões"** (depois de "Claude") com:
  - "Servidores do app": a lista cadastrada (nome, tipo, estado: "Desligado", "Conectado · N ferramentas", "Erro: <motivo curto>"), interruptor, usos (chat, vídeo, análise), "Testar", "Editar", "Remover";
  - "Encontrados neste Mac": servidores MCP já configurados em outras ferramentas, lidos **só para mostrar e importar** (nunca usados sem importar): a saída de `claude mcp list` (pelo `claude` encontrado; sem ele, a seção some), e os arquivos de configuração do Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`) e do projeto, se existirem. Cada um com "Importar" (copia para "Servidores do app" desligado, sem copiar segredos: campos de segredo vêm vazios para a pessoa preencher). Nenhum segredo lido desses arquivos aparece na tela nem em log.
- CA3 — **adicionar pelo app**: botão "Adicionar servidor MCP" abre um formulário com abas "Comando local (stdio)" e "Endereço (HTTP)": nome; comando + argumentos (um por linha) + pasta + variáveis (chave, valor, "segredo"); ou URL + cabeçalhos (chave, valor, "segredo"). Também aceita **colar um JSON** no formato `{"mcpServers": {...}}` (o mesmo do Claude Desktop) e preenche o formulário. "Testar conexão" sobe o servidor isolado (stdio com o ambiente informado + `PATH` do login; HTTP com os cabeçalhos), faz o `initialize` + `tools/list` do MCP com 15 s de limite e mostra as ferramentas encontradas (nome e descrição); só depois disso "Salvar" fica ativo. Validações: comando existe e é executável; URL permitida; nomes únicos.
- CA4 — **uso pelo agente**: ao abrir uma sessão ACP de `chat`, `video` ou `analysis`, o perfil passa em `mcpServers` só os servidores ligados para aquele uso (se o agente anunciar suporte ao transporte; senão, o servidor aparece como "não suportado por este agente"). Tradução e resumo continuam com `mcpServers: []`. Na sessão com MCP: `tools` = leitura + as ferramentas MCP liberadas; `disallowedTools` continua negando Bash/Edit/Write/WebFetch/WebSearch/Task; `strictMcpConfig: true` (só os do app).
- CA5 — **aprovação de ferramentas**: pedido de permissão (`session/request_permission`) de ferramenta MCP com política `ask` abre, na própria conversa, um cartão "O Claude quer usar <ferramenta> de <servidor>" com os argumentos (JSON formatado, segredos do cadastro mascarados), e os botões "Permitir uma vez", "Sempre permitir esta ferramenta", "Negar". Política `allow` aprova sem perguntar; `deny` nega. Sem resposta em 2 min → nega. Ferramentas de leitura de arquivos seguem a regra do 17 (só dentro da pasta), sem cartão. Os passos do chat mostram "Usando <ferramenta> (<servidor>)" com estado.
- CA6 — **chat e vídeo**: no painel "Contexto" (16) e na aba "Vídeo" (20), uma linha "Conexões" lista os servidores ativos naquela conversa com interruptor por conversa (padrão: os ligados para aquele uso). Mudar fecha a sessão e reabre na próxima pergunta, como a troca de modelo.
- CA7 — **segurança**: o processo stdio de cada MCP recebe só as variáveis cadastradas + `PATH`/`HOME`/`LANG` (nada do ambiente do app); morre junto com a sessão (sem órfãos; `dispose` ao sair). Nenhum segredo vai para o renderer, para log, para o smoke report ou para o cofre. A aba "Conexões" mostra o aviso fixo: "Servidores MCP dão ao Claude acesso a outros sistemas. Ligue só os que você confia. Texto de reunião pode tentar pedir ações: confira cada pedido."
- CA8 — **smoke** com um servidor MCP falso stdio (2 ferramentas: `soma` e `apagar_tudo`) e um HTTP local: importa de um `claude_desktop_config.json` de fixture (sem trazer o segredo), adiciona pelo formulário e por JSON colado, "Testar conexão" lista as ferramentas, liga para o chat, pergunta algo que faz o agente falso chamar `soma` (cartão → "Permitir uma vez" → passo concluído) e `apagar_tudo` (política `deny` → negado), confere `mcpServers` no `session/new` e que tradução/resumo seguem sem MCP. PNGs `configuracoes-conexoes-light.png`, `-dark.png`, `conexoes-adicionar-light.png`, `perguntar-aprovacao-mcp-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 20 continuam passando. Sem servidor ligado, nada muda (sessões iguais às do 17).
- Configurações pessoais do Claude nunca entram; MCP só pelo cadastro do app.
- `prova/` e `docs/` não mudam.

## Fora de escopo
- Loja/catálogo de MCP na internet, OAuth de servidores MCP remotos (só cabeçalhos fixos), MCP na tradução e no resumo, recursos/prompts MCP (só ferramentas).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Configurações: aba "Conexões" (servidores do app, encontrados neste Mac, adicionar, testar).
- Chat/vídeo: cartão de aprovação de ferramenta e linha "Conexões" no contexto.

## Notas do coordenador
- Conferir no adaptador como ele trata `mcpServers` vindos do cliente junto com `strictMcpConfig` e `settingSources: []`, e quais transportes ele anuncia em `mcpCapabilities`; relatar. O coordenador testa com o `claude` real e um MCP simples.
- Nada de commit pelo implementador.
