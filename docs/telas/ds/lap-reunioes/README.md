# LAP Reuniões Design System (fonte no repositório)

Fonte do artefato "LAP Reuniões Design System" (link em `docs/telas/README.md`). Escala densa da feature `densidade` (20/11/2026).

**Fonte da verdade: o código.** As cores, os espaços e as alturas moram em `apps/desktop/src/renderer/src/design/tokens.css` (e a escala de texto, as alturas da barra lateral, `.label` e `.caps` em `design/base.css`); as medidas de cada componente, nos arquivos de `design/` e da barra lateral (`app/Sidebar*.tsx`). Esta pasta é a cópia legível para o design system e para os artboards. Se divergir, vale o código; regras de uso estão em `docs/specs/desktop-shell/design.md`.

## O que tem

| Caminho | O que é |
|---|---|
| `tokens.json` | Gerado por `apps/desktop/scripts/export-tokens.mjs` (`pnpm tokens:export` na raiz). Grupos: `cores.claro`, `cores.escuro`, `cores.comuns` (logo, QR), `fontes`, `espacos`, `raios`, `densidade` (`control-h` 32, `control-compact-h` 28, `row-h` 44, `row-compact-h` 32, `panel-head-h` 44, `page-x` 32, `page-top` 20), `barraLateral` (`side-row` 32, `side-subrow` 28, `side-indent` 28), `larguras`, `movimento`, `texto` (tamanho e entrelinha de cada passo) e `estilos` (`label`, `caps`). Não edite à mão: o teste `apps/desktop/test/export-tokens.test.ts` reprova o arquivo fora de dia. |
| `components/<Nome>/README.md` | Medidas densas (altura, padding, fonte) e variantes do componente, com o arquivo de código. |
| `components/<Nome>/preview.html` | Exemplo que abre sozinho no navegador, nos temas claro e escuro. As cores entram como variáveis CSS copiadas do `tokens.json` no topo do arquivo. |

Componentes: `ActionButton`, `BrandLogo`, `Button`, `EditableTitle`, `EmptyState`, `Field` (`TextField` e `Select`), `Icon`, `Label` (classe `.label`), `LapSymbol`, `Note`, `PageHeader`, `ScrollFade`, `Section`, `Segmented`, `SettingRow`, `Shortcut`, `SidebarItem` (linhas da barra lateral em pilha), `StickyNote`, `Switch`, `Tabs`, `TapeIllustration`.

## Como usar

- Num mockup ou artboard, cite as medidas daqui (ou do `tokens.json`) em vez de medir um print: botão e campo de 32, segmentado e botões compactos de 28, linha de lista de 44 (duas linhas de texto) ou 32 (uma), linha de configuração de 44 no mínimo, cabeçalho de painel de 44, rótulo de seção em 11/16 peso 500 caixa normal.
- Mudou um token em `tokens.css`: rode `pnpm tokens:export`, confira os `preview.html` afetados e republique o artefato do design system.
- Mudou a medida de um componente em `design/`: atualize o `README.md` dele aqui e o `preview.html`, e o `design.md` se a regra mudou.
