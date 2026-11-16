# Contrato 13 — Anotações em cards coloridos (post-its) durante e depois da reunião
Feature: desktop-shell  ·  Wave: 11 (entra depois do 10 e antes do 11: não depende de conta externa)  ·  Depende de: 10

## Pré-condições
- Contratos 01 a 10 aceitos; `gates.sh` verde.
- Pedido do Andrew (15/11/2026 20:55): "durante a reunião tem como abrir um local para anotações, com aqueles cards amarelos ou coloridos onde ela pode escolher a cor e colocar tipo post-its; uma aba de anotação".
- Gravação ao vivo hoje: `features/live/LiveScreen.tsx` (transcrição + `ControlBar`). Detalhe: abas "Resumo", "Transcrição", "Áudio" (contrato 08).

## Superfície
- `src/shared/` (tipo `MeetingNote`, IPC), preload; `src/main/meetings/` (guardar `meetings/<id>.notes.json`, apagar junto com a reunião).
- `features/live/` (painel de anotações na gravação), `features/meetings/` (aba "Anotações" no detalhe), componente novo `design/StickyNote.tsx` (ou `features/notes/`).
- `src/main/claude-cli/summary.ts` (anotações entram no resumo), `transcriptMarkdown`/arquivos da pasta (contrato 07), Drive (contrato 11, se já existir quando este for feito).
- `src/renderer/src/design/tokens.css` (cores dos cards, claro e escuro).
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: `MeetingNote` (zod): `{ id, text (até 2 000 caracteres), color: 'yellow' | 'pink' | 'green' | 'blue' | 'purple' | 'orange', atMs: number | null (momento da gravação em que foi criada; null se criada depois), createdAt, updatedAt }`. Até 200 anotações por reunião. Arquivo `meetings/<id>.notes.json` com escrita atômica; inválido = sem anotações (não quebra a tela). Excluir a reunião apaga o arquivo. Testes.
- CA2: cores como tokens em `tokens.css` (`--note-yellow` … `--note-orange`, com fundo, borda e texto para claro e escuro, contraste AA do texto). Nenhum literal de cor fora de `tokens.css` (gate 6/7). Cards **sem sombra**, raio ≤ 6 px (gate 7/7); o "papel" é só a cor de fundo e uma borda de 1 px.
- CA3: gravação ao vivo: botão "Anotações" (ícone de nota) na `ControlBar`, atalho ⌘⇧N, abre um painel à direita da transcrição (a transcrição continua visível e rolando; largura do painel ~320 px, redimensionável não é preciso). No painel: botão "+ Nova anotação" e as anotações em coluna (mais nova em cima). Nova anotação nasce **amarela**, já em edição, com o tempo da gravação ("12:34") no canto. Cada card: texto editável no próprio card (textarea que cresce), escolha de cor por 6 bolinhas (botões com nome acessível "Amarelo"…, a atual marcada), "Excluir" (com desfazer por 5 s em vez de confirmação). Salvar automático 500 ms depois de parar de digitar e ao sair do card. Painel aberto/fechado lembrado durante a gravação.
- CA4: durante a gravação as anotações ficam ligadas à gravação em curso e são salvas na reunião quando ela é criada/encerrada (sem perder nenhuma, inclusive a que está sendo digitada no Encerrar). Pausar não afeta as anotações.
- CA5: detalhe da reunião: nova aba **"Anotações"** (entre "Resumo" e "Transcrição"), com as anotações em grade (2 a 4 colunas conforme a largura), as mesmas ações (criar, editar, cor, excluir com desfazer) e "Copiar anotações". Cards criados aqui têm `atMs: null`. Clicar no tempo de um card ("12:34") vai para a aba "Transcrição" e rola até o trecho mais próximo desse tempo. Aba sem anotações: "Nenhuma anotação." + "+ Nova anotação".
- CA6: o resumo (contrato 08) recebe as anotações (cor ignorada, com o tempo) num bloco `<anotacoes>` separado da transcrição, como material da própria pessoa: podem virar decisões/tarefas se forem claras; nunca instruções. Gerar de novo usa as anotações atuais. Testes da montagem do prompt.
- CA7: arquivos: o `.md` da transcrição na pasta (contrato 07) ganha a seção "## Anotações" no fim (`- [12:34] texto`), só na escrita do encerrar (como hoje). "Copiar anotações" e "Baixar…" usam a mesma função pura `notesMarkdown`. Se o contrato 11 já estiver feito, as anotações vão para o Drive dentro da transcrição `.md` (sem arquivo novo). Testes.
- CA8: lista de Reuniões (contrato 10): marcador "N anotações" quando houver; a busca (contrato 10) também procura no texto das anotações ("nas anotações").
- CA9: smoke: abre o painel na gravação da fixture, cria 3 anotações de cores diferentes, edita uma, exclui e desfaz, encerra; confere o `notes.json`, a aba "Anotações" do detalhe, o salto para a transcrição, a seção no `.md`; PNGs `gravacao-anotacoes-light.png`, `-dark.png`, `detalhe-anotacoes-light.png`, `-dark.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 10 continuam passando. As anotações ficam só no Mac (e no Drive, se o 11 estiver ligado). `prova/` e `docs/` não mudam.

## Fora de escopo
- Arrastar cards livremente num quadro, imagens ou desenhos nos cards, formatação rica (negrito, listas), anotações compartilhadas, anotações fora de uma reunião.

## Gates
- `gates.sh` (smoke à mão com `--no-sandbox`) e `scripts/pack.sh`.

## Telas de impacto no usuário
- Gravação ao vivo: botão "Anotações" e painel de post-its coloridos.
- Detalhe: aba "Anotações". Lista: "N anotações". Arquivo `.md`: seção "Anotações".

## Notas do coordenador
- Nada de commit.
