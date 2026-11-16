# Prova da fase 0 (descartável)

App Electron mínimo para executar na máquina os testes 1 a 12 da parte B de `docs/fase0.md`.
Sem framework, sem TypeScript, sem bundler; a página carrega por `file://`. Não é código de produto.

Electron fixado em **45.3.1**: a 45.3.2 saiu no GitHub (13/11/2026) mas ainda não está no npm.
Quando estiver, trocar a versão em `package.json` e rodar `npm install`.

## Como rodar

```bash
cd prova
npm install          # baixa o Electron (só na primeira vez)
npm start            # roda pelo terminal: o pedido de permissão vai para o terminal/IDE
npm run pack         # empacota em dist/ e assina ad-hoc com entitlements.plist
open dist/MeetingScribeProva-darwin-arm64/MeetingScribeProva.app   # o pedido vai para o app
```

Resultados em `prova/out/` (também quando o `.app` é aberto de dentro de `dist/`):
- `prova.log`: tudo o que a tela mostra, com timestamp (main e renderer);
- `<timestamp>-<fonte>-<taxa>hz-<canais>ch.wav`: dois WAVs por fonte a cada "Gravar 30 s"
  (taxa nativa como veio e 16 kHz mono).

Para zerar as permissões e ver o pedido de novo:
`tccutil reset Microphone com.lap.meetingscribe.prova` (mic) e
Ajustes do Sistema > Privacidade e Segurança > Gravação de Áudio do Sistema (desmarcar/remover).
Rodando pelo terminal, a permissão é do terminal/IDE, não do app.

Scripts (Node 22, sem dependências, rodar de dentro de `prova/`):

```bash
bash scripts/tcc-symbols.sh
OPENROUTER_API_KEY=... node scripts/test-openrouter.mjs
ASSEMBLYAI_API_KEY=... node scripts/test-assemblyai.mjs out/<timestamp>-sistema-16000hz-1ch.wav
```

## Tela

- **Mic** / **Sistema** / **Mic + Sistema**: abrem as capturas. Mic sem AEC/NS/AGC, 1 canal.
  Sistema por `getDisplayMedia({video:false, audio})`, que o main responde com `{audio:'loopback'}`.
- **restrictOwnAudio**: marcar antes de clicar em Sistema (vale na captura seguinte).
- **Parar**: para tudo (e cancela uma gravação em andamento).
- **Gravar 30 s**: grava os próximos 30 s de cada fonte ativa.
- **Tocar tom de teste**: 440 Hz tocado pelo próprio app. Com a captura do sistema ativa, o log
  mostra quanto tempo o tom levou para aparecer no loopback (aproximado).
- Cada painel mostra `readyState`, `getSettings()` (com `deviceId` e `sampleRate`), a taxa do
  `AudioContext`, eventos `ended`/`mute`/`unmute` com horário e o nível RMS/dBFS (10x por segundo).
- Aviso vermelho **"possível permissão negada"**: trilha do sistema `ended`, ou `live` com RMS em
  zero absoluto por 3 s. Sem nada tocando no Mac o aviso também aparece (silêncio é zero): toque algo.

## Roteiro: teste N de `docs/fase0.md`

| # | O que clicar / fazer | O que observar | Onde fica o resultado |
|---|---|---|---|
| 1 | `npm start`, clicar **Sistema**. Depois `npm run pack`, abrir o `.app` de `dist/` e clicar **Sistema** | Pelo terminal, o pedido "Gravação de Áudio do Sistema" sai em nome do Terminal/iTerm/VS Code; empacotado, em nome de MeetingScribeProva. A assinatura ad-hoc do `pack.sh` não usa `--options runtime`: o app empacotado não tem Hardened Runtime e os entitlements não se aplicam, então este teste valida só o prompt em nome do app | Tela; `out/prova.log` (`displayMedia: ... -> {audio:'loopback'}`, `empacotado=true/false`) |
| 2 | Negar o pedido (ou desmarcar o app em Ajustes > Gravação de Áudio do Sistema e reabrir), clicar **Sistema** | Sem erro no JS; `readyState` = `ended` logo de cara, ou `live` sem som; aviso vermelho aparece | Painel Sistema; `prova.log` (`ended (já nasceu assim)`, `AVISO possível permissão negada`) |
| 3 | **Sistema**, tocar áudio no Chrome/Zoom/Meet; alternar fone e alto-falante; trocar a saída padrão no meio | Só a saída padrão tem nível; após a troca, se a barra volta a mexer e se vem `ended`/`mute` | Painel Sistema; `prova.log` (`devicechange`, eventos da trilha); WAVs de **Gravar 30 s** |
| 4 | **Sistema** com uma reunião tocando | Continua-se ouvindo normalmente (o handler usa `'loopback'`, sem mute) | Ouvido; anotar em `docs/fase0.md` |
| 5 | Marcar **restrictOwnAudio**, clicar **Sistema**, **Tocar tom de teste**. Repetir sem marcar | Com a opção: `deviceId` = `loopbackWithoutChrome` e a barra não reage ao tom. Sem a opção: reage, e o log traz a latência | Painel Sistema (`getSettings()`); `prova.log` (`tom detectado no loopback ... ms`) |
| 6 | **Sistema** | Não aparece pedido de Gravação de Tela nem o ícone roxo de compartilhamento; só o indicador de áudio | Barra de menus; anotar em `docs/fase0.md` |
| 7 | **Sistema**, **Gravar 30 s** | `getSettings().sampleRate`/`channelCount`, `AudioContext.sampleRate` e "primeiro bloco: N canal(is)" (esperado 48 kHz estéreo); latência pelo tom (teste 5 sem restrict) | Painel; `prova.log`; `afinfo out/*-sistema-*.wav`. **Drift de 60 min não é medido pelo app** (ver abaixo) |
| 8 | Zoom em chamada, **Mic + Sistema**, falar; depois repetir com alto-falante; **Gravar 30 s** | O outro lado continua ouvindo normal; nos WAVs, eco/duplicação da voz do outro lado no mic | WAVs `*-mic-*` e `*-sistema-*` em `out/` |
| 9 | Abrir o app (sem clicar), depois **Mic**; fechar e abrir de novo | Na abertura o status sai sem diálogo (`not-determined`/`granted`/`denied`); na 2ª execução não há pergunta | Linha "Microfone (getMediaAccessStatus)" na tela; `prova.log` (`sem diálogo`) |
| 10 | `bash scripts/tcc-symbols.sh` | Se `_TCCAccessPreflight` e `_TCCAccessRequest` continuam exportados no macOS 26 | Terminal. O script mostra só a presença; os parâmetros exigem Hopper (instrução no próprio script) |
| 11 | Qualquer captura | Só a metade `audioWorklet.addModule`, e em `file://` | `prova.log` (`addModule: url` ou, se a URL falhar em `file://`, `addModule: blob`). **OPFS e a origem `scribe://app` ficam fora desta prova** (ela usa `file://`) |
| 12 | `node scripts/test-openrouter.mjs`; **Sistema** + **Gravar 30 s** com fala (uma reunião tocando) e `node scripts/test-assemblyai.mjs out/<...>-16000hz-1ch.wav` | OpenRouter: `/key`, 10 modelos com preço, `response.model`, `usage.cost`, latência, JSON válido. AssemblyAI: `Begin.configuration` (modelo realmente usado), turnos parciais/finais com `speaker_label`, `SpeakerRevision`, `start`/`end` das palavras comparados com "áudio enviado" | Terminal |

## Limites conhecidos

- Drift (teste 7): os quadros contados no AudioWorklet seguem o relógio do `AudioContext` (saída),
  não o do tap, então o app não mede drift. Fica para um teste dedicado.
- O nível e a gravação passam pelo WebAudio no `AudioContext` criado na taxa da trilha.
