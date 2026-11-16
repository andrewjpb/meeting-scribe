# Contrato 08 — Resumo da reunião (o que aconteceu, tarefas e quem faz) e abas no detalhe
Feature: desktop-shell  ·  Wave: 8  ·  Depende de: 07 (aceito em 15/11/2026, smoke verde às 17:14)

## Pré-condições
- Contratos 01 a 07 aceitos; `apps/desktop/scripts/gates.sh` verde (smoke com `--no-sandbox` no shell do Kiro).
- Pedido do Andrew (15/11/2026 19:30): "a opção de resumir o que aconteceu, o que tem de tarefas e quem deve fazer as tarefas; uma aba de resumo, e depois a transcrição e download de áudio".
- O app já usa o `claude` local (contrato 05, `src/main/claude-cli/`: `locate.ts`, `prompt.ts`, `service.ts`) com a conta do Andrew. O resumo usa o **mesmo** `claude` e o mesmo caminho configurado; não há chave nova nem serviço novo.
- Não há renomear falantes: na transcrição o mic é "Você" e o sistema é "Participante A/B…" ou "Participantes" (`speakerLabel`). O responsável de cada tarefa sai do que foi dito (nome citado na conversa) ou desses rótulos.

## Superfície
- `src/main/claude-cli/` — novo `summary.ts` (chamada única, não o processo persistente do tradutor).
- `src/main/meetings/` — guardar o resumo (`userData/meetings/<id>.summary.json`) e apagá-lo junto ao excluir a reunião.
- `src/main/audio-files/` — escrever o resumo na pasta da reunião e "Baixar" (diálogo de salvar + cópia).
- `src/shared/` (tipos + schema zod do resumo, IPC), preload.
- `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `features/settings/SettingsScreen.tsx` (uma linha).
- `features/meetings/MeetingDetailScreen.tsx` (+ componentes novos), `features/live/` (só o disparo ao encerrar).
- `src/main/smoke.ts` + fixtures (claude falso, como no contrato 05).

## Critérios de aceite
- CA1: tipo `MeetingSummary` (zod, no `shared`): `{ version: 1, meetingId, createdAt (ISO), model: string, overview: string, decisions: string[], tasks: { task: string, owner: string | null, due: string | null }[] }`. `overview` até 4 000 caracteres; listas até 50 itens; cada texto até 500. Arquivo inválido ao ler = sem resumo (não quebra a tela). Testes do schema.
- CA2: `summary.ts` gera o resumo com **uma** execução do `claude` (mesmo binário e mesmo isolamento do contrato 05: `--strict-mcp-config --setting-sources ""`, sem ferramentas, `-p` com `--output-format json`), transcrição enviada pelo stdin (nunca na linha de comando). Instrução em português pedindo **só JSON** no formato acima: `overview` = o que aconteceu, em 1 a 3 parágrafos curtos; `decisions` = o que foi decidido; `tasks` = cada tarefa combinada, `owner` = quem deve fazer ("Você" para quem fala no microfone, o nome citado na conversa quando houver, senão o rótulo "Participante A"…; `null` se ninguém foi apontado), `due` = prazo dito na conversa ou `null`. Nada inventado: sem tarefa clara, lista vazia. O resumo sai em **português**, qualquer que seja o idioma da reunião. Entrada: os trechos salvos (sem os marcados como eco), no formato `[mm:ss] Rótulo: texto`. Saída: extrai o primeiro objeto JSON do `result` (tolera cercas ```json), valida com o schema do CA1; inválido = erro `format`. Limite de 3 min; estourou = mata o processo e devolve `timeout`. Erros: `not-found` (sem `claude`), `timeout`, `format`, `failed`. Testes com processo falso (sucesso, cercas, JSON inválido, timeout, processo que morre).
- CA3: `AppSettings` ganha `summarizeOnStop: boolean` (padrão `true`). Configurações, no bloco do Claude CLI: interruptor "Resumir ao encerrar" com a ajuda "Ao encerrar, o Claude lê a transcrição e escreve o resumo, as decisões e as tarefas." `settings.json` antigo carrega com o padrão. Testes.
- CA4: ao encerrar uma gravação **com algum trecho**, depois de salvar a transcrição: com `summarizeOnStop` ligado e o `claude` encontrado, o main gera o resumo em segundo plano (a tela não espera) e grava `meetings/<id>.summary.json`. Um resumo por reunião por vez (pedido repetido enquanto gera é ignorado). Com a opção desligada ou sem `claude`, nada acontece.
- CA5: tela de detalhe com **três abas**: "Resumo", "Transcrição", "Áudio" (componente de abas seguindo `design.md`: sem pílula, sem sombra, raio ≤ 6 px, sublinhado/realce com os tokens). Abre em "Resumo" quando existe resumo ou está gerando; senão em "Transcrição". A aba "Transcrição" é o conteúdo de hoje (trechos + tradução + "Copiar transcrição").
- CA6: aba "Resumo":
  - com resumo: seção "O que aconteceu" (texto), "Decisões" (lista; some se vazia) e "Tarefas" (tabela ou lista com colunas "Tarefa", "Quem", "Prazo"; "—" quando `null`; "Nenhuma tarefa combinada." se vazia); rodapé discreto "Gerado pelo Claude em <data hora> · <modelo>"; botões "Copiar resumo" (texto Markdown no clipboard) e "Gerar de novo";
  - gerando: estado "Gerando o resumo…" (sem spinner girando com `prefers-reduced-motion`), a tela atualiza sozinha quando termina (evento do main → renderer);
  - sem resumo: texto "Esta reunião ainda não tem resumo." e botão "Gerar resumo";
  - erro: "Não foi possível gerar o resumo." + motivo curto (`not-found`: "Configure o Claude CLI em Configurações."; `timeout`: "O Claude demorou demais."; outros: "Tente de novo.") e "Tentar de novo";
  - reunião sem nenhum trecho: botão desabilitado com "Sem transcrição para resumir.".
- CA7: aba "Áudio": as linhas "Áudio" e "Transcrição" do contrato 07 (Abrir, Mostrar no Finder, "não encontrado") **mais** o botão "Baixar áudio…" em cada arquivo que existe: abre `dialog.showSaveDialog` no main com o nome do arquivo como padrão e copia o arquivo para onde o Andrew escolher (`copyFile`, sem sobrescrever sem o macOS confirmar). O caminho de origem vem sempre de `meetings.json` (o renderer só manda `meetingId` e `kind`), com a mesma checagem de extensão do 07; o resumo também pode ser baixado ("Baixar resumo…", gera o `.md` na hora). Sem arquivos (opção desligada na época): o texto de hoje "O áudio não fica guardado no Mac" e, se houver transcrição, "Baixar transcrição…" que gera o `.md` com `transcriptMarkdown`. Testes do main com pasta temporária.
- CA8: com `saveToFolder` ligado e a reunião com pasta (`audioPath` ou `transcriptPath`), o resumo gerado também vai para a pasta como `<mesmo nome> - resumo.md` (`.part` + renomear, `wx`, dentro da pasta, como no 07); gerar de novo **substitui** esse arquivo (renomear por cima). Conteúdo: título, data, "## O que aconteceu", "## Decisões", "## Tarefas" (lista `- [ ] tarefa — quem (prazo)`). Função pura `summaryMarkdown` no `shared`, a mesma do "Copiar resumo". Testes.
- CA9: excluir a reunião apaga o `summary.json` interno (não apaga nada da pasta, como no 07). Teste.
- CA10: smoke com `claude` falso: encerra a gravação da fixture, espera o resumo, tira `detalhe-resumo-light.png` e `-dark.png`, `detalhe-audio-light.png`, e confere `<nome> - resumo.md` na pasta temporária. Layout das telas existentes continua passando. `externalRequests: []`.

## Invariantes
- Critérios dos contratos 01 a 07 continuam passando (`gates.sh` inteiro, sem rede, sem `claude` real).
- O tradutor do contrato 05 não muda (o resumo é outro processo, curto, que não usa a fila dele).
- A transcrição só vai ao `claude` local do próprio Andrew; nenhum outro destino de rede novo.
- `prova/` e `docs/` não mudam (exceto este contrato, pelo coordenador).

## Fora de escopo
- Renomear falantes, editar o resumo à mão, resumo ao vivo durante a gravação, player de áudio dentro do app, enviar o resumo por e-mail ou qualquer canal, resumo com a AssemblyAI (LeMUR).

## Gates
- `apps/desktop/scripts/gates.sh` (smoke com `--no-sandbox` e `userData` por `os.tmpdir()`).
- Testes novos: CA1 a CA4, CA7 a CA9.

## Telas de impacto no usuário
- Detalhe da reunião: abas "Resumo", "Transcrição" e "Áudio"; resumo com o que aconteceu, decisões e tarefas com quem faz; botões de baixar.
- Configurações: "Resumir ao encerrar" (ligado por padrão).
- Na pasta da reunião: `<nome> - resumo.md`.

## Notas do coordenador
- Relatar o tempo e o custo nominal do resumo no teste com `claude` falso e, se possível, o tamanho do prompt de uma reunião de 1 h estimado.
- Nada de commit (o Andrew não pediu). Depois deste contrato vem a troca do nome para "LAP Reuniões" e o empacotamento para instalar.
