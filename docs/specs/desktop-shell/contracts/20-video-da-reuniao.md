# Contrato 20 — Vídeo da reunião feito pelo Claude (via ACP), com Fable 5.2 ou Opus 5.5
Feature: desktop-shell  ·  Wave: 18  ·  Depende de: 19 (análise ao vivo), 17 (motor via ACP), 16 (chat v2)

## Pré-condições
- Contratos 17 a 19 aceitos; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026): "quero poder pedir para o Claude fazer um vídeo sobre a reunião, principais pontos ou qualquer outra coisa, com Fable 5.2 ou Opus 5.5, tudo com essa integração ACP nativa, passando para o programa, tudo interagindo de forma limpa".
- Decisão de desenho (coordenador): o agente **não** escreve arquivos nem roda comandos. Ele lê a reunião (como no chat) e devolve um **roteiro estruturado** (cenas em JSON) pelo próprio ACP; o **app** desenha as cenas com modelos visuais próprios (tokens do `design.md`, marca do contrato 09) e grava o vídeo. Assim o isolamento do 17 continua (só leitura, sem shell, sem rede) e o resultado tem a cara do app.
- Modelos: o app hoje oferece `haiku | sonnet | opus`. Este contrato acrescenta **Fable 5.2** e garante **Opus 5.5** (ids `claude-fable-5-2` e `claude-opus-5-5`) no perfil do Claude, pelo `configOptions` de modelo do adaptador ACP; se o adaptador/conta não listar um deles, a opção aparece desabilitada com "Não disponível na sua conta".

## Superfície
- `src/main/acp/` (finalidade `video`, perfil com os modelos novos), `src/main/video/` (novo: roteiro, render, gravação, arquivos).
- `src/shared/` (tipos zod, IPC), preload; settings (modelo do vídeo).
- `features/meetings/` (aba ou ação "Vídeo"), `features/chat/` (pedir vídeo pela conversa), `features/video/` (novo: prévia e cenas).
- `src/main/smoke.ts`, agente ACP falso (modo vídeo).

## Critérios de aceite
- CA1 — **roteiro** `VideoScript` (zod): `{ title, aspect: '16:9' | '9:16' | '1:1', durationTargetS (15–180), scenes: Scene[] (1–30) }`; `Scene` é uma união: `title` (título, subtítulo), `bullets` (título, até 6 itens), `quote` (fala, quem, `atMs`), `decision` (texto, quem), `tasks` (até 8: tarefa, quem, prazo), `stat` (número grande, rótulo), `timeline` (até 8 marcos com `atMs` e texto), `closing` (texto, chamada); cada cena com `durationS` (2–15) e `narration?` (até 400 caracteres). Textos até os limites de cada campo; nada de HTML/markdown. Testes.
- CA2 — **geração via ACP**: finalidade `video` = sessão com `tools: read` presa à pasta da reunião (como a aba "Perguntar" do detalhe; acervo de uma reunião só, ou do escopo escolhido), modelo escolhido (CA5), instrução em português: ler a reunião, seguir o pedido da pessoa ("principais pontos", "decisões para a diretoria", "resumo de 30 s para o time"…), responder **só** com o JSON do CA1, sem inventar fatos, citando falas reais em `quote` com o `atMs`. A conversa aparece como no chat v2 (raciocínio, passos e plano vindos do protocolo), e ao terminar o JSON é validado; inválido → uma nova tentativa automática pedindo para corrigir só o formato; inválido de novo → erro claro. Testes com agente falso.
- CA3 — **render no app**: uma janela fora da tela (`BrowserWindow` oculta, `offscreen`, sem rede: CSP só `self`/`data:`, `sandbox`, sem Node) desenha as cenas em `<canvas>` com modelos visuais próprios para cada tipo de cena (tipografia e cores dos tokens, marca/logo do 09, transições simples de entrada e saída de 300 ms; nada de sombra/pílula/raio > 6 px), em 1920×1080 (16:9), 1080×1920 (9:16) ou 1080×1080 (1:1), 30 fps. Grava com `MediaRecorder` em `video/mp4;codecs=avc1` (reserva `video/webm;codecs=vp9`), relatando o formato que saiu. Barra de progresso "Montando o vídeo… 40%" e "Cancelar".
- CA4 — **narração opcional**: interruptor "Narrar" (padrão desligado). Ligado, o texto `narration` de cada cena vira áudio com a voz do macOS (`say -o` para um arquivo temporário, voz pt-BR escolhida em Configurações, lista vinda de `say -v ?`), a duração da cena se ajusta ao áudio e o áudio entra no vídeo. Desligado, as cenas mostram a narração como legenda. Teste do main com `say` substituto.
- CA5 — **modelos**: o seletor de modelo (chat, análise e vídeo) passa a ter Haiku, Sonnet, Opus 5.5 e **Fable 5.2**; Configurações › Claude ganha "Modelo do vídeo" (padrão **Opus 5.5**). Mapeamento no perfil do Claude (`profiles/claude.ts`) para os ids do adaptador; o rodapé do 16 mostra o nome do modelo real devolvido pelo agente.
- CA6 — **onde pedir**:
  - detalhe da reunião, nova aba **"Vídeo"**: campo "O que o vídeo deve mostrar?" com sugestões ("Principais pontos em 60 s", "Decisões e tarefas", "Resumo para quem faltou", "Linha do tempo da reunião"), formato (16:9, 9:16, 1:1), duração alvo, modelo, "Narrar"; botão "Fazer o vídeo";
  - chat "Perguntar": pedido que fale em vídeo ("faz um vídeo com…") oferece o botão "Fazer este vídeo" na resposta, que abre o fluxo com o pedido preenchido.
- CA7 — **prévia e edição leve**: antes de gravar, a tela mostra o roteiro como lista de cenas (miniatura desenhada pelo mesmo render, texto editável em cada campo, duração, subir/descer, excluir cena) e "Pedir ajuste ao Claude" (texto livre; manda o roteiro atual + o pedido na mesma sessão ACP e recebe um roteiro novo). "Gravar vídeo" grava a versão aprovada.
- CA8 — **arquivos**: o vídeo vai para a pasta da reunião (07) como `<nome> - video-<n>.mp4` (ou `.webm`), com o roteiro ao lado em `.json`; com a pasta desligada, fica em `userData/videos/`. O detalhe lista os vídeos da reunião com "Abrir", "Mostrar no Finder" e "Baixar…" (mesmas regras de caminho do 07). Excluir a reunião não apaga os vídeos da pasta. Se o Drive (11) existir, os vídeos entram na fila de envio.
- CA9 — **limites e custo**: rodapé com modelo, tempo, tokens e custo nominal da geração do roteiro (como no 16); render e narração são locais e sem custo. Vídeo acima de 180 s ou 30 cenas é recusado no zod. Nada é gerado sem clique.
- CA10 — **segurança**: a sessão de vídeo segue o 17 (só leitura dentro da pasta, sem MCP, sem configurações pessoais, modo seguro exigido). A janela de render não carrega nada de fora nem recebe HTML do modelo: só o JSON validado, desenhado por código do app.
- CA11 — **smoke** com agente falso devolvendo um roteiro de 6 cenas (com uma inválida na 1ª tentativa, corrigida na 2ª): confere a aba "Vídeo", a conversa com passos, a prévia com miniaturas, edição de um texto, "Pedir ajuste", gravação curta (formato e duração do arquivo), o arquivo na pasta, a lista no detalhe e o botão "Fazer este vídeo" no chat. PNGs `detalhe-video-light.png`, `-dark.png`, `video-previa-light.png`, e 3 quadros do vídeo gravado (`video-quadro-1.png` …). `externalRequests: []`.

## Invariantes
- Contratos 01 a 19 continuam passando. O agente nunca escreve arquivos nem roda comandos. `prova/` e `docs/` não mudam.

## Fora de escopo
- Vídeo com imagens geradas por IA, avatares, música, voz clonada, edição de vídeo livre (timeline), publicar em redes, gravar a tela da reunião.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Detalhe: aba "Vídeo" (pedido, prévia editável, gravação, lista de vídeos).
- "Perguntar": botão "Fazer este vídeo".
- Configurações › Claude: "Modelo do vídeo"; modelos Opus 5.5 e Fable 5.2 nos seletores; voz da narração.

## Notas do coordenador
- Conferir no código do adaptador como o `configOptions` de modelo aceita ids completos (`claude-opus-5-5`, `claude-fable-5-2`) ou aliases; relatar. Não rodar o `claude` real; o coordenador testa.
- Nada de commit pelo implementador.
