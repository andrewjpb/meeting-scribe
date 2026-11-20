# Contrato 87 — Endurecimentos menores: anexo, imagens remotas, pastas, janelas e links
Feature: arquitetura-seguranca · Wave: 2 · Depende de: 85 (mesmo `src/main/index.ts`), 84 (mesmo `ReadingPane.tsx`) · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa S4 do plan (R7, R8, R10). Cinco brechas pequenas, cada uma com âncora no código de hoje:
- **Anexo** (`src/main/index.ts:2240-2251`): `writeFile` direto no caminho escolhido, sem quarentena do macOS (um
  `.app` ou `.command` salvo abre sem o aviso do Gatekeeper) e sem gravação atômica.
- **Imagem remota** (`src/main/email/remote-images.ts`): `isRemoteImageUrl` aceita `http:` (linha 36) e
  `loadRemoteImages` resolve o nome (`resolvesPublic`, linha 118) e depois `net.fetch` (`index.ts:558-567`) resolve
  **de novo**: um DNS que responde público na primeira e `127.0.0.1` na segunda passa (rebinding).
- **Pastas de dados** criadas sem `mode`: `meetings/transcripts.ts:73`, `summaries.ts:39`, `notes.ts:51`,
  `analyses.ts:75`, `agents/store.ts:49`, `schedules/store.ts:100` (a do `schedules/store.ts:156` já usa `0o700`).
- **Janelas**: `appWebPreferences()` (`src/main/window.ts:34-46`) não desliga o DevTools no app empacotado;
  `guardWebContents` só é chamado à mão nas duas janelas (`window.ts:61`, `meeting-prompt/window.ts:74`).
- **`scribe:open-link`** (`index.ts:2320-2322`): abre qualquer `https:` que o renderer mandar; a confirmação é só da tela.

## Pré-condições
- Contratos 85 e 84 commitados na main (este toca os mesmos `index.ts` e `ReadingPane.tsx`). Gates verdes.
- Ler antes: os trechos acima; `src/main/security.ts` (`guardWebContents`, `decideWindowOpen`);
  `src/renderer/src/features/chat/ChatMarkdown.tsx:70-95`; `test/email-notify.test.ts:111-190` (imagens e anexos);
  `test/security.test.ts`; no smoke `email['reading']` (`smoke.ts:9236`) e `email['attachments']` (`smoke.ts:9512`).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/email/attachment-file.ts` | **novo**: `saveAttachment(path, bytes, deps)` atômico com quarentena (CA1, CA2) |
| `src/main/email/remote-images.ts` | só `https:`; uma resolução por URL; `RemoteImageFetch` recebe o endereço validado; `httpsPinnedFetch` (CA3, CA4) |
| `src/main/index.ts` | handler do anexo usa o CA1; `fetchRemoteImage` sai daqui; `web-contents-created`; `scribe:open-link` com diálogo (CA3, CA6, CA7) |
| `src/main/window.ts` | `appWebPreferences({ packaged })` com `devTools: !packaged` (CA5) |
| `src/main/meeting-prompt/window.ts` | passa `packaged`; a chamada direta a `guardWebContents` sai (CA5, CA6) |
| `src/main/security.ts` | `decideOpenLink(url, appLinks)` puro (CA7) |
| `src/main/meetings/{transcripts,summaries,notes,analyses}.ts`, `src/main/agents/store.ts`, `src/main/schedules/store.ts` | `mkdir(…, { recursive: true, mode: 0o700 })` nas 6 linhas (CA8) |
| `src/renderer/src/features/email/ReadingPane.tsx`, `src/renderer/src/features/chat/ChatMarkdown.tsx` | a confirmação `https` da tela sai: "Abrir" manda direto e o main pergunta (CA7) |
| `src/main/smoke-fixtures.ts`, `src/main/email/fake-email.ts` | `linkDialogs`, `linkChoice`; `fetchImage(url, address)` (CA9) |
| `src/main/smoke.ts` | `email['reading']` e `email['attachments']` ajustados (CA9) |
| `test/email-notify.test.ts`, `test/security.test.ts` | casos novos; `test/email-attachment-file.test.ts` **novo** (CA10) |

`build/extendInfo.plist` **não** muda (ver Dúvidas, item 1).

## Critérios de aceite
**Anexo (R7)**
- **CA1 — Gravação atômica.** `saveAttachment` grava em `<pasta>/.<nome>.tmp-<pid>-<n>`, marca a quarentena no
  temporário, faz `rename` para o caminho escolhido e só então responde `{ ok: true, name }`. Falha em qualquer passo →
  o temporário é apagado, o arquivo antigo (se havia) fica intacto e a resposta é `{ ok: false, error: 'write' }`.
- **CA2 — Quarentena.** O arquivo final tem o atributo `com.apple.quarantine` com valor `0081;<segundos em hex>;LAP
  Reuniões;` (escrito por `/usr/bin/xattr -w` via `execFile`, sem shell, prazo de 5 s). `xattr` falhou → `{ ok: false,
  error: 'write' }` e nada fica gravado (sem quarentena não salva). Fora do macOS (`process.platform !== 'darwin'`), só
  a gravação atômica. No smoke, o `xattr` é o de verdade (o smoke roda no Mac) e o passo confere o atributo.

**Imagens remotas (R8)**
- **CA3 — Só `https:`.** `isRemoteImageUrl('http://cdn.cliente.example/a.png') === false`; a imagem `http:` fica
  bloqueada como texto alternativo, sem pedido.
- **CA4 — Uma resolução, conexão no IP validado.** Por URL, `loadRemoteImages` chama o `lookup` **uma** vez, recusa se
  qualquer endereço for privado (regra atual de `isPrivateAddress`) e chama `fetchImage(url, address, signal)` com o
  primeiro endereço público. `httpsPinnedFetch` abre `https.request` com `lookup` que devolve só esse endereço,
  `servername` = nome da URL (SNI e certificado do nome), cabeçalho `Host` do nome, sem cookie, sem seguir
  redirecionamento (3xx → `null`), `image/*` e 5 MB como hoje (`readLimited`). Nenhuma chamada a `net.fetch` sobra
  para imagens.

**Janelas e IPC (R10)**
- **CA5 — DevTools.** `appWebPreferences({ packaged: true }).devTools === false`; `{ packaged: false }` → `true` (o smoke
  e o `pnpm dev` rodam sem empacotar). As duas janelas passam `app.isPackaged`.
- **CA6 — Guarda global.** `app.on('web-contents-created', (_e, contents) => guardWebContents(contents, appOrigin))`
  registrado antes da primeira janela (`app.whenReady`, `index.ts:2382`); as duas chamadas diretas saem. Toda
  `webContents` nova, inclusive as que surgirem depois, nega navegação para fora, janela nova e `<webview>`.
- **CA7 — Link pelo main.** `scribe:open-link` passa por `decideOpenLink(url, APP_LINKS)`: URL igual a uma de
  `APP_LINKS` (`REPOSITORY_URL`, `CLAUDE_CONNECTORS_URL`, `ASSEMBLYAI_DASHBOARD_URL`) → abre direto; outro `https:` →
  `dialog.showMessageBox(mainWindow, { type: 'question', message: 'Abrir no navegador?', detail: <url>, buttons:
  ['Abrir', 'Cancelar'], defaultId: 0, cancelId: 1 })` e só abre com 0; qualquer outra coisa → ignorado. Um diálogo
  por vez (pedido com outro aberto é ignorado). Na tela, o clique num link `https:` do email e do chat deixa
  de mostrar `[data-notice="email-external-link"]` / `[data-notice="chat-external-link"]` e manda `scribe:open-link`
  direto; o aviso de link inseguro (`http:`) do email continua.

**Pastas (R10)**
- **CA8 — 0700.** As 6 chamadas listadas passam `mode: 0o700`. Numa pasta de dados nova, `stat` de `meetings/`,
  `agents/` e `schedules/` dá `0o700` (pasta que já existia não muda de modo; fora de escopo corrigir).

**Smoke e testes**
- **CA9 — Smoke.** `email['attachments']`: o arquivo salvo tem `com.apple.quarantine` (`xattr -p`) e não sobra
  `.tmp-` na pasta. `email['reading']`: o clique no link registra uma entrada em `fixtures.linkDialogs` com
  `https://portal.cliente.example/proposta`; com `linkChoice = 1` nada abre; com `0` entra em `openedUrls`. O link do
  chat não tem passo de smoke hoje; fica coberto pelo `decideOpenLink` (CA10). "Abrir repositório" (`smoke.ts:4135`) abre sem diálogo. A imagem do `email['reading']`
  continua carregando pelo falso (`fetchImage(url, address)` recebe `93.184.216.34`).
- **CA10 — vitest.** `test/email-attachment-file.test.ts`: sucesso deixa só o arquivo final; `xattr` falso que falha
  não deixa arquivo nem temporário; `rename` que falha mantém o arquivo antigo. `test/email-notify.test.ts`: a
  expectativa de `http:` (linha 114) vira `false`; `lookup` contado = 1 por URL; `fetchImage` recebe o endereço
  validado; lookup que devolve público+privado → `null` sem `fetchImage`. `test/security.test.ts`: `decideOpenLink`
  para as três `APP_LINKS` (`open`), `https://x.example` (`ask`), `http://x.example`, `javascript:x` e 2049 caracteres
  (`ignore`).

## Invariantes
- Diálogo de salvar do anexo (pergunta antes de trocar arquivo existente) e o nome sugerido sem mudança.
- Limites de imagem (`EMAIL_REMOTE_IMAGES_MAX`, 5 MB, 10 s), `isPrivateAddress` e os sufixos locais sem mudança.
- Formato dos arquivos de dados e o modo 0600 dos arquivos sem mudança (só as pastas).
- `decideNavigation`, `decideWindowOpen` e a CSP sem diff.

## Fora de escopo
- Quarentena em outros arquivos que o app grava (áudio, resumo `.md`, plugin salvo). Corrigir o modo de pastas que já
  existem. Associar o link a "conteúdo exibido" (a outra opção do R10). Camada de armazenamento (R11+). F1–F7.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- `test/email-attachment-file.test.ts` novo e os casos novos de `email-notify` e `security`; smoke ajustado (CA9).
- `git diff --stat` só com a Superfície. Sem commit.

## Dúvidas para o coordenador
1. **`LSFileQuarantineEnabled` não serve.** Ele põe quarentena em **todo** arquivo que o app cria, inclusive o que ele
   mesmo executa depois (ambiente Python da ponte do WhatsApp, pacote do ACP baixado do npm, helper do Calendário):
   quebraria esses fluxos. Por isso o CA2 usa o `xattr` só no anexo. A spec deixa as duas opções.
2. **Dependência do 84.** O plan põe S4 dependendo só de S2; o CA7 tira a confirmação da tela em `ReadingPane.tsx`, que
   o 84 reescreve. Ordem proposta: 84 → 87.
3. **Uma confirmação, não duas (CA7).** A spec diz "mantém a confirmação, agora feita pelo main"; li como mover (tirar a
   da tela). Se preferir manter as duas, o CA7 perde a parte da tela e o smoke confere as duas.
4. **DevTools e o smoke.** O smoke usa `webContents.debugger` (CDP) e roda sem empacotar, então `devTools: true` lá; o
   CA5 não afeta o smoke, mas um smoke futuro sobre o `.app` empacotado precisaria de outra chave.
