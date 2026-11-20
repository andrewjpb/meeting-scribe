# Contrato 84 — Email em moldura isolada
Feature: arquitetura-seguranca · Wave: 1 · Depende de: mockup aprovado · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa S1 do plan (R1, decisão T1). Hoje o HTML do email, já sanitizado por `sanitizeEmailHtml`, entra no DOM
da janela que tem o preload: `HtmlBody` em `src/renderer/src/features/email/ReadingPane.tsx:433` usa
`dangerouslySetInnerHTML`. Uma falha do sanitizador dá ao email o `window.__scribeApi`. Este contrato põe o corpo
HTML num `iframe` `srcdoc` com `sandbox` sem `allow-scripts` e sem `allow-same-origin` (origem opaca, sem preload,
sem script) e CSP própria. O sanitizador continua como primeira barreira (F3). O corpo em texto puro (`TextBody`)
não muda: são nós de texto do React, não HTML.

## Pré-condições
- **Mockup da leitura de email com a moldura aprovado pelo Andrew. Ainda NÃO existe.** Sem ele este contrato não
  começa (checklist, passo 3). O mockup decide a altura (ver CA5) e mostra: email curto, email longo, cartão de
  convite acima do corpo, aviso "imagens bloqueadas", tema escuro, foco por Tab entrando e saindo da moldura.
- Main em dia (`git log --oneline -3`), gates verdes antes da primeira linha.
- Ler antes: `ReadingPane.tsx` (`HtmlBody`, `openLink`, `MessageBody`), `sanitize.ts` (cabeçalho e `safeLinkUrl`),
  `src/main/security.ts` (`buildCsp`, `guardWebContents`), `src/main/protocol.ts:63-80` (CSP servida),
  `src/renderer/src/design/base.css:354-420` (`.email-body`), `src/main/smoke.ts:9236-9300` (passo `email['reading']`)
  e `src/main/email/fake-email.ts:50-64` (o email hostil do smoke).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/renderer/src/features/email/emailFrame.ts` | **novo**, puro: `buildEmailFrameDoc(cleanHtml)` monta o documento do `srcdoc` (CA2) |
| `src/renderer/src/design/email-frame.css` | **novo**: as regras de `.email-body` reescritas para dentro da moldura, claro e escuro (CA3) |
| `src/renderer/src/features/email/ReadingPane.tsx` | `HtmlBody` troca o `div` pelo `iframe`; o clique em link chega pelo main (CA1, CA4, CA6) |
| `src/renderer/src/features/email/sanitize.ts` | só o que o mecanismo do link exigir (ex.: `target="_blank" rel="noopener noreferrer"` no `<a>`) (CA4) |
| `src/main/security.ts` | `buildCsp` com o que a moldura precisa e nada mais (CA3); decisão pura do link da moldura, testável (CA4) |
| `src/main/index.ts` / `src/main/window.ts` | ligação do link da moldura ao webContents da janela (CA4) |
| `src/shared/ipc.ts` | evento de main `scribe:email-frame-link` (`{ url: string }`) nos lugares de sempre (CA4) |
| `scripts/gates.sh` | passo 6 exclui `email-frame.css` (literais de cor), coberto pelo teste do CA8 |
| `src/main/smoke.ts` | `email['reading']` passa a ler dentro da moldura; passo novo `email['readingIsolated']` (CA7) |
| `src/main/email/fake-email.ts` | um email hostil a mais (CA7) |
| `test/renderer/email-frame.test.ts` | **novo** (CA8) |
| `test/security.test.ts` | casos da CSP e da decisão do link (CA8) |

Nada no preload, em `main/email/service.ts`, no cartão de convite (`InviteCard.tsx`) nem no `TextBody`.

## Critérios de aceite
**Moldura**
- **CA1 — O HTML do email nunca entra no DOM da janela.** Com `state.html`, `HtmlBody` renderiza um único
  `<iframe data-email-body="html" title="Corpo do email" sandbox="…" srcdoc="…">`. O atributo `sandbox` contém **no
  máximo** o token exigido pelo mecanismo do CA4 (`""` ou `"allow-popups"`) e nunca `allow-scripts`,
  `allow-same-origin`, `allow-top-navigation*`, `allow-forms`, `allow-modals` nem `allow-popups-to-escape-sandbox`.
  `grep -n "dangerouslySetInnerHTML" src/renderer/src/features/email/` volta vazio. No DOM da janela,
  `document.querySelectorAll('[data-email-reading] p, [data-email-reading] a[data-email-link]')` não acha nenhum nó
  vindo do email HTML.
- **CA2 — Documento da moldura (`buildEmailFrameDoc`).** Devolve `<!doctype html><html><head>` + `<meta charset="utf-8">`
  + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src <só a folha do CA3>">`
  + a folha do CA3 + `</head><body class="email-body">` + o HTML já sanitizado + `</body></html>`. Nada do email fica
  antes do `<body>`. A entrada é sempre a saída de `sanitizeEmailHtml` (a ordem sanitizar → montar não muda).
- **CA3 — Estilo e tema.** Dentro da moldura o email tem a mesma aparência de hoje (fonte 15/24, margens, listas, links
  em `--accent`, citação, `pre`, tabela, `img { max-width: 100% }`) nos dois temas. As regras vêm de
  `design/email-frame.css`, com claro por padrão e escuro em `@media (prefers-color-scheme: dark)`; o tema chega pela
  `color-scheme` que `[data-theme]` já põe na raiz (`tokens.css:9,75`), sem script. Como o `srcdoc` herda a CSP da
  janela (`style-src 'self'`, sem `'unsafe-inline'`), a folha entra por `<link>` para o arquivo servido por
  `scribe://app` (import `?url` do Vite) **ou** por `<style>` com o `sha256` dela acrescentado ao `style-src` de
  `buildCsp`; nenhuma das duas abre `'unsafe-inline'`. `buildCsp('production')` não ganha `script-src` novo,
  `frame-src` com esquema remoto, nem `'unsafe-*'`.
- **CA4 — Links e `mailto:` continuam.** Clicar num `<a data-email-link>` dentro da moldura chama o `openLink` da tela
  com o `href` exato: `https:` mostra a confirmação `[data-notice="email-external-link"]` e "Abrir" manda
  `scribe:open-link`; `http:` mostra o aviso de link inseguro; `mailto:` abre o composer com o endereço. O frame não
  navega e nenhuma janela abre. O main só repassa ao renderer (`scribe:email-frame-link`) URL `http:`, `https:` ou
  `mailto:` de até 2048 caracteres vinda de um subframe de origem opaca da janela principal; qualquer outro esquema
  (`javascript:`, `data:`, `file:`, `scribe:`) é descartado sem evento. A decisão é função pura em `security.ts`.
- **CA5 — Altura.** Conforme o mockup aprovado: (a) a moldura ocupa o resto de `[data-email-reading-scroll]` com
  rolagem própria, ou (b) outra solução que **não** ponha o HTML do email no DOM da janela nem dê script à moldura.
  "Medir num render oculto" no DOM da janela está fora (viola R1). Em qualquer caso: email de 1 parágrafo não deixa
  área em branco maior que a do mockup; email longo rola até o fim e os anexos (`[data-email-attachments]`) ficam
  visíveis abaixo ou acessíveis pela rolagem.
- **CA6 — Imagens remotas só depois do botão.** Sem clique, a moldura não tem `<img>` remota e o aviso
  `[data-notice="email-images-blocked"]` continua fora dela, na janela. Depois de "Carregar imagens", o `srcdoc` é
  remontado com as data URLs (o `img-src data:` do CA2 é o único que carrega); nenhum pedido de rede sai da moldura
  (a CSP `default-src 'none'` barra até CSS externo).

**Ataque e regressão no smoke**
- **CA7 — Smoke.** Os passos leem dentro da moldura pelo main (`webFrameMain` do subframe ou CDP
  `DOM.getDocument({ depth: -1, pierce: true })`), nunca pelo `innerHTML` da janela:
  1. `email['reading']` (o de hoje, `smoke.ts:9236`) continua com os mesmos critérios (`dangerous` falso,
     `__emailXss` ausente, imagem bloqueada e depois `data:image/png`, link pela confirmação, `openedUrls` com
     `https://portal.cliente.example/proposta`), agora lidos na moldura; o clique no link é de verdade
     (`sendInputEvent` na posição do link), não `el.click()` no DOM da janela.
  2. **`email['readingIsolated']`, novo**: um email do `fake-email.ts` com `<img src=x onerror="window.parent.__emailXss=1">`,
     `<script>`, `<form>`, `<link rel=stylesheet href="https://cliente.example/x.css">`, `<a href="javascript:…">` e
     `<a href="mailto:ana@cliente.example">`. Passa se: `window.__emailXss` ausente na janela; nenhum nó do email no
     DOM da janela; a moldura tem `sandbox` do CA1 e `<meta http-equiv="Content-Security-Policy">` do CA2;
     `fake.imageRequests` e qualquer pedido de rede do subframe ficam em zero; o `javascript:` não gera
     `scribe:email-frame-link`; o `mailto:` abre o composer com `ana@cliente.example`; nenhuma violação de CSP da
     janela (`scribe:csp-violation`) além das da própria moldura; print `email-leitura-moldura-light` e `-dark`.
  3. Os outros pontos que leem `[data-email-body]` (`smoke.ts:9218, 9714, 10624, 11064`) continuam passando.

**Testes**
- **CA8 — vitest.** `test/renderer/email-frame.test.ts`: `buildEmailFrameDoc` põe a CSP do CA2 antes de qualquer
  conteúdo; HTML com `</head><meta http-equiv=refresh>` já sanitizado não sai do `body`; o documento nunca contém
  `<script`; e as cores de `email-frame.css` são as mesmas de `--text`, `--text-muted`, `--accent`, `--line`,
  `--line-strong` em `tokens.css` nos dois temas (lidas dos dois arquivos). `test/security.test.ts`: a decisão do
  link aceita `https://a.example/x`, `http://a.example/x`, `mailto:a@b.example` e recusa `javascript:alert(1)`,
  `data:text/html,x`, `file:///etc/passwd`, `scribe://app/index.html` e URL com 2049 caracteres; `buildCsp('production')`
  não contém `unsafe-inline` nem `unsafe-eval`.

## Invariantes
- `test/renderer/email-sanitize.test.ts` verde **sem alteração** além do que o CA4 exigir no `<a>`; a lista de
  permitidos do sanitizador não cresce.
- Cartão de convite (`InviteCard`, `ReadingPane.tsx:268`), "Sugerir evento", anexos, cabeçalho e ações continuam no
  DOM da janela, iguais; os passos `convite-*` do smoke sem mudança de critério.
- `TextBody` (`ReadingPane.tsx:438`) sem diff.
- O preload continua rodando só no frame principal: nenhuma `webPreferences` com `nodeIntegrationInSubFrames`;
  `isTrustedSender` (`src/main/ipc.ts:36`) segue recusando `about:srcdoc`.
- `scribe:open-link` continua aceitando só `https:` (`index.ts:2320`); a confirmação continua na tela.

## Fora de escopo
- Trocar o sanitizador por DOMPurify (F3). Texto puro em moldura. Confirmação de link pelo main (contrato 87).
- Imprimir email, buscar texto dentro do corpo, zoom próprio da moldura.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde.
- Testes novos: `test/renderer/email-frame.test.ts` e os casos novos de `test/security.test.ts`; passo de smoke
  `email['readingIsolated']` e `email['reading']` atualizado.
- `git diff --stat` só com os arquivos da Superfície. Sem commit (agente de commits).

## Decisões deste contrato
- **E1 — Mecanismo do link (CA4).** Dois caminhos, a decidir num teste rápido no Electron 45 antes de escrever a tela:
  (1) `sandbox="allow-popups"` + `target="_blank"` no `<a>` + o `setWindowOpenHandler` de `guardWebContents`
  repassando a URL (e negando a janela); (2) `sandbox=""` + `will-frame-navigate` no webContents com
  `preventDefault`. Recomendado (1) se o (2) for barrado antes pelo `frame-src` herdado da CSP.

## Dúvidas para o coordenador
1. **T1 diz `sandbox=""`; o link pode exigir `allow-popups`** (E1). `allow-popups` não dá script nem origem; confirmar
   que é aceitável se o caminho (2) não funcionar.
2. **CSP herdada pelo `srcdoc`.** O `style-src 'self'` da janela vale dentro da moldura; por isso o CA3. Se o Chromium
   não casar `'self'` para a origem opaca, sobra o hash no `buildCsp`. Nenhum dos dois está na spec.
3. **Gate 6 (cor literal só em `tokens.css`).** A moldura não enxerga as variáveis da janela; `email-frame.css` precisa
   de literais. Proposta: excluir só esse arquivo do passo 6 e travar a igualdade com `tokens.css` no teste do CA8.
4. **Altura (CA5).** A alternativa "medir num render oculto" do T1 põe o HTML no DOM da janela; só sobra rolagem
   própria, salvo outra ideia no mockup.
5. **Atalhos com foco na moldura.** Tecla pressionada dentro da moldura não chega à janela (origem diferente); conferir
   no mockup se algum atalho do email precisa funcionar ali.
