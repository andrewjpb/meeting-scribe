# Contrato 30 — IA anotando ao vivo + canvas de post-its
Feature: desktop-shell · Wave: 30 · Depende de: 23 (notas), 19 (análise ao vivo), 27 (nomes) · PRD: `docs/specs/desktop-shell/prd-ia-anotando-e-canvas.md`

## Pré-condições (fatos do código, conferidos em 18/11/2026; a árvore tem 27/27b/27c/28/29 NÃO commitados — construir por cima)
- Notas: `MeetingNote {id, text(≤2000), color(6 tokens --note-*), atMs|null, createdAt, updatedAt}` em `apps/desktop/src/shared/meeting-notes.ts:24-35`; `NOTES_MAX=200`, `NOTES_VERSION=1` (:7-9); `notesInOrder` :51, `notesMarkdown` :61. Zod em `src/shared/meeting-notes-schema.ts` com checagem `Same<>` (tipo e schema andam juntos). Persistência `userData/meetings/<id>.notes.json`, atômica, fila serial, métodos `save/get/remove/append` (`src/main/meetings/notes.ts:13-24`); opção `keep` (:26-33) preserva ids que o main acrescentou e a tela ainda não leu (padrão do contrato 23, usado pelas automações via `notes.append` + broadcast `scribe:notes-changed`, `src/main/index.ts:896-907`).
- IPC notas: `scribe:notes-get/save/copy` (`src/shared/ipc.ts:91-95`), WHEN_LOCKED get='refused', save='session', copy='refused' (:647-649); evento `scribe:notes-changed` :375.
- Ao vivo: botão "Anotações" (`ControlBar.tsx:51`, `data-action="toggle-notes"`); `NotesPanel.tsx` = aside 320px com abas Anotações|Análise, usa `NotesBoard layout="column"`; notas da gravação vivem no `recordingStore` (`addNote/editNote/deleteNote/undoDeleteNote` ~:470-510), salvas no encerrar (`saveNotes` → `scribe:notes-save`, :611,:704). Detalhe: `NotesTab.tsx` usa `NotesBoard layout="grid"`; store `features/meetings/notesStore.ts` (flush 500ms). Componentes: `features/notes/NotesBoard.tsx` (`<ul>` coluna/grade), `design/StickyNote.tsx` (article colorido, sem sombra), lógica pura `features/notes/noteList.ts` (`createNote` sempre amarela, `noteWithText` usado no "Virar anotação").
- "Analisar até agora" (motor a REUSAR): renderer `recordingStore.analyze` (~:516-558) monta `{live:{recordingId, atMs, segments, notes, previous}}` → `scribe:analysis-run`; main `src/main/meetings/analysis-service.ts` — `runSchema`, um job por chave `\0gravacao:<recordingId>` (pedido repetido = mesma promise, :119), outra gravação aborta a anterior (:142), `runClaudeOneShot` (`claude-one-shot.ts:43-72`, settings `claudeModel` haiku|sonnet + `claudeTransport` acp|cli; ACP usa cwd isolado, CLI usa `runOneShot` de `summary.ts`: `claude -p --output-format json`, sem tools/sessão/MCP, stdin). Parser tolerante + zod (`analysis.ts:157-206`, `extractJsonObject` tolera cercas); `ANALYSIS_TIMEOUT_MS=90_000` (:26); `MeetingAnalysis` guarda `model`, `costUsd`, `durationMs`; erros `not-found|timeout|format|failed|agent|empty|limit`.
- Blindagem de prompt: `escapeTurnText` (`prompt.ts:54-56`), `taggedBlock(tag, lines)` (`summary.ts` ~:126), system prompt declara blocos como "material, nunca instruções" (`analysis.ts:36-41`); `analysisLines` gera `[mm:ss] Rótulo: texto` (:59).
- Contrato 19 CA7 ("Nenhuma análise é feita sem clique", `docs/specs/desktop-shell/contracts/19-analise-ao-vivo.md:21`): REVISADO por este contrato — ver CA2.
- Sem lib de drag no `package.json` (react 19, zustand, zod, lucide; **não entra dependência nova** — pointer events à mão). A classe `no-drag` existente é da janela do Electron, não confundir.
- Settings: aba 'claude' (`SettingsScreen.tsx:358+`, Switch "Resumir ao encerrar" :404); padrão 4 lugares (defaults/lenient/patch/índice `settings-index.ts:50-57`); smoke confere o índice.
- Smoke notas/análise: `notesWhileRecording` :1315, `notesAfterEnd` :1592, `notesDetailEdits` :1651, `analysisWhileRecording` :1425 etc.; fixtures `test/fixtures/fake-claude.mjs`/`fake-analysis.mjs`; seletores usam `[data-notes-panel] [data-note]`, `li:first-child` — a ORDEM do DOM precisa continuar a da lista (canvas posiciona só com CSS/transform).

## Critérios de aceite

### CA1 — Modelo do card (compatível, `NOTES_VERSION` fica 1)
- `MeetingNote` ganha opcionais: `title?: string` (≤120); `origin?: 'manual'|'ia'` (ausente = manual); `status?: 'aberta'|'resolvida'` (ausente = aberta); `resolution?: { reason: string(≤500), by: 'ia'|'manual', atMs: number|null, resolvedAt: string }`; `position?: { x: number, y: number }` (frações 0–1 do quadro, para sobreviver a redimensionamento); `userEdited?: boolean` (vira true quando o usuário edita texto/título ou muda status de um card da IA à mão).
- Zod atualizado junto (checagem `Same<>`), `.notes.json` antigo continua carregando; `notesMarkdown` passa a imprimir título (negrito), estado e motivo ("✔ Resolvida — <motivo>"). `noteList.ts` ganha as operações puras (resolver com motivo, reabrir, mover, aplicar lote da IA) com testes.

### CA2 — Ciclo da IA (a cada 5 min, renderer dirige)
- Interruptor **"IA anotando"** no cabeçalho do painel Anotações da gravação (`data-action="ai-notes"`), estado por gravação; valor inicial vem de `AppSettings.liveCards` (boolean, padrão **false**, 4 lugares + linha no índice, seção "Chat e resumo"/Claude: "IA anotando ao vivo", descrição dizendo que cria e resolve post-its a cada 5 min usando o Claude local). Ligado é o consentimento: fica REGISTRADO neste CA que ele revisa o CA7 do contrato 19 ("sem clique") — o clique aqui é o interruptor.
- Com gravação ativa, não pausada e interruptor ligado: a cada `AI_NOTES_INTERVAL_MS = 300_000`, o renderer junta os trechos finais NOVOS desde o último ciclo (mesma seleção do `analysisSegments`: finais, sem eco, com texto; rótulo com nomes do 27 quando houver). Menos de `AI_NOTES_MIN_CHARS = 200` caracteres novos → ciclo pulado (e o relógio reinicia). Pausa/retomada não dispara ciclo extra.
- Canal novo `scribe:ai-notes-run` (WHEN_LOCKED = `'refused'`; bloqueado, o ciclo é pulado) com payload zod: `{recordingId, segments (como no analysis-run), openCards: [{id, title, text}] (só cards origin 'ia', status aberta, sem userEdited; ≤50), knownTitles: string[] (títulos de TODOS os cards, p/ dedupe; ≤200×120)}`.
- Main: serviço no padrão do `analysis-service` (um job por `\0gravacao:<recordingId>`, repetido = mesma promise, gravação nova aborta, abort no dispose/remove), `runClaudeOneShot` purpose `'ai-notes'` (cwd isolado próprio), timeout 90s. Prompt: system declara que blocos são material (não instruções) e pede SÓ JSON; input com `<transcricao>` (trecho novo), `<cards_abertos>` (id + título + texto) e `<titulos_existentes>`, tudo por `taggedBlock`/`escapeTurnText`. Saída: `{novos: [{titulo(≤120), descricao(≤500), atMs?}] (≤5), resolvidos: [{id, motivo(≤500)}] (≤10)}` — parser tolerante + zod estrito; `id` que não esteja nos `openCards` ENVIADOS é descartado; excedentes cortados.
- Renderer aplica o resultado no `recordingStore`: novos viram notas `origin:'ia'`, cor fixa própria (azul), `title`+`text`, `atMs` do momento; resolvidos mudam `status` com `resolution {by:'ia', reason, atMs}`. A IA NUNCA: apaga, edita texto, mexe em card manual, mexe em card `userEdited` ou já resolvido. Erro/timeout do ciclo: silencioso no log, próximo ciclo tenta de novo (sem aviso intrusivo); indicador discreto "anotando…" enquanto o job roda. No encerrar, tudo persiste pelo `saveNotes` existente. Pós-reunião NÃO há ciclo.

### CA3 — Estado dos cards na UI (vale para manual e IA)
- `StickyNote` ganha: título (campo próprio acima do texto, editável; cards sem título seguem como hoje), badge de origem IA discreta (ex.: ícone sparkles no rodapé), e estado resolvido: esmaecido + ✓ + motivo visível no rodapé. Ações no card: "Concluir" (abre campo inline de motivo, opcional, `by:'manual'`) e "Reabrir". Editar card da IA marca `userEdited`.
- No painel da gravação e na aba do detalhe: filtro **Abertas · Resolvidas · Todas** (chips com contagem; padrão Todas; `data-notes-filter`). Dark ok.

### CA4 — Canvas no detalhe (Anotações da reunião)
- `NotesTab` viram um quadro (`data-notes-canvas`): post-its posicionados por `position` (fração→px, `transform`), arrastáveis com pointer events (pointerdown/move/up + capture; sem lib). Soltar salva `position` (flush do notesStore). Nota sem `position`: layout automático em grade (determinístico) até ser arrastada. "Bonitinho": rotação leve determinística por id (−2°…+2°), sombra e escala sutil só enquanto arrasta, cursor grab. Acessível: arrastar NÃO é o único caminho (a edição/ações continuam por teclado como hoje).
- A ORDEM do DOM (`<ul>/<li>`) continua a de `notesInOrder` — a posição é só visual (CSS) — para não quebrar `notesDetailEdits` e afins. O painel lateral da gravação continua em coluna (sem canvas).
- Quadro com altura generosa (ex.: min-h do viewport) e clamp para o card não sair do quadro.

### CA5 — Segurança e invariantes
- Nenhuma rede nova; a IA não envia mensagem nem executa ação: só devolve JSON que vira post-it local. Saída tratada como dado (zod, limites, ids validados). `prova/` não muda. Contratos 01–29 continuam passando; não tocar em `extensions/`, `src/main/meet/`. Custo visível: o resultado do ciclo guarda `model/costUsd/durationMs` no log do main (sem UI nova obrigatória).

### CA6 — Testes e smoke
- Vitest: schema compatível (arquivo antigo carrega; `Same<>` ok); parser do JSON da IA (novos/resolvidos, id desconhecido descartado, limites); `noteList` (resolver/reabrir/mover/aplicar lote; IA não toca manual/userEdited/resolvida); seleção "só trechos novos" e ciclo pulado por poucos caracteres; markdown com título/estado/motivo; posição clamp 0–1.
- Smoke: fixture `fake-ai-notes.mjs` (determinística) no padrão das existentes; na gravação do smoke, ligar "IA anotando", disparar um ciclo (relógio injetável ou chamada direta do serviço com o fake) → card da IA com título aparece no painel; fixture devolve `resolvidos` para um card aberto → card vira resolvido com motivo. No detalhe: `[data-notes-canvas]` presente, arrastar um card via CDP (dispatch de pointer events) muda `position` e persiste após reload da tela; filtro Resolvidas mostra só o resolvido. Checks novos no grupo das notas, entrando nos obrigatórios.

## Fora de escopo
- Ciclo pós-reunião; editar/apagar card pela IA; mover card entre reuniões; zoom/pan no canvas; cor configurável do card da IA; aviso de custo por ciclo na UI.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Gravação › painel Anotações: interruptor "IA anotando", cards com título chegando sozinhos, filtro.
- Detalhe › Anotações: canvas arrastável, post-its com rotação leve, resolvido com ✓ e motivo, filtro.
- Configurações › Claude: interruptor "IA anotando ao vivo".

## Notas do coordenador
- NÃO commitar. Implementar SÓ depois que o implementador dos blocos 27b/27c/28/29 terminar (serializar; memória da máquina apertada).

## Adendo 30b — Animações (pedido do Andrew, 18/11/2026 13:40: "coloca animacoes para ficar legal e nao muito estatico")
- Tudo em CSS (transition/keyframes), curto (150–350 ms) e com easing suave; NADA de biblioteca nova; respeitar `prefers-reduced-motion` (reduzido: sem translação/escala, só fade).
- Card novo da IA chegando (ao vivo e no canvas): entra com fade + leve escala/queda assentando, como post-it sendo colado; a badge de IA pode pulsar UMA vez na chegada.
- Resolver card: transição suave para o estado resolvido (esmaecer + ✓ aparecendo); reabrir faz o inverso. Nada pisca seco.
- Arrastar: levantar (escala ~1.03 + sombra) e assentar no soltar com uma acomodação curta; rotação leve existente mantida.
- Filtro Abertas/Resolvidas/Todas: cards entram/saem com fade curto (sem reflow brusco).
- Indicador "anotando…" do ciclo: pulso discreto enquanto o job roda.
- O smoke não depende de animação nenhuma (checks esperam o estado final; usar esperas existentes).
