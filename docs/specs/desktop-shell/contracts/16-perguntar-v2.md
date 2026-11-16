# Contrato 16 — "Perguntar" v2: layout mais moderno, mostrar o raciocínio, contexto e detalhes da resposta
Feature: desktop-shell  ·  Wave: 14  ·  Depende de: 15 (aceito, commit `fc30952`; versão 0.2.0 em `d4ae123`)

## Pré-condições
- Contrato 15 aceito; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (15/11/2026 23:25): "melhora a parte do layout da pergunta, deixe mais moderno, com mais opções, mostre pensando, e coloque mais informações sobre aquele contexto, entre outras informações importantes como modelo usado etc."
- Hoje (`features/chat/`): lista de conversas à esquerda, mensagens e campo à direita, 3 sugestões, "Parar". O main (`src/main/claude-cli/chat.ts`, `src/main/chat/service.ts`) já lê o `stream-json` do `claude` com `--include-partial-messages`, onde chegam: `system`/`init` (com `model`, `tools`, `cwd`), `stream_event` (deltas de texto, de `thinking` e de `tool_use`), `assistant` (blocos `text`, `thinking`, `tool_use`), `user` (`tool_result`) e `result` (`duration_ms`, `total_cost_usd`, `usage` com tokens de entrada/saída/cache, `num_turns`, `permission_denials`).
- `design.md` continua valendo: sem sombra, raio ≤ 6 px, sem pílula, cores só em `tokens.css`. "Moderno" aqui é hierarquia, espaço, tipografia e estados claros, não efeitos.

## Superfície
- `src/main/claude-cli/chat.ts`, `src/main/chat/service.ts`, `src/main/chat/store.ts` (eventos e metadados novos).
- `src/main/chat/corpus.ts` (escopo por seleção de reuniões/período).
- `src/shared/chat.ts`, `src/shared/ipc.ts`.
- `src/renderer/src/features/chat/` (telas e componentes), `features/meetings/` (aba "Perguntar").
- `src/main/smoke.ts`, `test/fixtures/fake-claude.mjs` (eventos de thinking, tool_use e result com uso).

## Critérios de aceite
- CA1 — **eventos novos** do main para a tela (`scribe:chat-event`), tipados e testados:
  - `thinking` (texto do raciocínio em pedaços, quando o modelo manda bloco `thinking`);
  - `step` (passo de ferramenta: `{ tool: 'Read' | 'Grep' | 'Glob', label, meetingId | null }`, com `label` em português: "Lendo o índice das reuniões", "Abrindo «<título>»", "Procurando "<termo>"", "Listando arquivos"; o `meetingId` vem do nome do arquivo do acervo, que tem o id inteiro; caminho de arquivo nunca vai para a tela);
  - `denied` (ferramenta negada, com a contagem);
  - `meta` no fim: `{ model, durationMs, inputTokens, outputTokens, cacheReadTokens, costUsd, turns, consulted: meetingId[] }`.
  Testes com o `claude` falso emitindo cada tipo.
- CA2 — **mostrar pensando**: enquanto a resposta não começa, a mensagem do Claude mostra o estado atual em uma linha ("Pensando…", depois o último passo: "Abrindo «Planejamento Q1»"), sem animação girando com `prefers-reduced-motion`. Acima da resposta, um bloco recolhível **"Raciocínio e passos"** (fechado por padrão depois que a resposta termina; aberto enquanto pensa) com a lista dos passos em ordem, cada um com ícone pequeno, e o texto do `thinking` (se houver) em fonte menor e cor secundária. O bloco fica salvo com a mensagem (CA6) e reaparece ao reabrir a conversa.
- CA3 — **detalhes da resposta**: rodapé discreto em cada resposta: modelo ("Sonnet"), tempo ("12 s"), tokens ("3,1 mil entrada · 420 saída"), custo nominal ("US$ 0,02", com a dica "valor de referência; sai do seu plano do Claude") e "N reuniões consultadas" (clicável: abre a lista com links para cada uma). Ações por resposta: "Copiar", "Refazer" (manda de novo a mesma pergunta, substituindo a resposta), e para respostas com erro "Tentar de novo".
- CA4 — **contexto da conversa**: painel lateral direito recolhível **"Contexto"** (largura ~280 px; recolhido vira um botão no cabeçalho) com:
  - escopo: "Todas as reuniões (N)", "Últimos 7 dias", "Últimos 30 dias" ou "Reuniões escolhidas" (lista com busca do contrato 10 e caixas de marcar; até 50);
  - reuniões consultadas nesta conversa (união dos `consulted`), com data e link;
  - totais da conversa: mensagens, tokens, custo nominal, tempo;
  - modelo da conversa (Haiku/Sonnet/Opus) — trocar vale para a próxima pergunta (fecha o processo atual e reabre com o histórico).
  O escopo muda a pasta do `claude`: o main monta `chat-scope/<chatId>/` só com os `.md` do escopo e um `INDICE.md` próprio (mesma regra de permissões e limpeza do 15). Na aba "Perguntar" do detalhe o escopo é fixo na reunião e o painel mostra só consultadas, totais e modelo. Testes do main para cada escopo.
- CA5 — **layout**:
  - cabeçalho da conversa: título editável (clique → campo; Enter salva), escopo e modelo como rótulos clicáveis, botão do painel "Contexto";
  - mensagens com largura de leitura (~72 caracteres), a pessoa alinhada à direita em bloco com fundo sutil, o Claude à esquerda sem caixa, com o nome "Claude" e o horário;
  - campo de pergunta maior (cresce até 8 linhas), com o seletor de modelo e o de escopo na própria barra do campo, contador quando passar de 2 000 caracteres, ⌘↵ e ↵ enviam, ⇧↵ quebra linha, ↑ no campo vazio edita a última pergunta;
  - estado vazio com 6 sugestões em cartões (2 colunas) agrupadas: "Esta semana" (decisões, tarefas minhas), "Pessoas" (última reunião com <participante>, o que <participante> pediu), "Tópicos" (o que foi dito sobre <palavra frequente>, pendências abertas) — os nomes e palavras saem do acervo quando houver, senão textos genéricos;
  - botão "Ir para o fim" quando a pessoa rolou para cima e chega texto novo;
  - lista de conversas: busca por título, agrupada por dia (mesmas regras do contrato 10), renomear e excluir no menu "…" da linha.
  Tudo seguindo `design.md` (componentes base, tokens, foco visível, teclado). Smoke: `perguntar-v2-light.png`, `-dark.png` (com raciocínio aberto e rodapé), `perguntar-contexto-light.png` (painel aberto com escopo "Reuniões escolhidas"), `perguntar-vazio-light.png`.
- CA6 — **persistência**: `ChatMessage` ganha `steps`, `thinking` (até 20 000 caracteres), `meta` (CA1) e `model`; `Chat` ganha `scope` (`{ kind: 'all' | '7d' | '30d' | 'meetings', meetingIds? }`) e `model`. Arquivos do contrato 15 carregam com os padrões. Zod e testes.
- CA7 — **segurança e privacidade** (invariantes do 15 continuam): o `thinking`, os passos e os metadados ficam só no Mac; nenhum caminho absoluto chega ao renderer; o texto do `thinking` é texto puro na tela (sem Markdown executável nem HTML); `Refazer` e troca de modelo nunca reusam processo de outra conversa.
- CA8 — **smoke** com o `claude` falso emitindo `system/init` com modelo, `thinking`, 3 `tool_use` (índice, uma reunião, um grep), uma ferramenta negada e `result` com uso e custo: confere a linha "Pensando…/Abrindo «…»", o bloco "Raciocínio e passos", o rodapé (modelo, tokens, custo, consultadas), o painel "Contexto" com troca de escopo (e o `cwd`/arquivos da pasta de escopo), troca de modelo (novo processo com `--model`), Refazer, renomear, ↑ para editar. `externalRequests: []`.

## Invariantes
- Contratos 01 a 15 continuam passando. Ferramentas do `claude` continuam só leitura e presas à pasta (`--tools`, `--restricted`, `dontAsk`).
- `prova/` e `docs/` não mudam.

## Fora de escopo
- Anexar arquivos de fora do app, voz, compartilhar conversa, outros provedores, gráficos nas respostas, "pensamento estendido" configurável (se a versão do `claude` não tiver flag estável para isso).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `scripts/pack.sh`.

## Telas de impacto no usuário
- "Perguntar": cabeçalho com título/escopo/modelo, raciocínio e passos visíveis, rodapé com modelo/tempo/tokens/custo/consultadas, painel "Contexto", campo novo, sugestões em cartões, lista com busca e dias.
- Aba "Perguntar" do detalhe: o mesmo, com escopo fixo.

## Notas do coordenador
- Conferir com `claude --help` se há flag de esforço/raciocínio (`--effort` ou similar). Se houver e for estável, pode entrar como opção "Pensar mais" no seletor de modelo; se não, fica fora e o `thinking` aparece só quando o modelo mandar.
- Nada de commit pelo implementador.
