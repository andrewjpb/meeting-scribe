# Quem fala no Meet — extensão do Chrome

Extensão do LAP Reuniões (contrato 27). No Google Meet, ela lê a lista de participantes e quem está falando
agora, e manda para o app, neste computador. Na transcrição, cada fala do Meet ganha o nome de quem falou
("Ana", ou "Ana + Bruno" quando duas pessoas falam juntas).

- Não é bot: nada entra na reunião.
- Não lê legendas e não mexe na página.
- Só fala com `127.0.0.1` (o app). Nada sai do computador.

## Instalar (sem compactar)

1. No Chrome, abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta `extensions/meet` deste repositório.
4. A extensão aparece como "LAP Reuniões — Quem fala no Meet".

Depois de mudar algum arquivo, clique no ícone de recarregar da extensão em `chrome://extensions` e recarregue a
aba do Meet.

## Testar

1. No app, em **Configurações › Gravação › Transcrição**, deixe ligado **Quem fala no Meet** (vem ligado).
2. Entre numa chamada do Meet no Chrome.
3. Comece uma gravação no app. No cabeçalho da gravação aparece "Meet conectado · N participantes".
4. Encerre. Na transcrição, as falas dos participantes aparecem com o nome.

Conferir sem o app: o servidor local escuta numa das portas 47632 a 47641. Para ver o que a extensão manda,
abra `chrome://extensions`, clique em **service worker** da extensão e veja a aba **Network**: um `POST
/v1/eventos` a cada segundo, com `{ reuniao, participantes, eventos }`.

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
`PEOPLE_ROW_SELECTORS`). O motor, abaixo dele, não muda. Outra plataforma (Teams) entra como outro leitor com a
mesma interface: `id()` e `read()`, que devolve `{ participantes, falando }`.
Para achar os novos: na chamada, abra o DevTools (⌥⌘I), inspecione o tile de quem está falando e veja qual classe
muda quando a pessoa fala e quando para. A gravação nunca é afetada: sem a extensão, a transcrição só perde os
nomes.
