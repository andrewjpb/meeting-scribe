# Contrato 31 — Plugins no app (salvar e instalar o plugin do Chrome pelo app)
Feature: desktop-shell · Wave: 31 · Depende de: 27 (extensão do Meet) · PRD: `docs/specs/desktop-shell/prd-plugins-no-app.md`

## Pré-condições (fatos do código, conferidos em 18/11/2026, árvore limpa na main; caminhos relativos a apps/desktop)
- Empacotamento: **electron-packager** via `scripts/pack.sh` (binário de `../../prova/node_modules/.bin/electron-packager`, `--asar --no-prune`, :19,:44-52); pasta STAGE copia `resources/brand`, `resources/assistente` e `services/whatsapp-bridge` (:24-37) — tudo entra no **app.asar**; conferência com `asar list` + grep (:58-62). `pack-linux.sh` repete os `cp` (:23-32) e a conferência (:49-50). Caminhos no main: padrão `app.getAppPath()`; modelo dev×empacotado = `bridgeSourceDir()` (`src/main/index.ts:504-506`).
- "Baixar…" (modelo de salvar): canal `scribe:meeting-file-download` (`ipc.ts:133`, INVOKE :449, WHEN_LOCKED :674 'refused'); handler `index.ts:1212`; serviço `src/main/audio-files/download.ts` (`SaveDialog` :21-23, cópia com `copyFile` :98). Diálogo de PASTA: `nativeFolderDialog` (`index.ts:1015-1021`, showOpenDialog openDirectory+createDirectory); substitutos do smoke em `index.ts:822-848` + `smoke-fixtures.ts:158-164` (`chosenFolder`). Feedback "Salvo" em `MeetingFiles.tsx:94`.
- Abas: `SETTINGS_TABS` em `src/shared/routes.ts:42` (`['geral','gravacao','claude','arquivos','contas','sobre']`), rota `/configuracoes/:aba?` (:47), `settingsPath(tab, anchor?)` (:54). Adicionar aba exige TAMBÉM: `SETTINGS_TAB_LABELS` (`features/settings/settingsTabs.ts:9-16`), painel em `SettingsScreen.tsx` (:281-443, TABS :103), `SETTINGS_LABELS` no Assistente (`src/main/chat/actions.ts:74`), marcador `<!-- aba: plugins -->` no `resources/assistente/guia-do-app.md` (exigido por `test/assistant.test.ts:439`), `test/renderer/settings-tabs.test.ts:26-27`, e os comentários "seis abas"/"⌘1…⌘6" (`SettingsScreen.tsx:110,:158`). O regex de atalho já aceita 1-9. `settingsIndex` cobre só linhas `[data-setting-row]` (o smoke exige toda linha montada no índice, `smoke.ts:3776-3783`).
- Marcador: `MeetMarker` span em `LiveScreen.tsx:187-200` (`data-meet-marker`, título no `title`), `useNavigate` já em :3/:40; padrão de botão-link: `NOTE_ACTION_CLASS` (`design/Note.tsx:19`, tem `no-drag` — o cabeçalho é arrastável). O smoke lê `textContent` de `[data-meet-marker]` (`smoke.ts:5998,:6085-6089`).
- `useMeet` exportado (`meetStore.ts:248`, `connected`/`participants`); `useMeetSync` global no Shell.
- Abrir pasta/link: `nativeOpener` (`index.ts:1046-1049`) só via canais de meeting; `openExternal` não abre `chrome://` — o manual manda DIGITAR o endereço.
- Smoke: `settingsChecks` :3088, `settingsTabsChecks` :3687, orquestração :6604-6640 (`settings['meetingFiles']` em :6633; shots `configuracoes-*` :6620); modelo de check de download: `downloadsCheck` :1804; `meetChecks` :6008 (markerOff :6085).

## Critérios de aceite

### CA1 — Extensão embutida no pacote
- `pack.sh` e `pack-linux.sh` copiam `../../extensions/meet` para `$STAGE/resources/meet-extension` e a conferência do asar passa a exigir um arquivo dela (ex.: `resources/meet-extension/manifest.json`).
- Fonte no main: `pluginSourceDir('meet')` no padrão do `bridgeSourceDir`: empacotado = `join(app.getAppPath(),'resources','meet-extension')`; dev = `join(app.getAppPath(),'..','..','extensions','meet')`.

### CA2 — Registro de plugins (genérico) e IPC
- `src/shared/plugins.ts` (novo): `AppPlugin { id:'meet', nome:'Quem fala no Meet', navegador:'Google Chrome', descricao, arquivos:['manifest.json','content.js','background.js','README.md'] }`, lista `APP_PLUGINS` (hoje 1; um plugin futuro = nova entrada + pasta embutida).
- Canal novo `scribe:plugin-save {id}` → `{ok:true, path}|{ok:false}|null (cancelado)`: valida o id contra `APP_PLUGINS`, abre `nativeFolderDialog`, cria `<pasta escolhida>/LAP Reunioes - <nome do plugin>/` e copia os arquivos **um a um** (`readdir`+`copyFile`, nunca `fs.cp` — a origem vive no asar), recusando sobrescrever arquivo por symlink (cópia simples basta). WHEN_LOCKED = `'refused'`. Teste vitest: cópia completa, id desconhecido recusado, cancelamento.

### CA3 — Aba Configurações › Plugins
- Aba nova `plugins` com TODOS os pontos listados nas pré-condições (rota, rótulo, painel, SETTINGS_LABELS, guia do Assistente, teste das abas, comentários ⌘1…⌘7).
- Cartão por plugin (de `APP_PLUGINS`): nome + navegador; estado — para o `meet`, "Conectado" (texto `text-live`) quando `useMeet().connected`, senão "Desconectado" (`text-text-muted`; NÃO vermelho aqui: desconectado é o normal fora de reunião); botão **"Salvar plugin…"** (chama o canal; feedback "Salvo em <caminho>" no padrão do MeetingFiles); botão **"Como instalar"** que expande o manual inline, numerado: 1) Salvar plugin… numa pasta à sua escolha; 2) no Chrome, digitar `chrome://extensions` no endereço; 3) ligar "Modo do desenvolvedor"; 4) "Carregar sem compactação" e escolher a pasta salva; 5) recarregar a aba do Meet; observação: desligar o picture-in-picture automático do Meet (o mini-player esconde a reunião do plugin) e manter a aba do Meet aberta. Texto final: "Tudo fica neste computador: o plugin só fala com o app."
- Linhas do cartão marcadas `data-setting-row` entram no `settingsIndex` (senão o smoke reprova). Dark ok. Sem dependência nova.

### CA4 — Marcador clicável na gravação
- O `MeetMarker` vira `<button type="button">` (classe com `no-drag`), mantendo `data-meet-marker="on|off"` e o MESMO texto (o smoke lê `textContent`); `title` vira também `aria-label`. Clique → `navigate(settingsPath('plugins'))` (nos dois estados). Nenhuma mudança visual além do cursor/hover discreto.

### CA5 — Segurança e invariantes
- Nada de rede nova; nada baixado; a extensão embutida é cópia fiel de `extensions/meet` (que NÃO muda neste contrato). `prova/` não muda. Contratos 01–30 continuam passando.

### CA6 — Testes e smoke
- Vitest: CA2; `settings-tabs.test` atualizado; `lock-ipc` com o canal novo; `assistant.test` com o marcador da aba.
- Smoke: `settings['plugins']` no estilo `downloadsCheck`/`meetingFilesSettings` — fixa `fixtures.chosenFolder` numa pasta temporária, clica "Salvar plugin…", confere com `existsSync` os 4 arquivos em `LAP Reunioes - Quem fala no Meet/`, e confere o manual expandido; shot novo `configuracoes-plugins` (claro; 79 PNGs no total). Em `meetChecks`, após o `markerOff`: clicar o marcador → rota termina em `/configuracoes/plugins` (e voltar para não quebrar o resto do fluxo).

## Fora de escopo
- Chrome Web Store; "Mostrar no Finder" após salvar; abrir `chrome://extensions` por link; detectar a versão instalada da extensão; plugin do Teams (só a estrutura fica pronta).

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde E `bash apps/desktop/scripts/pack.sh` concluindo com a conferência do asar (a extensão dentro do pacote é o coração do contrato).

## Telas de impacto no usuário
- Configurações › Plugins (aba nova); marcador do Meet clicável na gravação.

## Notas do coordenador
- Commit/push ao final AUTORIZADOS pelo Andrew (18/11 15:05) — mas quem commita é o coordenador pelo fluxo normal, não o implementador.
