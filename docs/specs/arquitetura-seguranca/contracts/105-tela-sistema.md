# Contrato 105 — Tela Configurações › Sistema
Feature: arquitetura-seguranca · Wave: 9 · Depende de: 104, mockup aprovado · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa C2 do plan (R19, tela; N4; "Telas de impacto" 1). Uma aba nova, **Sistema**, no nível Configurações da
barra lateral em pilha, que mostra o `SystemOverview` do contrato 104: a pasta de dados com o tamanho e "Abrir no
Finder", a tabela dos stores e a lista dos serviços. **Só o renderer**, mais o passo do smoke e o guia do app: nenhum
canal novo (os dois do 104 bastam; o backup é do 106). Se faltar algo no main, o implementador **para e relata**.

## Pré-condições
- **Mockup aprovado pelo Andrew. NÃO EXISTE AINDA.** Antes deste contrato sair do rascunho é preciso desenhar
  `docs/specs/arquitetura-seguranca/mockups/Sistema.dc.html` (quadros em claro e escuro, tokens do
  `docs/specs/desktop-shell/design.md`, no esqueleto dos mockups do desktop-shell), cobrindo no mínimo: a aba com
  dados normais; um store com quarentena; um serviço com erro; a pasta grande (GB); o estado "carregando" e o de falha
  da leitura; a largura mínima da janela. As decisões do mockup entram aqui como D1…Dn com o CA que cumpre cada uma,
  como no contrato 63. Sem o ok, nenhum CA de aparência vale (checklist do Andrew, passo 3).
- 104 commitado; gates verdes.
- Ler antes: `src/shared/routes.ts:105-113` (`SETTINGS_TABS`), `src/renderer/src/features/settings/settingsTabs.ts`
  (rótulos, ⌘1…⌘9), `SettingsScreen.tsx` (o `panel(…)` de cada aba, `:241-474`), `AboutSection.tsx` (modelo de aba que
  lê um canal ao abrir), `src/renderer/src/app/SidebarStack.tsx:164-180` (uma linha por aba, atalho só até a 9ª),
  `src/shared/settings-index.ts` (as linhas da busca), `src/renderer/src/design/{Section,SettingRow,Button,Note}.tsx`,
  `docs/specs/desktop-shell/design.md` ("Configurações", "Controles e densidade", "Não fazer"),
  `resources/assistente/guia-do-app.md` (`<!-- aba: … -->`), `test/renderer/settings-tabs.test.ts`.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/shared/routes.ts` | `'sistema'` em `SETTINGS_TABS`, **depois de `'sobre'`** (CA1) |
| `src/renderer/src/features/settings/settingsTabs.ts` | rótulo `sistema: 'Sistema'` |
| `src/renderer/src/features/settings/SystemSection.tsx` | **novo**: a aba (CA2–CA6) |
| `src/renderer/src/features/settings/systemFormat.ts` | **novo**, puro: bytes, datas, estado → texto e tom (CA7) |
| `src/renderer/src/features/settings/SettingsScreen.tsx` | `{panel('sistema', <SystemSection active={…} />)}` |
| `src/shared/settings-index.ts` | as linhas da aba para a busca (CA8) |
| `resources/assistente/guia-do-app.md` | bloco `<!-- aba: sistema -->` (o `test/assistant.test.ts:785` exige um por aba) |
| `test/renderer/settings-tabs.test.ts` | a lista e os rótulos com `sistema` no fim (mudança esperada do CA1) |
| `test/renderer/system-format.test.ts` | **novo**: CA7 |
| `src/main/smoke.ts` | passo novo (CA9) |

## Critérios de aceite
- **CA1 — A aba.** `SETTINGS_TABS` termina em `…, 'conexoes', 'sobre', 'sistema'`; a barra lateral mostra "Sistema" como
  10ª linha **sem atalho** (o `SidebarStack` já só dá ⌘ às 9 primeiras), e ⌘9 continua abrindo **Sobre** (contrato 55;
  `settings-tabs.test.ts:54` sem mudança). `settingsPath('sistema')` abre a aba; a aba lembrada vale para ela.
- **CA2 — Carregar ao abrir.** Com a aba ativa (e a cada vez que volta a ficar ativa), um `invoke('scribe:system-overview')`;
  enquanto não volta, o painel mostra o estado "carregando" do mockup, sem spinner; falha (inclusive o app bloqueado, que
  recusa) → `Note` com "Não foi possível ler os dados agora." e o botão "Tentar de novo" (`data-system-retry`). Com a aba
  inativa, nenhuma chamada. Nada de leitura periódica.
- **CA3 — Pasta de dados** (`Section` "Pasta de dados", `data-system-datadir`): uma `SettingRow` com o caminho
  (`select-text`, cortado no meio com reticências se não couber, caminho inteiro no `title`), o total em `systemFormat.bytes`
  e o botão secundário "Abrir no Finder" que chama `scribe:system-open-data-folder`; `{ ok: false }` → texto de apoio
  "O Finder não abriu a pasta." ao lado do botão.
- **CA4 — Dados guardados** (`Section` "Dados guardados"): uma linha por `SystemStoreInfo` na ordem recebida, com
  `data-system-store="<id>"`: nome (`label`), caminho em `Menlo` 11 `--text-faint`, tamanho, itens (`—` quando `null`),
  versão ("v1"; "v0, v1" quando mais de uma; `—` vazio), última gravação (`systemFormat.when`). `exists: false` → linha
  apagada com "Ainda não criado". `secret: true` → itens e versão em branco e o apoio "Cifrado neste Mac". Com
  quarentena: a linha ganha a marca do mockup e, abaixo, a lista dos arquivos (`data-system-quarantine`) com nome, tamanho
  e data; o texto "Arquivo que o app não conseguiu ler. Fica guardado aqui; nada foi apagado." Sem ação de apagar.
- **CA5 — Serviços** (`Section` "Serviços"): uma linha por `SystemServiceInfo`, `data-system-service="<id>"`, com o
  nome, o estado em texto (`systemFormat.state`) e o tom do mockup, a porta (`127.0.0.1:<porta>` em `Menlo`) quando houver,
  o `detail` e, com `lastError`, a mensagem e a hora em `--rec`. Nenhum botão de ligar/desligar aqui (cada serviço já tem
  a aba dele); se o mockup pedir um link "Abrir <aba>", ele navega com `settingsPath`.
- **CA6 — Design system.** Só `Section`, `SettingRow`, `Button`, `Note`, `Icon` e classes do tema; nenhum literal de cor
  (gate 6), nenhuma sombra, raio só 4 ou 6, nenhuma pílula (gate 7); números com `tabular`; estados por texto + tom, nunca
  só por cor (contraste da tabela do `design.md`). Funciona em claro e escuro e na largura mínima da janela sem rolagem
  horizontal (a tabela de stores quebra em duas linhas por item abaixo de 760 px, conforme o mockup).
- **CA7 — `systemFormat.ts`** (puro, `test/renderer/system-format.test.ts`): `bytes(0) === '0 B'`, `bytes(1536) === '1,5 KB'`,
  `bytes(1_288_490_189) === '1,2 GB'` (base 1024, vírgula, uma casa); `when(null) === '—'`, hoje → `'hoje, 14:05'`, ontem →
  `'ontem, 09:30'`, antes → `'12 de nov., 18:00'`, outro ano → com o ano; `state` cobre os oito `SystemServiceState`
  (`running` → "Funcionando", `off` → "Desligado", `stopped` → "Parado", `starting` → "Ligando", `error` → "Com erro",
  `not-installed` → "Não instalado", `unavailable` → "Indisponível neste Mac", `unknown` → "Sem verificação").
- **CA8 — Busca.** Linhas em `settings-index.ts`: "Pasta de dados", "Abrir no Finder", "Dados guardados", "Arquivos em
  quarentena", "Serviços", com palavras-chave `sistema diagnóstico armazenamento backup`; buscar "quarentena" mostra
  "Sistema › Arquivos em quarentena".
- **CA9 — Smoke** (no fluxo de Configurações, tema claro e escuro): abrir Sistema pela barra lateral → `data-system-store="meetings"`
  com os itens iguais ao número de reuniões semeadas; `data-system-store="agents"` com `data-system-quarantine` listando o
  `agents.json.corrupt-*` do passo do 101; `data-system-service="meet-server"` com `127.0.0.1:` e uma porta de
  `SMOKE_MEET_PORTS`; "Abrir no Finder" → `smokeFixtures.openedFiles` ganha `{ action: 'open', path: <userData do smoke> }`;
  o texto da aba inteira não contém a chave falsa da AssemblyAI nem o base64 da senha da conta de email do smoke (N4);
  prints `configuracoes-sistema-light` e `-dark`. Os passos por aba que já iteram `SETTINGS_TABS` (`smoke.ts:4007`, `:4072`)
  passam a incluir `sistema` sem mudança de código.

## Invariantes
- Nenhum canal novo; a tela só lê (o único efeito é abrir o Finder). Âncora: `git diff src/shared/ipc.ts` vazio.
- N4: a tela nunca mostra segredo, nem parcial (CA9). Atalhos ⌘1…⌘9 iguais aos de hoje.

## Fora de escopo
- Exportar e restaurar backup (106); limpar quarentena; ligar ou desligar serviços daqui. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde, inclusive os gates 6 e 7.
- Teste navegado numa sessão nova, com prints (checklist, passo 5). Sem commit pelo implementador.

## Dúvidas para o coordenador
- **Posição da aba**: no fim (sem atalho) mantém ⌘9 = Sobre; antes de Sobre daria ⌘9 a Sistema e mudaria um atalho que
  existe desde o contrato 55. Recomendo no fim; confirmar no mockup.
- **Mockup**: quem desenha e quando. Este contrato não deve ir ao implementador antes do ok.
