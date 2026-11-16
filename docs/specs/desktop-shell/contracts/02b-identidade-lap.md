# Contrato 02b — Identidade visual da LAP
Feature: desktop-shell  ·  Wave: entre a 2 e a 3  ·  Depende de: 02

## Pré-condições
- Contratos 01 e 02 aceitos.
- O coordenador já trocou `docs/specs/desktop-shell/design.md` pela versão 2 (identidade LAP). Com isso o teste de contraste dos tokens passa a falhar: é o ponto de partida esperado desta tarefa.
- Logos originais em `docs/specs/desktop-shell/brand/` (`logo-lap.svg`, `logo-lap-simbolo.svg` e os PNGs).
- O Andrew aprovou o visual em 14/11/2026 a partir de seis telas desenhadas. O código-fonte delas está em `docs/specs/desktop-shell/mockups/*.dc.html` (HTML com estilos em linha: `Main` = gravação ao vivo, `Reunioes`, `ReunioesVazia`, `Detalhe`, `Configuracoes`, `AoVivoEscuro` = tema escuro com aviso). São a referência de medidas, cores e composição: em caso de dúvida entre `design.md` e um mockup, vale o mockup, e a diferença vai para o relatório. Ignore neles o que é do formato do arquivo (`<x-dc>`, `sc-for`, `support.js`) e as telas ou controles que ainda não existem no app (configurações completas, chave, seletor de modelo, "Copiar transcrição", bloco de permissões com estados reais).

## Superfície
- `apps/desktop/src/renderer/src/design/` (`tokens.css`, `base.css`, componentes base, novo componente do símbolo da LAP), `src/renderer/src/app/Sidebar*`, telas em `src/renderer/src/features/**` só no que for visual.
- `apps/desktop/src/main/window.ts`, `src/main/index.ts`, `src/main/menu.ts` (nome, Sobre, ícone do Dock, remoção de `vibrancy`), `src/main/smoke.ts`.
- `apps/desktop/resources/brand/` (cópia dos logos, `icon.png` 1024 e `icon.icns`), `apps/desktop/package.json` (remoção das fontes embutidas), `apps/desktop/scripts/gates.sh`, testes que afirmam constantes visuais.

## Critérios de aceite
- CA1: Dado `tokens.css`, então define todas as variáveis da tabela de `design.md` v2 nos dois temas, e o teste de contraste (lendo a tabela e os pares de `design.md`) passa.
- CA2: Dado `apps/desktop/package.json` e o código do renderer, então não há dependência `@fontsource*` nem as palavras `Newsreader` ou `JetBrains`; a família é `"Helvetica Neue", Helvetica, Arial, sans-serif`; ids de modelo usam `Menlo, ui-monospace, monospace`.
- CA3: Dado `gates.sh`, então há um passo novo que falha se existir, em `apps/desktop/src/renderer/src`, `box-shadow` (fora de `none`), raio acima de 6 px ou classe de pílula (`rounded-full`, `9999`, `999px`). O passo passa.
- CA4: Dada a barra lateral, então é opaca em `--side-bg` nos dois temas, com o bloco da marca de `design.md` (símbolo para fundo azul em SVG, "Meeting Scribe", "LAP SOFTWARE"), navegação em `--side-muted` e item ativo em `--side-active`. `vibrancy` não é mais definido na janela, e o parâmetro `surface=opaque` e a variável `--sidebar-fallback` do smoke foram removidos.
- CA5: Dado o componente do símbolo, então reproduz a geometria de `brand/logo-lap-simbolo.svg` (viewBox 100, "L" `M 20 25 L 20 75 L 55 75` com traço 8 e pontas quadradas, quadrado 22×22 em 62,58) nas cores para fundo azul de `design.md`.
- CA6: Dado o app, então `app.getName()` é "Meeting Scribe", o título da janela é "Meeting Scribe", o painel Sobre mostra "© 2026 LAP Software & Consultoria", e em desenvolvimento o ícone do Dock é `resources/brand/icon.png` (símbolo original com margem de 10%). `resources/brand/icon.icns` existe e abre (`sips -g pixelWidth` devolve 1024 no maior tamanho ou `iconutil` o converte sem erro).
- CA7: Dadas as telas existentes, então: botão primário em `--accent` com texto `--on-accent`; títulos em `--title` com peso 700; indicador de gravação quadrado de 8 px; fita com barras de 3 px e pontas retas; barra de controles como bloco `--side-bg` de raio 6 sem sombra, com o quadrado `--rec` antes de "Encerrar"; avisos no formato de nota (barra de 3 px à esquerda); grupos de dia e seções conforme `design.md`.
- CA8: Dado o smoke, então todas as telas já existentes são geradas de novo nos dois temas, com `consoleErrors: []`, `cspViolations: []` e `externalRequests: []`.
- CA9: Dado `gates.sh`, então termina com código 0, e nenhum teste de comportamento (captura, relógio, detector, store, segurança) foi alterado; só mudaram testes que afirmam constantes visuais, e o relatório lista quais.
- CA10: O implementador abriu todos os PNGs, comparou com `design.md` v2 e com os logos originais, e listou no relatório os defeitos visuais encontrados e corrigidos. O resultado tem que parecer um produto da LAP: quem conhece as propostas da LAP reconhece a marca na primeira tela.
- CA11 (única mudança de comportamento permitida, pendência da revisão do contrato 02): Dada uma falha na leitura inicial do detalhe de uma reunião, então a tela mostra o aviso em linha com "Tentar de novo" em vez de ficar em branco. Teste unitário ou de smoke cobre o caso.

## Invariantes
- Nenhuma mudança de comportamento além do CA11: mesmas rotas, mesmos canais IPC, mesma captura, mesmos textos de ação.
- `prova/` e `docs/` não mudam.

## Fora de escopo desta tarefa
- Empacotamento, assinatura e notarização (o `.icns` fica pronto, mas não é usado para empacotar). Telas novas. Qualquer funcionalidade.

## Gates
- `apps/desktop/scripts/gates.sh` com o passo novo de CA3.
