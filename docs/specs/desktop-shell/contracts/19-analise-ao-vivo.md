# Contrato 19 — "Analisar até agora": perguntas em aberto e tópicos que não ficaram claros, a qualquer momento
Feature: desktop-shell  ·  Wave: 17  ·  Depende de: 18 (abas) e 17 (motor via ACP)

## Pré-condições
- Contratos 17 e 18 aceitos; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026 14:54): "um botão para, quando eu clicar, gerar mesmo no meio da reunião: perguntas em aberto, ou tópico que não ficou claro, com base na reunião inteira".
- Já existem: motor do Claude por perfil de agente (`src/main/acp/`, com reserva `claude -p`), resumo ao encerrar (08, `summary.ts` + `parseSummaryResult`), anotações (13, painel à direita na gravação), transcrição ao vivo em memória (`recordingStore`/reducer, trechos finais sem eco).

## Superfície
- `src/main/acp/` e `src/main/claude-cli/` (nova finalidade `analysis`, sem ferramentas, como o resumo), `src/main/meetings/` (guardar as análises), `src/shared/` (tipos zod, IPC), preload.
- `features/live/` (botão e painel), `features/meetings/` (detalhe), `features/notes/` (virar anotação).
- `src/main/smoke.ts` + agente/`claude` falsos.

## Critérios de aceite
- CA1 — **tipo** `MeetingAnalysis` (zod): `{ id, meetingId | null (null enquanto a reunião ainda não foi criada), createdAt, atMs (momento da gravação), model, openQuestions: { text, context?, atMs? }[], unclearTopics: { topic, why, atMs? }[], toConfirm: { text, owner? }[], suggestedQuestions: string[] }`; até 15 itens por lista, 500 caracteres por texto. Testes.
- CA2 — **geração**: uma execução curta pelo mesmo motor do resumo (perfil ACP com `tools: none`, ou `claude -p` na reserva), com a transcrição **até aquele momento** (trechos finais, sem eco, formato `[mm:ss] Rótulo: texto`, escapada) e as anotações, mais as análises anteriores da mesma reunião (para não repetir o que já foi levantado e marcar o que foi respondido depois). Instrução em português pedindo **só JSON** no formato do CA1: `openQuestions` = perguntas feitas e não respondidas, ou decisões pendentes; `unclearTopics` = assuntos ambíguos, contraditórios ou que mudaram sem conclusão, com o porquê; `toConfirm` = números, datas, nomes e responsáveis citados de forma vaga; `suggestedQuestions` = até 5 perguntas curtas que a pessoa pode fazer agora para fechar as lacunas. Nada inventado; sem lacuna, listas vazias. Limite de 90 s; erro mostra a mensagem do motor (como no 08/17). Testes com agente falso (sucesso, JSON com cercas, inválido, timeout).
- CA3 — **na gravação**: botão **"Analisar até agora"** na `ControlBar` (ícone de lupa/brilho, atalho ⌘⇧A), habilitado com pelo menos 1 trecho final; não pausa nem afeta a captura, a transcrição ou a tradução (a fila da tradução não espera a análise). Enquanto gera: o botão mostra "Analisando…" e não aceita outro clique.
- CA4 — **painel**: o painel lateral da gravação (o mesmo das anotações, 13) ganha abas **"Anotações" | "Análise"**; clicar no botão abre a aba "Análise". Cada análise vira um bloco com o horário da gravação ("Até 23:41") e as seções "Perguntas em aberto", "Não ficou claro", "Para confirmar" e "Perguntas para fazer agora" (seções vazias somem; tudo vazio: "Nada em aberto até aqui."). A mais nova em cima; as anteriores recolhidas. Cada item tem ações: "Virar anotação" (cria um post-it amarelo com o texto e o `atMs` do item ou da análise), "Copiar" e, nos que têm `atMs`, clicar no tempo rola a transcrição até lá. Itens que uma análise nova aponta como respondidos aparecem riscados na anterior. Segue `design.md`.
- CA5 — **persistência**: análises da gravação ficam em memória até a reunião ser criada e são salvas em `meetings/<id>.analyses.json` (escrita atômica, como as notas) junto com o encerrar; excluir a reunião apaga. Arquivo inválido = sem análises. Testes.
- CA6 — **depois da reunião**: a aba "Resumo" do detalhe ganha, abaixo das tarefas, a seção recolhível **"Perguntas em aberto"**, que mostra a última análise (se houver) e o botão "Analisar a reunião inteira" (gera uma nova com a transcrição completa, salva junto). O resumo do 08 recebe também as perguntas em aberto da última análise como material (sem copiar cegamente: só o que continuar sem resposta). O `.md` da pasta (07) e o "Copiar resumo" ganham a seção "## Perguntas em aberto" quando houver.
- CA7 — **custo e privacidade**: o rodapé de cada análise mostra modelo, tempo e custo nominal (como no 16). Só o motor local do Claude recebe o texto; nada novo vai para a rede. Nenhuma análise é feita sem clique.
- CA8 — **smoke** com agente falso: grava a fixture, clica "Analisar até agora" no meio (com a tradução seguindo), confere a aba "Análise" com as quatro seções, "Virar anotação" criando o post-it, segunda análise marcando um item como respondido, encerrar salvando `analyses.json`, a seção no detalhe e no `.md`. PNGs `gravacao-analise-light.png`, `-dark.png`, `detalhe-perguntas-abertas-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 18 continuam passando. A análise nunca bloqueia a gravação nem a tradução. `prova/` e `docs/` não mudam.

## Fora de escopo
- Análise automática periódica (sem clique), aviso sonoro, mandar as perguntas para alguém, análise por participante.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Gravação: botão "Analisar até agora" e aba "Análise" no painel lateral.
- Detalhe › Resumo: seção "Perguntas em aberto" com "Analisar a reunião inteira".
- `.md` da pasta: seção "Perguntas em aberto".

## Notas do coordenador
- Nada de commit pelo implementador.
