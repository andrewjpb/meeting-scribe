# Contrato 26 — Agentes, tarefas e Assistente podem pesquisar na internet
Feature: desktop-shell  ·  Wave: 26  ·  Depende de: 17 (motor ACP, política de permissão), 23 (agentes, tarefas, "Pedir agora"), 25 (Assistente)

## Pré-condições
- Contratos 23 e 25 aceitos (v0.7.0); `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (17/11/2026 06:29), com print do "Pedir agora" respondendo "não consigo pesquisar o que está em alta no Instagram, porque não tenho acesso à internet": "quero fazer tarefas, poder pesquisar na internet, deveria dar". Exemplo real: "pesquise os principais insights sobre a parte financeira e me traga conteúdo para ser feito no Instagram que esteja em alta".
- Hoje `WebSearch` e `WebFetch` estão em `CLAUDE_DISALLOWED_TOOLS` (`src/main/acp/profiles/claude.ts`) e `CHAT_DISALLOWED_TOOLS` (`src/main/claude-cli/chat.ts`), e a política de permissão do 17 (`permissionAllowed` em `src/main/acp/agent.ts`) só libera leitura dentro da pasta.
- Risco que este contrato trata: o agente lê dados privados (reuniões, WhatsApp). Com internet, uma página lida pode mandar o agente "abrir" um endereço com esses dados na URL (vazamento). Por isso: **busca livre, mas abrir página só de endereço que veio de um resultado da busca da mesma execução ou que a pessoa escreveu no pedido**; nunca URL montada pelo modelo.
- Regra que não muda: nenhuma IA envia mensagem a ninguém; o agente continua sem escrita, sem shell e sem MCP.

## Superfície
- `src/main/acp/` (perfil Claude: `tools`/`disallowedTools` por execução; política de permissão para `WebSearch`/`WebFetch`), `src/main/claude-cli/chat.ts` (mesma regra no caminho do CLI, se ainda usado pelo Assistente).
- `src/shared/automations*.ts` (campo novo do agente), `src/shared/chat.ts`/`assistant.ts` (fonte "Internet" do Assistente), IPC se preciso.
- `src/main/agents/`, `src/main/schedules/runner.ts`, `src/main/chat/` (instrução do sistema citando links).
- Renderer: `features/agents/` (formulário do agente), `features/chat/` (painel Contexto, passos, fontes citadas).
- `resources/assistente/guia-do-app.md`, `src/main/smoke.ts`, README.

## Critérios de aceite
- CA1 — **agente com internet**: o agente (23) ganha `web: boolean` (zod, padrão `false`; agentes salvos antes leem como `false`). Formulário do agente: interruptor **"Pode pesquisar na internet"** com o texto "Busca na web e abre as páginas que encontrar. Não abre endereços inventados." O cartão do agente mostra "Internet" quando ligado. O agente padrão "Minhas tarefas" continua desligado. "Pedir agora" e as tarefas agendadas usam o valor do agente escolhido.
- CA2 — **Assistente com internet**: painel "Contexto" ganha a fonte **"Internet"** (interruptor por conversa, padrão **ligado**), texto "Busca na web quando a pergunta pedir. Os links aparecem na resposta."
- CA3 — **política**: com internet ligada, a sessão libera `WebSearch` e `WebFetch` (saem de `disallowedTools` só nessa execução; Bash/Edit/Write/NotebookEdit/Task continuam negados). `permissionAllowed`:
  - `WebSearch`: permite (consulta até 300 caracteres; até 10 buscas por execução, depois nega).
  - `WebFetch`: permite só se a URL for `https://` (ou `http://`), sem credencial na URL, sem IP privado/loopback/`.local`, e o endereço (origem + caminho, sem considerar `#`) **apareceu num resultado de `WebSearch` desta mesma execução ou no texto digitado pela pessoa**; até 15 páginas por execução. Qualquer outra → nega, e o passo mostra "Endereço bloqueado: não veio da busca".
  - Teste de unidade para cada regra, incluindo "URL com trecho de reunião na query, não vista na busca → negada" e "URL de resultado com `?utm=` igual → permitida".
- CA4 — **o que a pessoa vê**: os passos mostram "Pesquisando: <consulta>" e "Abrindo <domínio>"; a instrução do sistema (agentes e Assistente, só quando a internet está ligada) manda citar a fonte como `[Web · <domínio> · <título curto>](url)` e dizer a data quando o assunto muda rápido ("em alta"). A resposta mostra os links clicáveis (abrem no navegador do sistema, nunca dentro do app). Rodapé da resposta: "Usou a internet · N buscas · M páginas".
- CA5 — **sem internet continua igual**: com o interruptor desligado, nada muda em relação ao 17/23/25 (mesmas ferramentas negadas, mesma instrução). A instrução sem internet diz, quando o pedido precisar da web: "Para isso, ligue 'Pode pesquisar na internet' neste agente" (ou "a fonte Internet no Contexto", no Assistente), em vez de só "não tenho acesso".
- CA6 — **ações e segurança**: cartões de ação (25) continuam só com clique; numa resposta que usou a internet, cada cartão mostra "Esta resposta usou páginas da internet: confira antes." Execuções agendadas continuam sem cartões (25 CA5). `WHEN_LOCKED` sem mudança de regra (canais novos, se houver, recusados). Tradução e resumo nunca recebem internet.
- CA7 — **guia e textos**: `guia-do-app.md` explica o interruptor e a regra de páginas; Automações troca a descrição para "Agentes que leem as suas reuniões e, se você deixar, a internet, e respondem na hora ou no horário que você escolher."
- CA8 — **smoke** com agente ACP falso (sem rede de verdade: o falso devolve resultados de busca inventados): agente com internet → "Pedir agora" → passos "Pesquisando…" e "Abrindo…" + resposta com link; um `WebFetch` para URL fora da busca é negado e aparece "Endereço bloqueado"; agente sem internet → `WebSearch` negado e a resposta sugere ligar o interruptor; Assistente com a fonte Internet. PNGs `automacoes-internet-light.png`, `assistente-internet-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 25 passam. Sem escrita, shell, MCP ou envio. Nenhuma URL montada pelo modelo é aberta. `prova/` não muda; `docs/` só o README.

## Fora de escopo
- Login em sites, Instagram/redes por API, navegador automatizado, baixar arquivos, MCP (contrato 21).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Automações › formulário do agente: interruptor "Pode pesquisar na internet"; cartão do agente com "Internet".
- Assistente › Contexto: fonte "Internet"; respostas com links e "Usou a internet".

## Notas do coordenador
- Nada de commit pelo implementador.
