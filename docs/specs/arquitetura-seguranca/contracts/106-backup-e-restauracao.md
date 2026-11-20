# Contrato 106 — Backup e restauração da pasta de dados
Feature: arquitetura-seguranca · Wave: 10 · Depende de: 105 (e 104, 101, 85) · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa C3 do plan (R20, N1, N4, N6; verificação 10 da spec). Na tela Sistema, "Exportar backup" grava um `.zip`
com os dados do app **sem segredo** numa pasta que o usuário escolhe; "Restaurar backup…" valida o arquivo, pede
confirmação, prepara a troca e reinicia o app, que aplica a troca antes de abrir qualquer store. Nada é apagado: o que
havia antes fica guardado numa pasta ao lado.

## Pré-condições
- 105 commitado (a aba existe) e o **mockup** do 105 com os quadros do backup (botões, confirmação, progresso, erro)
  aprovado. 85 commitado (o token de clique vale para canais que executam; este usa o mesmo mecanismo). Gates verdes.
- **Dependência de zip:** o `package.json` **não tem** nenhuma hoje (conferido em 20/11/2026). Proposta: `fflate`
  (licença MIT, compatível com GPL-3.0-or-later, N6; sem dependências; zip e unzip em fluxo, roda igual no macOS e no
  Linux, onde o `pack:linux` também gera o app). Versão exata fixada no `package.json`, publicada há mais de duas
  semanas, e passando no `pnpm audit` do contrato 88. Alternativa rejeitada: `ditto`/`zip` do sistema (`ditto` só existe
  no macOS; validar entrada por entrada antes de extrair fica fora do controle do app).
- Ler antes: `src/main/system/*` e `src/shared/system.ts` (104), `SystemSection.tsx` (105), `src/main/settings/schema.ts:256-290`
  (`storedEmailAccountSchema`: `password` obrigatório), `src/main/email/service.ts` (onde decifra a senha), `src/main/mcp/store.ts`
  (valores secretos cifrados), `src/main/whatsapp/install.ts:14-26` (`WHATSAPP_PATHS`), `src/preload/index.ts:37-90` (token de clique),
  `smoke-fixtures.ts` (`savePath`, `saveDialogs`, `openedFiles`).

## O que vai e o que não vai no `.zip`
Lista **de inclusão** (o que não está aqui não entra, inclusive caches do Electron como `Cache/`, `Local Storage/`):
`meetings.json`, `meetings/`, `settings.json` (filtrado), `agents.json`, `schedules.json`, `schedule-runs/`, `chats/`,
`chat-events.json`, `mcp-servers.json` (filtrado), `mcp-cli-enabled.json`, `email/` (contas, `.bodies/`, `.folders/`,
`.rules-state.json`, `batches.json`, `invites.json`), `drive-queue.json`, `branding/`, `whatsapp/{insights,transcripts,links}.json`,
e os arquivos em quarentena desses (`*.corrupt-*`, `*.invalid`, `*.bad`).
**Nunca:** `secrets.bin`, `accounts/` (Google e Microsoft), `whatsapp/{service.bin,token,session/,venv/,bridge/,aceite.json,installed.json}`,
`lock.json` (hash da senha do bloqueio, que vale para este Mac), `tmp/`, `chat-corpus/`, `chat-scope/`, `claude-cwd/`, `acp/`,
`automations-empty/`, temporários `*.tmp-*`. **Filtrados:** em `settings.json`, `emailAccounts[].password` sai (CA6); em
`mcp-servers.json`, todo valor marcado como segredo sai (só vale com o Chaveiro deste Mac).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `package.json`, `pnpm-lock.yaml` (raiz) | `fflate` em `dependencies`, versão exata |
| `src/shared/system.ts` | tipos do CA1 |
| `src/main/system/backup.ts` | **novo**: inclusão, filtros, manifesto, validação, preparo da troca (CA2–CA5) |
| `src/main/storage/archive.ts` | **novo**: ler e escrever o zip em fluxo, extrair para a pasta de preparo, aplicar a troca na abertura (o `fs` fica em `storage/`, contrato 103) |
| `src/main/settings/schema.ts`, `src/main/settings/store.ts`, `src/main/email/service.ts` | conta de email com `password: null` = "falta a senha" (CA6) |
| `src/main/index.ts` (no `whenReady`, antes de `createAppServices`) | `applyPendingRestore(dataDir)` (CA5) |
| `src/main/composition/*`, `src/main/composition/ipc.ts`, `src/main/ipc-schemas/system.ts` | os três canais do CA7 e os esquemas, ligados ao serviço do 104 |
| `src/shared/ipc.ts` | os três canais nos quatro lugares |
| `src/renderer/src/features/settings/SystemSection.tsx` | a seção "Backup" (CA8) |
| `src/main/smoke-fixtures.ts`, `src/main/smoke.ts` | `chosenBackup`, `backupConfirm`, `relaunches` e o passo do CA9 |
| `test/system-backup.test.ts` | **novo**: CA10 |

## Critérios de aceite
- **CA1 — Tipos.**
  ```ts
  export interface BackupManifest { format: 1; app: 'lap-reunioes'; appVersion: string; createdAt: string; versions: Partial<Record<SystemStoreId, number[]>>; files: number; bytes: number }
  export type BackupExportResult = { ok: true; path: string; files: number; bytes: number } | { ok: false; error: 'cancelled' | 'locked' | 'busy' | 'failed' }
  export interface BackupSummary { createdAt: string; appVersion: string; meetings: number; chats: number; emailAccounts: number; bytes: number }
  export type BackupRestoreResult =
    | { ok: true; restarting: true }
    | { ok: false; error: 'cancelled' | 'locked' | 'busy' | 'not-backup' | 'newer-version' | 'unsafe' | 'too-big' | 'failed'; summary?: BackupSummary }
  ```
- **CA2 — Exportar.** `exportBackup()`: diálogo nativo de salvar aberto pelo main (nome padrão
  `LAP Reuniões - backup AAAA-MM-DD.zip` em Downloads, filtro `.zip`); grava num temporário ao lado e `rename` no fim
  (falha → temporário apagado, `failed`); `manifest.json` na raiz do zip; cada store lido **pela fila do seu store** ou
  com a gravação parada (nenhum arquivo copiado no meio de uma gravação: a cópia usa a leitura do 93 por arquivo).
  Com gravação em andamento (`recordingSessions.active()`) → `busy`. Cancelado → `cancelled`, nada gravado.
- **CA3 — Nada de segredo (N4).** Dado o app de teste com chave da AssemblyAI, conta Google, conta de email com senha
  cifrada `c2VncmVkbw==`, servidor MCP com segredo e WhatsApp pareado, o zip exportado não tem nenhuma entrada da lista
  "Nunca" e nenhum byte de nenhum desses valores (*asserção:* abre cada entrada e procura os valores conhecidos).
- **CA4 — Validar antes de tocar nos dados.** `chooseRestore()` abre o diálogo de arquivo do main (`.zip`) e confere, sem
  extrair para o lugar final: `manifest.json` presente e válido (zod `.strict()`, `app` e `format` certos) → senão
  `not-backup`; toda entrada dentro da lista de inclusão, sem `..`, sem caminho absoluto, sem link simbólico, sem
  entrada repetida → senão `unsafe`; soma descomprimida ≤ 20 GB e ≤ 200 000 entradas, e nenhuma entrada com taxa de
  compressão acima de 200:1 → senão `too-big`; para cada store, toda `version` do manifesto e do topo de cada JSON ≤ a
  versão que este app conhece (a dos descritores do 104/101) → senão `newer-version`. Tudo ok → `BackupSummary`.
- **CA5 — Confirmar, preparar e reiniciar.** Com o resumo, o main mostra `dialog.showMessageBox` próprio (não o renderer):
  "Restaurar o backup de <data>? Os dados atuais ficam guardados em <pasta>. O app vai reiniciar.", botões "Restaurar e
  reiniciar" / "Cancelar" (padrão Cancelar). Confirmado: extrai para `<dataDir>/.restaurar/` (0700, arquivos 0600), grava
  `<dataDir>/.restaurar.json` com o manifesto e chama `app.relaunch(); app.exit(0)`. Na abertura seguinte,
  `applyPendingRestore` roda **antes** de qualquer store: move cada item da lista de inclusão que existe para
  `<dataDir>/antes-da-restauracao-<ISO>/`, move os do `.restaurar/` para o lugar, apaga o marcador; falha no meio → desfaz
  a partir da pasta "antes" e loga só o código. Marcador sem pasta de preparo (ou o contrário) → apaga os dois e segue.
  `secrets.bin`, `accounts/`, `lock.json` e o WhatsApp **não são tocados**.
- **CA6 — Contas de email sem senha.** `storedEmailAccountSchema.password` passa a aceitar `null`; o store grava `null`
  como veio; o `email/service.ts` não conecta conta com `password: null` e a deixa em `error` com a mensagem fixa
  "Digite a senha desta conta de novo." (a edição da conta que já existe grava a senha nova). Assim a restauração traz
  contas, assinaturas e regras (que o `settings.json` só guarda para conta existente) e pede só a senha. *Teste:* ida e
  volta de uma conta `null` e de uma cifrada no mesmo arquivo (o caso do 100 continua verde).
- **CA7 — Canais**, todos `'refused'` com o app bloqueado e com esquema em `ipc-schemas/system.ts` (89): `scribe:system-backup-export` (sem
  pedido) → `BackupExportResult`; `scribe:system-backup-choose` (sem pedido) → `BackupRestoreResult` (sem `ok: true`:
  devolve `summary` ou o erro); `scribe:system-backup-restore` → `BackupRestoreResult`, **exige o token de clique** do
  mecanismo do 85 e um `chooseRestore` válido nos últimos 5 min na mesma janela (senão `cancelled`).
- **CA8 — Tela.** Seção "Backup" na aba Sistema, conforme o mockup: "Exportar backup" (secundário) com o resultado "Backup
  salvo em <pasta> · <tamanho>" e "Mostrar no Finder"; "Restaurar backup…" (secundário, contorno `--rec`) que, depois do
  `choose`, mostra o resumo e o botão "Restaurar e reiniciar" (o clique leva o token); frases de erro fixas, uma por
  código do CA1; texto de apoio "O backup não leva senhas nem contas conectadas: depois de restaurar, entre de novo no
  Google, na Microsoft, no WhatsApp e digite a senha das contas de email. O arquivo não é cifrado: guarde-o com cuidado."
  Sem literal de cor; `data-system-backup="export|choose|restore"`.
- **CA9 — Smoke.** Com `savePath` = `<home do smoke>/backup.zip`: exportar → o zip existe, tem `manifest.json` e
  `meetings.json`, não tem `secrets.bin` nem `accounts/`, e o `settings.json` de dentro não contém `"password":"` com valor;
  `chosenBackup` = esse zip e `backupConfirm: true` → `.restaurar/` e `.restaurar.json` criados e `relaunches === 1` (no
  smoke o `relaunch`/`exit` só são registrados); `chosenBackup` = zip com `../fora.txt` → `unsafe` na tela.
- **CA10 — Testes** (`test/system-backup.test.ts`, pasta temporária): CA3; CA4 um caso por erro (inclusive zip-bomba pequena,
  link simbólico e `version: 99`); CA5: `applyPendingRestore` troca, guarda o antigo e é idempotente; falha simulada no meio
  → dados de antes no lugar; verificação 10 da spec de ponta a ponta sem Electron (exportar → apagar a pasta → preparar →
  aplicar → os stores leem reuniões, conversas e email iguais; conta de email com `password: null`).

## Invariantes
- N4: nenhum segredo sai no zip nem no log (âncora: CA3). N1: nada é apagado — o antigo vai para `antes-da-restauracao-*`.
- Nenhum arquivo do zip é escrito fora de `<dataDir>/.restaurar/` antes da confirmação, e nenhum fora de `<dataDir>` nunca.
- A troca acontece com nenhum store aberto (antes de `createAppServices`).

## Fora de escopo
- Cifrar o backup (F2), backup automático ou agendado, restaurar parcial, sincronizar entre Macs, levar a chave da
  AssemblyAI ou contas conectadas, limpar as pastas `antes-da-restauracao-*`. F1, F3–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde, inclusive o `pnpm audit` (88) com o `fflate`.
- Teste navegado numa sessão nova, com a verificação 10 da spec. Sem commit pelo implementador.

## Dúvidas para o coordenador
- **Senha de email `null` (CA6)** muda o esquema do `settings.json` e o serviço de email, além do que a spec lista. Sem
  isso, tirar a senha faria a conta (e as assinaturas e regras dela) sumir na leitura (`parseEmailAccounts` descarta
  conta sem `password`), contra a verificação 10 ("email volta"). Downgrade: a 0.18.0 descartaria só essas contas.
- **`lock.json` fora do backup**: restaurar num Mac novo sai sem senha de bloqueio. Alternativa: levar e restaurar.
- **Backup sem cifra** (F2): o zip tem reuniões e emails em claro; o texto de apoio avisa. Confirmar se basta.
- **Dependência nova** (`fflate`): pede o ok do Andrew (N6 cumprido pela licença MIT).
