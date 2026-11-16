# Contrato 09 — Nome e logo do app escolhidos em Configurações
Feature: desktop-shell  ·  Wave: 9  ·  Depende de: 08 (aceito) e do ajuste de 15/11 20:20 (nome visível "LAP Reuniões", `identifySpeakers`, `scripts/pack.sh`)

## Pré-condições
- Contrato 08 aceito; `gates.sh` verde.
- Pedido do Andrew (15/11/2026 19:50): "em Configurações quero que possa colocar outro logo e outro nome"; confirmado às 20:40 ("ainda não estou vendo em Configurações onde muda a logo e o nome").
- Já feito fora de contrato: o nome visível fixo virou "LAP Reuniões" (`DISPLAY_NAME` em `src/main/index.ts`, `window.ts`, `index.html`, `Sidebar.tsx`, `noticeRules.ts`); `app.setName` ficou `Meeting Scribe` para manter `userData` e Chaveiro. Este contrato troca esses textos fixos pelo nome das configurações (padrão "LAP Reuniões").
- Hoje a marca é fixa: `Sidebar.tsx` mostra `<LapSymbol>` + "LAP Reuniões" + "LAP Software"; título da janela e `index.html` "LAP Reuniões"; `noticeRules.ts` cita "o LAP Reuniões".
- Nome padrão novo: **"LAP Reuniões"** (decisão do Andrew em 15/11/2026). Logo padrão: o símbolo da LAP de hoje.
- Limite do macOS: o nome no Dock, no menu do app e na pasta Aplicativos vem do pacote instalado e não muda com o app aberto. O nome escolhido aqui vale **dentro** do app (barra lateral, título da janela, avisos, painel "Sobre"). O ícone do Dock pode mudar com o app aberto (`app.dock.setIcon`).

## Superfície
- `src/shared/settings-defaults.ts`, `src/main/settings/schema.ts` (+ testes).
- `src/main/` — novo `branding/` (escolher a imagem com diálogo nativo, copiar para `userData/branding/`, servir ao renderer, ícone do Dock, painel "Sobre").
- `src/shared/ipc.ts`, preload.
- `features/settings/` — bloco novo "Marca"; `app/Sidebar.tsx`; `main/window.ts`; `renderer/index.html`; `features/live/noticeRules.ts`.
- `src/main/smoke.ts` + fixtures.

## Critérios de aceite
- CA1: `AppSettings` ganha `brandName: string | null` (padrão `null` = "LAP Reuniões"; aparado, 1 a 40 caracteres, sem quebra de linha; inválido volta ao padrão) e `brandSubtitle: string | null` (padrão `null` = "LAP Software"; 0 a 40 caracteres; texto vazio = sem subtítulo). O logo **não** fica no patch geral do renderer: só muda pelo diálogo do main (CA3). `settings.json` antigo carrega com os padrões. Testes.
- CA2: Configurações ganha o bloco "Marca" (primeiro bloco da tela) com: campo "Nome do app" (placeholder "LAP Reuniões"), campo "Subtítulo" (placeholder "LAP Software"), linha "Logo" com a miniatura atual (28 px, como na barra), botão "Escolher imagem…" e botão "Usar o logo da LAP" (só aparece com logo próprio). Ajuda: "Aparece na barra lateral, no título da janela e no ícone do Dock. O nome no Finder e na pasta Aplicativos não muda." Salvar no mesmo padrão dos outros campos de texto da tela (ao sair do campo / Enter). Segue `design.md` e os componentes base. Smoke: `configuracoes-marca-light.png` e `-dark.png`.
- CA3: "Escolher imagem…" abre `dialog.showOpenDialog` no main (`openFile`, filtros `png`, `jpg`, `jpeg`). O main confere: arquivo comum, até 2 MB, e que o `nativeImage.createFromPath` não vem vazio; copia para `userData/branding/logo-<hash curto>.png` (convertido com `nativeImage.toPNG()`, redimensionado para no máximo 512 px no lado maior), apaga o logo anterior e grava só o **nome** do arquivo nas configurações (`brandLogo: string | null`, conferido contra `^logo-[a-f0-9]{8,64}\.png$`). Inválido: mensagem "Não deu para usar esta imagem. Use PNG ou JPG de até 2 MB." e nada muda. SVG fica fora (pode carregar script). "Usar o logo da LAP" apaga o arquivo e volta `brandLogo` a `null`. Testes do main com pasta temporária.
- CA4: o renderer recebe o logo como data URL PNG por IPC (`branding:get` → `{ name, subtitle, logoDataUrl | null }`), nunca um caminho; a CSP do app passa a aceitar `img-src data:` se ainda não aceitar, e só isso. A barra lateral mostra o logo próprio (`<img>` 28×28, `object-contain`, raio de 4 px) ou o `<LapSymbol>`, o nome e o subtítulo (some se vazio). Mudou nas Configurações → a barra atualiza na hora, sem reiniciar.
- CA5: título da janela e `document.title` = nome da marca; `noticeRules.ts` usa o nome da marca no aviso do microfone ("O microfone está bloqueado para o <nome>…"); painel "Sobre" (`aboutPanelOptions`) usa o nome. `app.setName` continua com o nome fixo do pacote (não muda o `userData`: reuniões, configurações e chave continuam no mesmo lugar). Teste de que o caminho do `userData` não depende do nome escolhido.
- CA6: ícone do Dock: com logo próprio, `app.dock.setIcon(nativeImage)` ao abrir o app e ao trocar; voltando ao padrão, restaura o ícone do pacote (`resources/brand/icon.png`). Fora do macOS, nada.
- CA7: smoke: escolhe um logo de fixture (diálogo substituto), troca nome e subtítulo, confere a barra lateral (texto e `<img>` com data URL), o título da janela, tira `barra-marca-propria-light.png`, volta ao padrão e confere de novo. `externalRequests: []`.

## Invariantes
- Contratos 01 a 08 continuam passando. Sem nome escolhido, o app mostra "LAP Reuniões" e o símbolo da LAP.
- Nenhum caminho de arquivo chega ao renderer; o renderer não escolhe onde o main lê ou escreve.
- `prova/` e `docs/` não mudam (exceto este contrato, pelo coordenador).

## Fora de escopo
- Trocar cores/tema pela marca, nome no Finder/Dock/menu (vem do empacotamento), SVG, mais de um logo, logo nos arquivos `.md` da pasta.

## Gates
- `apps/desktop/scripts/gates.sh` (smoke com `--no-sandbox`).
- Testes novos: CA1, CA3 a CA6.

## Telas de impacto no usuário
- Configurações: bloco "Marca" com nome, subtítulo e logo.
- Barra lateral, título da janela, ícone do Dock e aviso do microfone com a marca escolhida.

## Notas do coordenador
- Nada de commit. Depois deste contrato: nome do pacote "LAP Reuniões" e empacotamento para instalar.
