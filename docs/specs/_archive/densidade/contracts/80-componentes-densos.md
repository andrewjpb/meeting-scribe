# Contrato 80 — Componentes e tokens densos

Feature `densidade` · Wave 1 · Depende de: nada · Spec `../spec.md` (tabela "A escala densa", CA1, CA2 parte, CA4) · Plan `../plan.md`. **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-densidade` (branch `densidade`, base 3b973e7).

Roda em paralelo com o contrato 79 (barra lateral). **Fronteira:** o 79 mexe em `app/Sidebar.tsx`, `app/SidebarStack.tsx`, `features/email/EmailNav.tsx`, `features/chat/ChatHistory.tsx`, `app/LockButton.tsx`, `app/PermissionsBlock.tsx`, no bloco "Barra lateral em pilha" do design.md e nos checks de barra do smoke (`rootItems`, `settings*` de altura, `assistant*` de altura, `emailFits`, `levelFits`). Você NÃO toca nesses arquivos nem nesses checks; no `design/base.css` e no `design.md` edite só os trechos listados abaixo (o 79 edita outros trechos dos mesmos arquivos; mantenha as edições pequenas e localizadas para a junção ser limpa). Nas telas (`features/*`) você não mexe: são dos contratos 81 e 82. Se um componente denso quebrar o layout de uma tela de forma grosseira (texto cortado, sobreposição), anote no relatório em vez de corrigir a tela.

## Superfície
### `design/tokens.css`
Novos tokens: `--control-h: 32px`, `--control-compact-h: 28px`, `--row-h: 44px`, `--row-compact-h: 32px`, `--panel-head-h: 44px`, `--page-x: 32px`, `--page-top: 20px`. Mantidos: espaços, raios, larguras.

### `design/base.css`
- Nova classe utilitária `.label` (11px/16px, peso 500, `color: var(--muted)` ou o token muted da superfície: dentro da barra lateral o 79 usa a cor da barra), sem `text-transform`, sem `letter-spacing`.
- `.caps` continua existindo só para fita/marca (`TapeIllustration`, `LevelTape`, `TranscriptList` rótulo de fonte, `Sidebar` "LAP SOFTWARE" fica com o 79). Comentário no CSS dizendo isso.
- Escalas de texto inalteradas (os pares existentes bastam).

### `design/` componentes (medidas da tabela da spec)
- `Button.tsx`: `h-8` (32), `px-3`, 13/500, gap 8; variantes mantidas; opcional `size="lg"` NÃO (um tamanho só, como hoje).
- `Field.tsx`: `TextField` e `Select` `h-8`, `px-2.5`; larguras mínimas mantidas.
- `Tabs.tsx`: `h-8`, gap 20, sublinhado igual.
- `Segmented.tsx`: `h-7` (28), `px-3`.
- `Switch.tsx`: 36×20, botão 14, `p-[3px]`.
- `Note.tsx`: `px-3 py-2`, gap 10, barra lateral mantida.
- `SettingRow.tsx`: `min-h-11` (44), `py-2`, colunas `1fr / var(--settings-control-width)`, `gap-x-5`, nome 13/500, descrição 12, gap 1.
- `Section.tsx`: título com `.label` e `mb-1`; descrição 12 `mt-0.5`; caixa `mt-2`; filhos `px-3`.
- `PageHeader.tsx`: `page` 20/26 `-0.3px` 700; `section` 15/20 700; descrição 12 `mt-0.5`; gap 12.
- `EmptyState.tsx`: ilustração `mb-5`, título 17/24 600, texto `mt-2` 13, ação `mt-4`.
- `EditableTitle.tsx`: 15/20 700 (é o título de conversa/reunião), `-0.2px`.
- `ActionButton.tsx`, `Shortcut.tsx`, `Icon.tsx`, `StickyNote.tsx`, `ScrollFade.tsx`, `BrandLogo`, `LapSymbol`, `TapeIllustration`: inalterados (StickyNote é "post-it", fora da escala).

### `docs/specs/desktop-shell/design.md`
Reescrever (só estes trechos): tipografia (linhas ~45–48: títulos 20/26 página, 15/20 seção/painel, 14/20 bloco; interface 13 e 12, metadados 11; leitura 15/24, balões 14/22; caixa alta só fita e marca; rótulo de seção `.label` 11/500 muted), controles (nova subseção "Controles e densidade": botão 32, campo 32, abas 32, segmentado 28, switch 36×20, linha de lista 44/32, cabeçalho de painel 44, página `px-8 pt-5`, grupo de seções `gap-6`), Configurações (linha ~102: seção com rótulo 11 em caixa normal, linha 44, coluna 760), "Não fazer" (+ "controle de 40 px", "caixa alta em rótulo de seção", "título de página acima de 20 px"). Registrar "Decisão de 2026-11-20: densidade no estilo do painel do Claude Desktop, aprovada pelo Andrew". O bloco "Barra lateral em pilha" é do 79.

### Smoke
`layoutMetrics` (`smoke.ts` ~3860–3962): expectativas novas `buttonHeight` 32, `inputHeight` 32, `selectHeight` 32, `copyButtonHeight` 32 (se for `Button`) e as que dependem só de componentes; `settingRowHeight` entre 44 e 60; `modelRowHeight` fica para o 82 (tela); `contentLeft`/`contentTop` ficam para 81/82 (são das telas) — se o `layoutMetrics` misturar, divida a asserção em "componentes" (sua) e "telas" (deixe os valores antigos e um comentário `// 81/82 ajustam`). Título de Configurações `font === '20px/26px'` (~:8268): é tela (82), não mexa. Não acrescente prints.

### Testes
`test/renderer/*` que fixem classes de componentes (se houver) atualizados; `check-shapes` continua verde.

## Critérios de aceite
CA1 e CA4 da spec; `pnpm gates` verde no estado em que as telas ficarem (as telas podem ficar temporariamente "meio densas": o que importa é nada quebrar, nenhum check de componente falhar e nenhum print cortar texto; relate o que ficou estranho para 81/82).

## Fora de escopo
Telas (81/82), barra lateral (79), artboards (83).

## Gates / Relatório
`cd /Users/andrew/Documents/GitHub/meeting-scribe-densidade && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Relatório curto: arquivos; gates; lista do que ficou visivelmente estranho por tela (para 81/82); diferenças em relação à tabela e por quê.
