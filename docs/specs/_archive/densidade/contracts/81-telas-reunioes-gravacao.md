# Contrato 81 — Telas densas: Reuniões, Detalhe, Gravação, Bloqueio, Aviso

Feature `densidade` · Wave 2 · Depende de: 79 e 80 commitados · Spec `../spec.md` (seção "Telas", CA2, CA3). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-densidade`. Roda em paralelo com o 82: **fronteira** = você só mexe em `features/meetings/**`, `features/live/**`, `features/calendar/UpcomingSection.tsx`, `features/meeting-prompt/**`, `app/LockScreen.tsx`, e nos checks do smoke dessas telas (`layoutMetrics` partes de tela: `contentLeft`/`contentTop` das telas suas, `transcriptGutter`, `tapeHeight`, linhas de transcrição; checks `gravação*`, `meetings*`, `detail*`, `lock*`); no `smoke.ts`, edite só blocos delimitados `// 81: densidade`.

## Medidas por tela (da spec; unidade Tailwind 4 px)
- **Reuniões** (`MeetingsScreen.tsx`, `MeetingRow.tsx`, `SearchField.tsx`, `FolderBar.tsx`, `RecordingNow.tsx`, `UpcomingSection.tsx`): página `px-8 pt-5 pb-8`; grupo do dia `pt-5`, rótulo `.label` com `pb-1.5`; linha `min-h-11` (44) `px-2 py-2 gap-3`, título 13/500, apoio 11, prévia 12 `line-clamp-1`; Próximas linha `min-h-8 py-1.5`, título 13, botões 28 (`ActionButton`); busca `h-8 w-[240px]`; pastas `h-7`; "gravando agora" `px-3 py-2` 13.
- **Detalhe** (`MeetingDetailScreen.tsx`, `SummaryTab.tsx`, `NotesTab.tsx`, `MeetingFiles.tsx`, `live/TranscriptList.tsx`, `MeetingChatTab.tsx`): cabeçalho `px-8 pt-5`, voltar 12, título `EditableTitle` 15/700, abas `mt-3` (32 via `Tabs` do 80), etiquetas `h-5`; avisos `mx-8 mt-3`; Resumo `px-8 pb-8`, coluna 680 `gap-6 pt-5`, títulos de bloco 14/600 com fio `h-0.5 w-5`, texto 15/24, tabela de tarefas `py-1.5` 13; Anotações `gap-3 pt-5`; Áudio `gap-4`, rótulos `.label` `w-20`; Transcrição `gap-4 pt-5`, rótulo de fonte continua `.caps` (exceção), texto 15/24, tradução 13/20, botões 28; aba de chat da reunião `px-8 pt-4 pb-2`.
- **Gravação** (`LiveScreen.tsx`, `AnalysisBlock.tsx`, `NotesPanel.tsx`, `ControlBar.tsx`, `TranscriptArea.tsx`, `LevelTape`/`TapeIllustration` inalterados): cabeçalho `px-8 pt-5 pb-3`, status `h-5`, cronômetro 14, título `mt-2`; análise linhas `h-7` 13/600 `pb-3`; painel de anotações 320 mantido, abas `px-3 pt-1.5` (Tabs 32), corpo `px-3 pt-3`; barra de controles `p-1`, etiquetas `h-6` 12, botões 32 (`Button` do 80); fita 96 mantida; calha da transcrição 64 → 48 (`transcriptGutter`).
- **Bloqueio** (`LockScreen.tsx`): cartão 380 `p-6 gap-3`, título 17/24, marca 15; botão 32 (vem do `Button`).
- **Aviso de reunião** (`MeetingPrompt.tsx`): inalterado salvo botões 28.

## Smoke
Atualize as expectativas de `layoutMetrics` das suas telas (`contentLeft` 32, `contentTop` 20 e 20 no detalhe, `transcriptGutter` 48, linhas de texto da transcrição 24 e 20, `tapeHeight` 96, `copyButtonHeight` 32 se for das suas telas) e qualquer check que meça linha de reunião (44) ou cabeçalhos. Prints regravam; `expectedShots` igual. Abra os prints das suas telas (claro e escuro) e confira: nada cortado, alinhamentos, nenhum espaço morto.

## Critérios de aceite
Medidas acima no DOM (smoke); nenhum texto técnico; tokens; sem cor literal; prints auditados (lista no relatório).

## Fora de escopo
Assistente, Email, WhatsApp, Automações, Configurações (82); componentes (80); barra (79).

## Gates / Relatório
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Relatório curto: arquivos; gates; achados da auditoria dos seus prints; diferenças e por quê.

## Adendo: achados do contrato 80 nas suas telas (corrigir aqui)
- Reuniões: `features/meetings/SearchField.tsx` tem `h-10` próprio → 32 (`h-8`), alinhado ao botão "Nova gravação"; chip de pasta "Todas" (`FolderBar`) 40 → 28.
- Detalhe e Gravação: título editável 15 sob a linha de status/data: confira hierarquia (status 11 `.label`, data 12) para o título não "sumir"; Transcrição ainda em 16/26 e tradução 14/22 → 15/24 e 13/20.
- Nenhum `.caps` deve sobrar nas suas telas além do rótulo de fonte da transcrição e da fita.
- design.md: os parágrafos de tela (~:107 "Nenhuma reunião ainda (20/26, peso 700)" → 17/24 600; ~:111 "transcrição 16/26, tradução 14/22" → 15/24 e 13/20) são seus: atualize-os junto com as telas.
