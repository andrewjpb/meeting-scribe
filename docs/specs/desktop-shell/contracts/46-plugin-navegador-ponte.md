# Contrato 46 — Plugin de controle do navegador: extensão + ponte + Configurações

Parte 1 de 2 da implementação `plugin-navegador` (branch `plugin-navegador`, worktree própria — NÃO mexe na main). O Contrato 47 (ferramentas do agente via MCP) vem depois e NÃO faz parte deste contrato.

## Objetivo

Uma extensão Chrome própria do app ("LAP Reuniões — Controle do navegador") que executa comandos vindos do app numa **janela própria do Chrome**, sem atrapalhar o usuário, mais o cadastro dela como plugin na aba Configurações › Plugins. Neste contrato o único consumidor da ponte é o teste; o agente ainda não a usa.

## Arquitetura da ponte (decidida — não mudar)

HTTP 1 para 1 em 127.0.0.1, no molde de `apps/desktop/src/main/meet/server.ts`, mas bidirecional por long-poll (o repo não tem `ws` e não vamos adicionar):

- Extensão faz `GET http://127.0.0.1:<porta>/v1/navegador/comandos` (long-poll: o app segura até 25 s; responde `{ comando: {...} }` ou `{}` no timeout).
- Extensão executa e faz `POST /v1/navegador/resultados` com `{ id, ok, dados?, erro? }`.
- Portas `NAVEGADOR_PORTS = 47672..47681` (constante exportada; a extensão tenta em ordem e lembra a última boa, como o `background.js` do Meet). Smoke usa `SMOKE_NAVEGADOR_PORTS` (47692..47701) para o Chrome real nunca falar com ele.
- Mesmas defesas do servidor Meet: só 127.0.0.1, só caminhos conhecidos, `Origin` começando com `chrome-extension://`, zod `.strict()` em toda fronteira, 404 sem corpo para o resto. Limite de corpo: 512 KB (resultado carrega texto de página). "Conectado" = algum GET/POST há menos de 35 s.
- Fila de 1 comando por vez: `enviarComando(comando)` devolve Promise que resolve com o resultado ou rejeita por timeout (30 s) ou desconexão. Comando novo com um pendente → rejeita o novo ("ponte ocupada").

## Comandos v1 (tipos em `shared/navegador.ts`, zod discriminado por `tipo`)

A ponte é **multiabas**: o agente abre quantas abas precisar na janela própria e trabalha entre elas. Cada aba ganha um número sequencial `aba` (1, 2, 3…), estável até ser fechada.

| tipo | args | devolve |
|---|---|---|
| `abrir` | `url` (só http/https) | `{ aba, titulo, url }` — sempre abre aba NOVA na janela própria; a primeira chamada cria a janela |
| `abas` | — | `{ abas: [{aba, titulo, url, ativa}] }` |
| `ler` | `aba?` | `{ aba, titulo, url, texto, elementos: [{ref, rotulo, papel}] }` (texto truncado em 40 KB) |
| `clicar` | `ref, aba?` | `{ ok }` + `{ aba, titulo, url }` após o clique |
| `digitar` | `ref, texto, aba?` | `{ ok }` — **recusa** `type=password` |
| `aguardar` | `segundos` (1..10) | `{ ok }` |
| `fechar` | `aba?` | `{ ok }` — fecha a aba; sem `aba`, fecha a janela própria inteira |

`aba` omitida = a última aba usada (a "ativa"). `aba` inexistente → erro claro "aba não existe". Limite: 10 abas abertas ao mesmo tempo (constante exportada; `abrir` acima disso → erro "muitas abas").

## Extensão (`extensions/navegador/`)

`manifest.json` (MV3), `background.js`, `README.md` — sem content script fixo; injeção por `chrome.scripting.executeScript` na hora do comando. Convenções do `extensions/meet/`: cabeçalho citando o contrato, comentários e campos em pt-BR.

- `permissions: ["tabs", "scripting"]`, `host_permissions: ["<all_urls>", "http://127.0.0.1/*"]`.
- A extensão age **somente** na janela que ela mesma criou (`chrome.windows.create` no primeiro `abrir`). Guarda `windowId` e um mapa `aba → tabId`; comando com a janela fechada → erro "janela fechada". Nunca toca aba do usuário.
- Aba que uma página abrir sozinha (link `_blank`) DENTRO da janela própria é adotada no mapa com o próximo número (`chrome.tabs.onCreated` com `openerTabId` da janela própria). Aba fechada à mão pelo usuário sai do mapa (`chrome.tabs.onRemoved`).
- `ler` injeta função que coleta título, texto visível (truncado) e elementos interativos (`a`, `button`, `input`, `select`, `textarea`, `[role=button]`) com `ref` sequencial guardado em `window.__lapRefs`; `clicar`/`digitar` resolvem o `ref` por esse registro (refs morrem a cada `ler`/navegação — erro claro "ref vencida, leia a página de novo").
- `digitar` define `value` + dispara `input`/`change`; recusa campo de senha.
- Conteúdo de página é DADO: a extensão nunca interpreta texto da página como comando; só o app (via zod) decide o que executar.

## Lado do app

- `src/main/navegador/server.ts`: `createNavegadorServer({ ports?, connectedMs?, log? })` → `{ port, connected, enviarComando, close }`, espelhando o contrato de uso do `createMeetServer`.
- Liga/desliga por configuração nova `navegadorPlugin` (boolean, padrão **desligado**), no mesmo ponto em que `meetSpeakers` sobe o servidor do Meet (`src/main/index.ts:533` e região).
- IPC (seguir os 4 lugares de `shared/ipc.ts` + `WHEN_LOCKED: 'refused'`):
  - `scribe:navegador-status` (invoke) → `{ ativo, conectado }`;
  - `scribe:navegador-changed` (push) com o mesmo estado;
  - `scribe:navegador-set` (invoke) → liga/desliga a configuração.

## Plugin em Configurações (aba Plugins existente — NÃO criar aba)

- `shared/plugins.ts`: entrada nova em `APP_PLUGINS` — `id: 'navegador'`, nome "Controle do navegador", descrição curta (o agente usa uma janela própria do Chrome; não mexe nas suas abas). `AppPluginId` vira união.
- `pluginSourceDir` (`src/main/index.ts:637`): `navegador` → `navegador-extension` (empacotado) / `navegador` (dev).
- `pack.sh:39-43` e `pack-linux.sh:35`: copiar `extensions/navegador/` para `$STAGE/resources/navegador-extension/`.
- `PluginsSection.tsx`: card novo com estado Conectado/Desconectado (store novo `features/live/navegadorStore.ts` no molde do `meetStore`, alimentado por `scribe:navegador-changed`; estender `usePluginConnected`), toggle "Ativar ponte" (chama `scribe:navegador-set`), botão "Salvar plugin…" (`scribe:plugin-save` já aceita o id novo via `APP_PLUGIN_IDS`) e manual de instalação **por plugin** (o `InstallManual` hoje é fixo do Meet — parametrizar: passos de instalar extensão sem loja: chrome://extensions → modo desenvolvedor → "Carregar sem compactação" → pasta salva).
- `shared/settings-index.ts:91-95` indexa sozinho via `APP_PLUGINS` — conferir que o card novo entra na busca; linha nova do toggle entra com `row(...)`.
- `resources/assistente/guia-do-app.md`, seção `<!-- aba: plugins -->`: parágrafo do plugin novo.

## Testes e gates

- `test/navegador-server.test.ts` no molde do `meet-server.test.ts`: long-poll entrega comando, resultado resolve a Promise, timeout, ponte ocupada, recusa de origem/caminho/corpo grande, porta ocupada pula para a próxima, canais novos em `INVOKE_CHANNELS`/`MAIN_EVENT_CHANNELS`/`WHEN_LOCKED`.
- `test/plugins.test.ts`: lista de ids vira `['meet','navegador']`; salvar copia a pasta real `extensions/navegador`.
- Smoke (`src/main/smoke.ts`): estender `pluginsSettings()` (linha ~1928) — card do navegador aparece, `data-plugin-state`, toggle liga (com `SMOKE_NAVEGADOR_PORTS`), cliente HTTP falso fazendo o papel da extensão (como `meetPost`) para o estado virar Conectado; shot `configuracoes-plugins-light` continua passando.
- Rodar: `pnpm -C apps/desktop typecheck:node && pnpm -C apps/desktop exec vitest run test/navegador-server.test.ts test/plugins.test.ts test/renderer/settings-tabs.test.ts && pnpm -C apps/desktop lint`. NÃO rodar a suíte inteira nem o smoke completo (memória curta na máquina) — smoke só o check de plugins se houver alvo (`pnpm -C apps/desktop smoke -- --only pluginsSettings`, se o runner aceitar; senão deixar para a revisão).

## Fora de escopo

Ferramentas do agente, MCP, `StepTool`, screenshot, `chrome.debugger` (nada de banner de depuração), aba nova de Configurações.

## Critério de pronto

Gates verdes; extensão instalável à mão funciona de ponta a ponta com um teste manual simples (toggle ligado + extensão carregada → card "Conectado"). Sem commit — quem coordena commita.
