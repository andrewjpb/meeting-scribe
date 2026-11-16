# Contrato 07 — Salvar o áudio e a transcrição da reunião numa pasta
Feature: desktop-shell  ·  Wave: 7  ·  Depende de: 06 (mexe nos mesmos arquivos: `recordingStore.ts`, configurações, `SettingsScreen.tsx`)

## Pré-condições
- Contrato 06 aceito; `apps/desktop/scripts/gates.sh` verde.
- Decisão do Andrew (15/11/2026): gravar o áudio **e** a transcrição de cada reunião numa pasta do Mac. Sem Google Drive nem conta Google: só uma pasta local escolhida por ele. Ele quer isso sempre: **ligado por padrão**, podendo desligar.
- Hoje vale "o áudio não é gravado em disco" (invariante dos contratos 02 a 06, e a tela de detalhe diz "O áudio não fica guardado no Mac"). Este contrato troca isso por: **grava com a opção ligada (padrão)**; desligada, tudo continua como hoje. A transcrição continua também no armazenamento interno do app (`meetings/<id>.json`), como hoje; a pasta recebe uma cópia legível.

## Superfície
- `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts`, `src/shared/ipc.ts`, preload.
- `src/main/` — novo `audio-files/` (escrita em disco, nome do arquivo, escolha da pasta com diálogo nativo).
- `src/renderer/src/audio/` ou `features/live/` — gravador (mistura das duas fontes + `MediaRecorder`).
- `features/settings/SettingsScreen.tsx`, tela de detalhe da reunião, `meetings.json` (campo novo).
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: `AppSettings` ganha `saveToFolder: boolean` (padrão `true`) e `audioFolder: string | null` (padrão `null` = `~/Documents/Meeting Scribe`). `settings.json` antigo carrega com os padrões. `audioFolder` **não** entra no patch geral vindo do renderer: só muda pelo diálogo nativo do main (CA2), para o renderer não conseguir escrever em pasta arbitrária. Testes.
- CA2: Configurações ganha o bloco "Arquivos da reunião" com: interruptor "Salvar áudio e transcrição numa pasta"; quando ligado, a pasta atual (caminho encurtado com `~`) e o botão "Escolher pasta…" que abre `dialog.showOpenDialog` (`openDirectory`, `createDirectory`) no main; e a ajuda "Para cada reunião: um arquivo de áudio (você e os participantes) e a transcrição em texto. Avise as pessoas antes de gravar." Segue `design.md` e os componentes base. Smoke: `configuracoes-arquivos-light.png` e `-dark.png`.
- CA3: com `saveToFolder` ligado, ao iniciar a gravação o renderer mistura mic e sistema (as fontes que abriram) num único fluxo e grava com `MediaRecorder`. Formato: o primeiro de `audio/mp4;codecs=mp4a.40.2`, `audio/mp4`, `audio/webm;codecs=opus` que `MediaRecorder.isTypeSupported` aceitar (m4a toca no QuickTime; webm é a reserva). Relatar qual saiu no Electron 45. Volume das fontes sem ganho extra. A captura que vai para a AssemblyAI não muda em nada (mesmos quadros, mesma latência).
- CA4: o áudio vai para o disco **em pedaços** enquanto grava (`timeslice` de 5 s → IPC → `appendFile` no main), nunca a reunião inteira na memória. O main só escreve dentro de `audioFolder` (caminho resolvido e conferido; nome sem `/` nem `..`), cria a pasta se faltar, e grava primeiro em `<nome>.part` e renomeia no fim. Pasta que não dá para escrever: aviso na gravação "Não foi possível salvar o áudio nesta pasta. A transcrição continua." e a gravação segue. Testes do main com pasta temporária.
- CA5: nome do arquivo: `AAAA-MM-DD HHhMM - <título da reunião>.<ext>` (título limpo de caracteres proibidos no macOS, até 80 caracteres; se já existir, ` (2)`, ` (3)`…). Testes.
- CA6: pausar pausa o `MediaRecorder` (o arquivo não guarda o silêncio da pausa); retomar continua no mesmo arquivo. Encerrar para o gravador, espera o último pedaço (até 5 s), renomeia o `.part` e grava o caminho na reunião (`meetings.json` ganha `audioPath: string | null`; reuniões antigas carregam com `null`). Testes.
- CA6b: transcrição na pasta: ao encerrar (depois de salvar a transcrição interna), o main escreve `<mesmo nome>.md` na mesma pasta com `transcriptMarkdown` (o mesmo texto do "Exportar" de hoje: título, data, trechos com hora, fonte/falante e tradução). Escrita em `.md.part` + renomear. Mudanças depois de encerrar (renomear a reunião, falantes) **não** reescrevem o arquivo. Reunião sem nenhum trecho: não cria o `.md`. Falha ao escrever: o mesmo aviso do CA4, sem perder a transcrição interna. `meetings.json` ganha `transcriptPath: string | null`. Testes do main.
- CA7: se o app fechar ou travar no meio, o `.part` fica na pasta (não é apagado) e, na próxima abertura, é renomeado para o nome final com ` (incompleto)` antes da extensão. Teste do main.
- CA8: tela de detalhe da reunião: com `audioPath` e o arquivo existindo, mostra as linhas "Áudio" e "Transcrição" (cada uma com o nome do arquivo, "Abrir" (`shell.openPath`) e "Mostrar no Finder" (`shell.showItemInFolder`)); arquivo apagado ou movido: "Áudio não encontrado em <pasta>". Sem `audioPath`, o texto de hoje. Excluir a reunião **não** apaga os arquivos da pasta, e a confirmação diz isso.
- CA9: durante a gravação, com `saveToFolder` ligado, a barra de controles mostra um marcador discreto "Gravando áudio" (ícone de disco), para a pessoa saber que está gravando o som. Segue `design.md`.
- CA10: smoke com o gravador falso (sem `MediaRecorder` real): confere a gravação de pedaços numa pasta temporária, o `.part` renomeado no fim, o `.md` com o texto da fixture e as linhas "Áudio" e "Transcrição" no detalhe. `externalRequests: []`.

## Invariantes
- Critérios dos contratos 01 a 06 continuam passando (`gates.sh` inteiro, sem rede, sem `claude` real).
- Com `saveToFolder` desligado, **nenhum** byte de áudio vai para o disco e nada é escrito fora do `userData`, igual a hoje.
- O áudio salvo nunca vai para a rede. O envio à AssemblyAI e o Claude CLI não mudam.
- `prova/` e `docs/` não mudam (exceto este contrato, pelo coordenador).

## Fora de escopo
- Google Drive ou qualquer nuvem (a pasta pode ser a do Drive para Mac se o Andrew quiser; o app não sabe disso), trilhas separadas por fonte, player dentro do app, cortar o áudio, transcrever de novo a partir do arquivo, apagar os arquivos ao excluir a reunião, reescrever o `.md` depois de editar a reunião.

## Gates
- `apps/desktop/scripts/gates.sh` (o smoke precisa de `--no-sandbox` no shell do Kiro e `userData` criado por `os.tmpdir()` do Node).
- Testes novos: CA1, CA4 a CA8 (com o CA6b).

## Telas de impacto no usuário
- Configurações: bloco novo "Arquivos da reunião" (ligado por padrão), com escolha de pasta.
- Gravação ao vivo: marcador "Gravando áudio" e aviso quando a pasta falha.
- Detalhe da reunião: linhas "Áudio" e "Transcrição" com Abrir e Mostrar no Finder; confirmação de excluir avisa que os arquivos da pasta ficam.
- Na pasta: `<nome>.m4a` e `<nome>.md` por reunião.

## Notas do coordenador
- Gravar a voz de outras pessoas pode exigir o consentimento delas; por isso a ajuda do CA2 e o marcador do CA9.
- Tamanho esperado: AAC/Opus mono ~64 kbps ≈ 30 MB por hora. Relatar o tamanho medido no smoke ou num teste curto.
- Nada de commit (o Andrew não pediu).
