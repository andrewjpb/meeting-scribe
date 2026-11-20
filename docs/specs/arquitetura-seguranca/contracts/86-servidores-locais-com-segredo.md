# Contrato 86 — Servidores locais com segredo
Feature: arquitetura-seguranca · Wave: 1 · Depende de: D3 (decisão do Andrew) · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa S3 do plan (R4). O app ouve em `127.0.0.1` dois servidores `node:http` para as extensões do Chrome que
vêm no pacote (código em `extensions/navegador/` e `extensions/meet/` na raiz do repo; o app copia a pasta pelo
"Salvar plugin…", `src/main/plugins/save.ts`, e a pessoa carrega sem compactar em `chrome://extensions`).
- **Controle do navegador** (`src/main/navegador/server.ts`, portas 47672–47681): long-poll `GET
  /v1/navegador/comandos` e `POST /v1/navegador/resultados`. Hoje aceita qualquer pedido com `x-lap-navegador: 1`
  e, se houver `Origin`, `chrome-extension://*` (`acceptsNavegadorRequest`, `server.ts:59-71`). A extensão
  (`extensions/navegador/background.js:389-392`) manda só esse cabeçalho. Qualquer processo local (ou outro usuário
  do Mac) recebe os comandos do agente e devolve "resultados" falsos que viram contexto do Claude.
- **Quem fala no Meet** (`src/main/meet/server.ts`, portas 47632–47641): `POST /v1/eventos` com `Origin` começando
  por `chrome-extension://` (`acceptsRequest`, `server.ts:85-96`); qualquer extensão do Chrome passa.
Nenhum dos dois confere `Host` (DNS rebinding).

## Pré-condições
- **D3 decidida pelo Andrew** (aceitar que a extensão do navegador seja salva de novo uma vez). Sem D3, só a parte
  do Meet (CA5–CA7) e o `Host` do navegador (CA2) entram; o token (CA1, CA3, CA4) espera.
- Main em dia, gates verdes. Ler antes: os dois `server.ts`, `src/main/plugins/save.ts`, `src/shared/plugins.ts`,
  `extensions/navegador/{background.js,README.md}`, `extensions/meet/{manifest.json,background.js}`,
  `src/main/secrets.ts` (`SafeStorageLike`, gravação 0600), `scripts/pack.sh:40-50`, `test/navegador-server.test.ts`,
  `test/meet-server.test.ts`, e no smoke `navegadorPluginChecks` (`smoke.ts:2215`) e `meetChecks` (`smoke.ts:7909`).

## Superfície (caminhos relativos a `apps/desktop/`; `../../extensions/…` é a raiz do repo)
| Arquivo | O que muda |
|---|---|
| `src/main/navegador/token.ts` | **novo**: gera, guarda (cifrado) e lê o token da instalação (CA1) |
| `src/main/navegador/server.ts` | `acceptsNavegadorRequest` confere token e `Host`; 401 para token errado (CA2, CA3) |
| `src/main/plugins/save.ts` | ao salvar o `navegador`, grava `pareamento.json` na pasta (CA4) |
| `src/main/meet/server.ts` | `acceptsRequest` com allowlist do ID e `Host` (CA5) |
| `src/shared/meet.ts` | `MEET_EXTENSION_ID` (CA5) |
| `src/shared/navegador.ts` | `NavegadorState.pareada: boolean` (CA3) |
| `src/main/index.ts` | liga o token ao servidor e ao `createPluginSave` (CA1, CA4) |
| `src/renderer/src/features/settings/` (cartão do plugin `navegador`) | texto "Salve o plugin de novo para parear" quando `pareada` é falso (CA3) |
| `../../extensions/navegador/background.js`, `README.md` | lê `pareamento.json` e manda o token; passo de pareamento no manual (CA4) |
| `../../extensions/meet/manifest.json` | `"key"` fixa, para o ID não depender da pasta (CA6) |
| `src/main/smoke.ts` | `settings['plugins']` (navegador) e `meet['server']` estendidos (CA7) |
| `test/navegador-server.test.ts`, `test/meet-server.test.ts`, `test/plugins.test.ts` | casos novos (CA8) |

## Critérios de aceite
**Controle do navegador**
- **CA1 — Token por instalação.** `createNavegadorToken({ dir, safeStorage })` gera na primeira leitura 32 bytes de
  `randomBytes` em base64url (43 caracteres), grava `safeStorage.encryptString` em `userData/navegador-token.bin`
  (0600, gravação atômica) e devolve sempre o mesmo valor depois. Arquivo ilegível → gera outro (a extensão precisa
  ser salva de novo; logado só "token do navegador refeito"). Sem cifragem disponível → a ponte não sobe (`start()` devolve
  `null`, o mesmo caminho de "nenhuma porta livre"). O token nunca vai a log, IPC nem `settings.json` (N5).
- **CA2 — `Host`.** Pedido com `Host` diferente de `127.0.0.1:<porta em uso>` → 404 sem corpo (como hoje), antes de
  ler o corpo. `localhost:<porta>` e `Host` ausente também são recusados.
- **CA3 — Token no pedido.** Além de `x-lap-navegador: 1` e da regra de `Origin` atual, todo pedido traz
  `x-lap-navegador-token: <token>`, comparado com `timingSafeEqual` (tamanhos diferentes = errado). Cabeçalho
  ausente ou errado em método+caminho válidos → **401** sem corpo, sem marcar a extensão como conectada e sem entregar
  comando; qualquer outra coisa continua 404. Três 401 em 60 s põem `pareada: false` no `NavegadorState` (evento
  `scribe:navegador-changed`); um pedido aceito volta a `true`. O cartão mostra, com `pareada: false`,
  "A extensão não está pareada. Salve o plugin de novo e recarregue-a no Chrome." (`[data-navegador-unpaired]`).
- **CA4 — Pareamento pelo "Salvar plugin…".** Para o `navegador`, depois de copiar `plugin.arquivos`, `save.ts`
  grava `pareamento.json` = `{ "versao": 1, "token": "<token>" }` (0600, recusando link simbólico no lugar, como os
  outros arquivos). O `meet` não ganha o arquivo. A extensão lê `chrome.runtime.getURL('pareamento.json')` na subida;
  sem o arquivo, não faz pedido nenhum (nada de GET sem token). O README ganha o passo "salve de novo pelo app e
  recarregue a extensão" e diz que a pasta do repositório sozinha não pareia.

**Quem fala no Meet**
- **CA5 — Só a extensão LAP.** `acceptsRequest` exige `Origin === 'chrome-extension://' + MEET_EXTENSION_ID` (igualdade
  exata, não prefixo) e `Host === '127.0.0.1:<porta em uso>'`; o resto da regra (método, caminho, JSON, 64 KB) igual.
  Fora disso: 404 sem corpo e estado sem mudança.
- **CA6 — ID fixo.** `extensions/meet/manifest.json` ganha `"key"` (chave pública RSA em base64; a privada não entra
  no repo nem é necessária para carregar sem compactar). `MEET_EXTENSION_ID` é o ID que o Chrome deriva dela
  (sha256 da chave, 32 primeiros dígitos hex trocados para `a`–`p`).

**Smoke e testes**
- **CA7 — Smoke.** `navegadorPluginChecks`: o smoke salva o `navegador` com `fixtures.chosenFolder` e lê o token do
  `pareamento.json` gravado; GET com cabeçalho e sem token → 401 e cartão continua "Desconectado"; com o token e
  `Host` certo → "Conectado"; com o token e `Host: localhost:<porta>` → 404. `meet['server']`: `chrome-extension://abc`
  (o de hoje) → 404; `chrome-extension://${MEET_EXTENSION_ID}` → `{ ok: true }` e `connected`; o mesmo com `Host`
  errado → 404. `navegadorGet`/`meetPost` (`smoke.ts:2190-2200`) ganham `Host` e token como parâmetros.
- **CA8 — vitest.** `navegador-server.test.ts`: 401 sem token, 401 com token de outro tamanho, 404 com `Host` errado,
  `pareada` falso depois de três 401 e verdadeiro depois de um aceito, o token não aparece no `log` falso.
  `meet-server.test.ts`: o `EXTENSION` de teste (`chrome-extension://abcdefghijklmnop`) passa a ser recusado, o ID
  certo aceito, prefixo (`chrome-extension://<ID>x`) recusado, `Host` errado recusado; o `MEET_EXTENSION_ID` bate com
  o `"key"` do manifesto (calculado no teste). `plugins.test.ts`: salvar `navegador` grava `pareamento.json` 0600 com o
  token do falso; salvar `meet` não grava; link simbólico no lugar do `pareamento.json` é recusado.

## Invariantes
- Faixas de porta, caminhos, long-poll, prazos, limites de corpo, esquemas zod e as portas do smoke
  (`SMOKE_MEET_PORTS`, `SMOKE_NAVEGADOR_PORTS`) sem mudança.
- Os dois servidores seguem só em `127.0.0.1`; resposta do Meet segue `{ ok: true }` sem dado.
- `plugin.arquivos` (`src/shared/plugins.ts`) não lista `pareamento.json` (é gerado, não embutido);
  `scripts/pack.sh` sem diff.

## Fora de escopo
- Token no Meet (a spec pede só o ID). Botão "Gerar novo token". Publicar as extensões na Chrome Web Store. F1–F7.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- Casos novos nos três arquivos de teste; `settings['plugins']` e `meet['server']` estendidos.
- `git diff --stat` só com a Superfície. Sem commit.

## Dúvidas para o coordenador
1. **O ID do Meet hoje não é fixo.** O manifesto não tem `"key"`; extensão sem compactar ganha ID derivado do caminho
   da pasta, diferente em cada Mac. Sem o CA6 a allowlist de R4 é inviável. Com ele, **o Meet também muda o uso uma
   vez**: a extensão salva antes ganha outro ID e precisa ser salva e carregada de novo. A D3 só fala do navegador.
2. **Pareamento por arquivo (CA4)** em vez de código digitado: não pede tela na extensão. Confirmar com a D3.
3. **Cartão do plugin (CA3)** ganha um texto novo: mudança de tela; mockup ou dispensa?
4. **401 em vez de 404** só para token errado (a verificação end-to-end da spec pede 401): revela que a porta é do app.
