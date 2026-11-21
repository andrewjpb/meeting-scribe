# Contrato 109: Configurações do funil (Geral › Funil de vendas)

Feature `funil-vendas` · Wave 1 · Depende de: mockup aprovado · Spec `../spec.md` (R46; CA10; CA16 parte `configuracoes-geral`) · Plan `../plan.md` (D10, D11) · Mockup `../mockups/Funil.dc.html` (artboard `11-configuracoes-geral-funil`; PNGs `../mockups/png/11-configuracoes-geral-funil-claro.png` e `-escuro.png`). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-109` (branch `funil-109`, a partir da ponta da `funil-vendas`). Roda em paralelo com 107 e 108; **você é o único da wave 1 que edita `src/main/smoke.ts`**.

## Pré-condições
- **Artboard `11-configuracoes-geral-funil` aprovado pelo Andrew.** Sem a aprovação, pare e avise.
- Leia na spec R46 e CA10; no plan D10.
- No código: `src/shared/settings-defaults.ts:57` (`AppSettings`) e `:222` (`DEFAULT_SETTINGS`); `src/main/settings/schema.ts` (`parseSettings` tolerante em `:233`, `parseSettingsPatch` estrito em `:245`, o padrão de objeto aninhado em `:90-110`); `src/shared/settings-index.ts:92` (`settingsIndex`); `src/renderer/src/features/settings/SettingsScreen.tsx:293-316` (`panel('geral', …)` com `BrandSection`, `Section "Aparência"`, `Section "Janela"`, `LockSection`, `UpdatesSection`); `design/Section.tsx`, `design/SettingRow.tsx`, `design/Switch.tsx`, `design/Field.tsx` (`TextField`); `test/settings-store.test.ts:9-20` (padrões exatos); `src/main/smoke.ts:4280-4300` (todo `data-setting-row` precisa estar no índice) e `:13102` (`shoot('configuracoes-geral', …)`).

## Superfície

### Tipos e padrões (`src/shared/settings-defaults.ts`)
- `AppSettings.funil: FunilSettings`, com `export interface FunilSettings { detectarNasReunioes: boolean; diasEsfriar: number; avisarEsfriadas: boolean }`.
- `DEFAULT_SETTINGS.funil = { detectarNasReunioes: true, diasEsfriar: 7, avisarEsfriadas: true }`.
- Constantes `FUNIL_DIAS_ESFRIAR_MIN = 1`, `FUNIL_DIAS_ESFRIAR_MAX = 90`.

### Esquema (`src/main/settings/schema.ts`)
- No arquivo (tolerante): campo por campo com `.catch` do padrão; `diasEsfriar` inteiro fora de 1 a 90 vira 7.
- No pedido do renderer (estrito, `parseSettingsPatch`): `funil` é objeto `.strict()` com os três campos obrigatórios; `diasEsfriar` inteiro de 1 a 90; qualquer outro valor recusa o pedido inteiro.

### Índice (`src/shared/settings-index.ts`)
Três linhas `row('geral', 'Funil de vendas', …)`: "Detectar oportunidades nas reuniões" ("Depois do resumo, propõe criar ou atualizar uma oportunidade."), "Considerar esfriada após (dias)" ("Oportunidade aberta sem interação nesse prazo ganha o marcador esfriou."), "Avisar oportunidades esfriadas e passos vencidos" ("Uma notificação por dia, depois das 9h.").

### Tela (`src/renderer/src/features/settings/FunilSection.tsx`, novo; montado em `SettingsScreen.tsx`)
- `<Section title="Funil de vendas">` com três `SettingRow` (`nameId` `settings-funil-detectar`, `settings-funil-dias`, `settings-funil-avisar`; `name` igual às linhas do índice): `Switch` (`data-setting-name` via `SettingRow`), `TextField` numérico (`inputMode="numeric"`, largura de 64 px, `data-funil-dias`), `Switch`.
- O campo grava no blur ou Enter com `update({ funil: { ...settings.funil, diasEsfriar } })` quando o valor é inteiro de 1 a 90; valor fora do intervalo, não inteiro ou vazio **não grava** e, no blur, o campo volta ao último valor válido salvo (R46). Nenhuma mensagem extra.
- Em `SettingsScreen.tsx`, a `FunilSection` entra em `panel('geral', …)` logo depois de `Section "Janela"` e antes de `LockSection`.

### Smoke (`src/main/smoke.ts`, no bloco que já fotografa `configuracoes-geral`; checks obrigatórios `funilSettings`, `funilSettingsInvalid`)
- `funilSettings`: em `/configuracoes/geral`, o painel `geral` contém o texto "Funil de vendas" e os três `data-setting-name`; o check de índice existente (`:4286`) continua verde com as linhas novas.
- `funilSettingsInvalid`: digitar `0` em `[data-funil-dias]` e sair do campo → o campo volta a mostrar `7` e `settings.funil.diasEsfriar` continua 7 (lido pelo canal de settings); apagar tudo e sair → volta a `7`; digitar `14` e Enter → 14 gravado; volte a 7 no fim do check.
- Nenhum print novo: `configuracoes-geral` regrava. **`expectedShots` não muda** (continua `SCREENS.length * THEMES.length + 179`, `smoke.ts:13421`).

## Critérios de aceite
- **CA1** (CA10 da spec) Dado `settingsIndex('Claude')`, quando filtrado por `section === 'Funil de vendas'`, então há exatamente as três linhas com os nomes da Superfície, todas em `tab: 'geral'` (`test/settings-store.test.ts` ou o teste de índice existente).
- **CA2** (CA10 da spec) Dado `parseSettingsPatch({ funil: { detectarNasReunioes: true, diasEsfriar: 0, avisarEsfriadas: true } })`, então lança (ou devolve recusa, no padrão do arquivo); com `diasEsfriar: 91`, idem; com `14`, aceita e devolve `funil.diasEsfriar === 14`.
- **CA3** Dado um `settings.json` antigo sem `funil`, quando `parseSettings`, então `funil` vem igual a `DEFAULT_SETTINGS.funil`; dado `funil.diasEsfriar: 500` no arquivo, vem 7 e os outros dois campos são preservados.
- **CA4** Dado o teste de padrões (`test/settings-store.test.ts:11`), então ele espera `funil: { detectarNasReunioes: true, diasEsfriar: 7, avisarEsfriadas: true }` e passa.
- **CA5** (CA16 da spec, parte) Dado o smoke, quando abre `/configuracoes/geral`, então os checks `funilSettings` e `funilSettingsInvalid` passam e `configuracoes-geral-light.png`/`-dark.png` são gerados.
- **CA6** Dado o app bloqueado, quando o renderer tenta gravar `funil`, então o canal de settings se comporta como hoje para qualquer outro campo (nenhuma regra nova de bloqueio).

## Invariantes
- Os outros campos de `AppSettings`, as 9 abas de `SETTINGS_TABS` (`shared/routes.ts:127`) e os atalhos ⌘1 a ⌘9 não mudam.
- O total de prints do smoke não muda; os outros checks de Configurações continuam verdes.
- Nenhum literal de cor fora de `tokens.css`; sem sombra, sem pílula, raio até 6 px (`check-shapes.sh`).

## Fora de escopo desta tarefa
Usar os valores (kanban, alerta, detecção: 112, 115, 113). Qualquer outra aba. Interruptor "Pode ler o funil" do agente (115).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-109 && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde. Testes: CA1 a CA4 em `test/settings-store.test.ts` (ou no arquivo de testes do índice que já existir).

## Relatório final (formato)
Arquivos; gates (contagens, `expectedShots` igual); onde a Section ficou no painel e a confirmação visual de `configuracoes-geral` nos dois temas; diferenças em relação ao artboard `11-configuracoes-geral-funil` e por quê.
