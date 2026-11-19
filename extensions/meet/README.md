# Quem fala no Meet — extensão do Chrome

Extensão do LAP Reuniões (contratos 27 e 41). No Google Meet e no Microsoft Teams web, ela lê a lista de
participantes e quem está falando agora, e manda para o app, neste computador. Na transcrição, cada fala da
reunião ganha o nome de quem falou ("Ana", ou "Ana + Bruno" quando duas pessoas falam juntas).

- Teams: só a reunião aberta no Chrome (`teams.microsoft.com`, `teams.live.com` ou `teams.cloud.microsoft`), não o app do Teams. A
  leitura do Teams ainda é melhor esforço: os seletores não foram calibrados numa reunião real.

- Não é bot: nada entra na reunião.
- Não lê legendas e não mexe na página.
- Só fala com `127.0.0.1` (o app). Nada sai do computador.

## Instalar (sem compactar)

1. No Chrome, abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensions/meet` deste repositório.
4. A extensão aparece como "LAP Reuniões — Quem fala no Meet e no Teams".

Depois de mudar algum arquivo, clique no ícone de recarregar da extensão em `chrome://extensions` e recarregue a
aba do Meet (ou do Teams).

## Testar

1. No app, em **Configurações › Gravação › Transcrição**, deixe ligado **Quem fala no Meet** (vem ligado).
2. Entre numa chamada do Meet (ou do Teams web) no Chrome.
3. Comece uma gravação no app. No cabeçalho da gravação aparece "Meet conectado · N participantes".
4. Encerre. Na transcrição, as falas dos participantes aparecem com o nome.

Conferir sem o app: o servidor local escuta numa das portas 47632 a 47641. Para ver o que a extensão manda,
abra `chrome://extensions`, clique em **service worker** da extensão e veja a aba **Network**: um `POST
/v1/eventos` a cada segundo, com `{ reuniao, participantes, eventos }` e, desde o aviso de reunião (contrato 48),
`plataforma` (`meet` ou `teams`) e `titulo` (o título da aba, só texto, até 120 caracteres), os dois opcionais.
Com eles, ao entrar numa reunião o app mostra no topo da tela o aviso **Começar a transcrever**.

Conferir o servidor sem a extensão (com o app aberto):

```sh
curl -i -X POST http://127.0.0.1:47632/v1/eventos \
  -H 'Origin: chrome-extension://teste' -H 'Content-Type: application/json' \
  -d '{"reuniao":"abc-defg-hij","participantes":["Ana"],"eventos":[{"nome":"Ana","falando":true,"ts":0}]}'
```

Responde `{"ok":true}`. Sem a origem `chrome-extension://`, responde 404.

## Quando o Meet muda

O Meet muda a página sem aviso. Quando os nomes pararem de aparecer, ajuste os seletores do objeto
`LEITOR_MEET` no topo de `content.js` (`TILE_SELECTORS`, `NAME_SELECTORS`, `SPEAKING_CLASSES`, `SILENT_CLASSES`,
`PEOPLE_ROW_SELECTORS`). O motor, abaixo dele, não muda. Cada plataforma é um leitor com a mesma interface:
`id()`, `read()` (que devolve `{ participantes, falando }`), `titulo()` e `plataforma`; o leitor é escolhido pelo
endereço da aba.
Para achar os novos: na chamada, abra o DevTools (⌥⌘I), inspecione o tile de quem está falando e veja qual classe
muda quando a pessoa fala e quando para. A gravação nunca é afetada: sem a extensão, a transcrição só perde os
nomes.

## Quando o Teams muda (e a calibração pendente)

O leitor do Teams é o objeto `LEITOR_TEAMS`, logo abaixo do Meet em `content.js`. Ele foi escrito sem uma reunião
real: `TILE_SELECTORS`, `ROSTER_ROW_SELECTORS`, `NAME_SELECTORS`, `SPEAKING_SELECTORS`, `SELF_SELECTORS` e
`IN_CALL_SELECTORS` são palpites. Na primeira reunião do Teams no Chrome, confira no DevTools (⌥⌘I): o elemento
de cada tile (e onde está o nome), o que muda no tile quando a pessoa fala (classe, atributo ou `aria-label` do
anel de voz), a linha de cada pessoa no painel "Pessoas" e o botão "Sair". O id da reunião vem da URL
(`19:meeting_…@thread.v2` no link de entrada, `/meet/<número>` no teams.live.com) ou, dentro da chamada, de um
hash do caminho da URL.
