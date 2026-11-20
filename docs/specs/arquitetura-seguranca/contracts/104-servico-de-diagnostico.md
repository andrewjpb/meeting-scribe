# Contrato 104 — Serviço de diagnóstico (`src/main/system/`)
Feature: arquitetura-seguranca · Wave: 8 · Depende de: 101, 102 · Spec/Plan: docs/specs/arquitetura-seguranca/{spec,plan}.md (RASCUNHO, aguardam aprovação)

Microtarefa C1 do plan (R19, parte do main; N4). Um serviço novo junta, sob demanda, o que a tela Sistema (105)
mostra: a pasta de dados e o tamanho dela; por store, tamanho, itens, versão do formato, última gravação e
quarentenas; por serviço, estado, porta e último erro. Só lê. Nada aqui desenha tela nem faz backup (105, 106).

## Pré-condições
- 101 (quarentena uniforme e `listQuarantine`) e 102 (`composition/`, `resolveDataDir`) commitados; gates verdes.
- Ler antes: `src/main/storage/*` (inclusive `listQuarantine` e `fs-exceptions.json` se o 103 já entrou),
  `src/main/composition/*`, `src/shared/ipc.ts` (`InvokeChannels`, `INVOKE`, `WHEN_LOCKED`) e os esquemas centrais do contrato 89
  (`INVOKE_SCHEMAS` em `src/main/ipc-schemas/index.ts`; o `handle` busca o esquema pelo nome); os estados que já existem:
  `WhatsAppStatus` (`shared/whatsapp.ts:42`), `EmailAccountStatus` (`shared/email.ts:72`), `KeyStatus`
  (`shared/assemblyai.ts:7`), `ClaudeLocateResult` (`shared/claude-cli.ts:6`), `MeetServer.status()/port()`
  (`main/meet/server.ts:96`), `NavegadorServer.port()/connected()` (`main/navegador/server.ts:73`), o `McpOverview`
  e o `lastTest` do MCP (`main/mcp/store.ts:109`), `locateMacCalendar` (`main/mac-calendar/process.ts`).

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/shared/system.ts` | **novo**: os tipos do CA1. Puro, sem `node:*` nem `electron` |
| `src/main/system/stores.ts` | **novo**: `STORE_DESCRIPTORS`, a lista fixa dos stores (CA2) |
| `src/main/system/service.ts` | **novo**: `createSystemService(deps)` → `{ overview(), openDataFolder() }` (CA3–CA6) |
| `src/main/storage/inspect.ts` | **novo**: `inspectPath(path)` → `{ bytes, files, mtimeMs, versions }` e `dirSize(path)`, só leitura (o lint do 103 exige que o `fs` fique em `storage/`) |
| `src/main/composition/core.ts` (ou o módulo que fizer sentido) e `composition/types.ts` | cria o serviço e o põe em `AppServices.system` |
| `src/main/composition/ipc.ts` (102) e `src/main/ipc-schemas/system.ts` (**novo**, ligado em `ipc-schemas/index.ts`) | os dois canais do CA7 e os esquemas `z.undefined()` |
| `src/shared/ipc.ts` | os dois canais nos quatro lugares |
| `test/system-service.test.ts` | **novo**: CA8 |

## Critérios de aceite
- **CA1 — Tipos (`src/shared/system.ts`)**, exatamente estes (o 105 consome sem adaptar):
  ```ts
  export const SYSTEM_STORE_IDS = ['meetings', 'transcripts', 'summaries', 'notes', 'analyses', 'settings', 'agents', 'schedules', 'schedule-runs', 'chats', 'chat-events', 'mcp', 'email-accounts', 'email-bodies', 'email-folders', 'email-rules-state', 'email-batches', 'invites', 'lock', 'drive-queue', 'calendar-cache', 'whatsapp-insights', 'whatsapp-transcripts', 'whatsapp-links', 'secrets', 'accounts'] as const
  export type SystemStoreId = (typeof SYSTEM_STORE_IDS)[number]
  export interface SystemQuarantineFile { name: string; bytes: number; at: number /* mtime */; style: 'corrupt' | 'invalid' | 'bad' }
  export interface SystemStoreInfo {
    id: SystemStoreId
    label: string                 // em português, para a tela ("Reuniões", "Conversas do Assistente"…)
    path: string                  // relativo à pasta de dados ("meetings.json", "chats/")
    kind: 'file' | 'folder'
    exists: boolean
    bytes: number
    items: number | null          // null quando contar não faz sentido (secrets, accounts) ou o arquivo não se lê
    versions: number[]            // versões vistas, sem repetir, em ordem; 0 = arquivo sem `version`
    lastWriteAt: number | null    // mtime mais recente
    quarantine: SystemQuarantineFile[]
    secret: boolean               // true: só tamanho e data (F5); nunca itens nem versão
  }
  export type SystemServiceState = 'off' | 'starting' | 'running' | 'stopped' | 'error' | 'not-installed' | 'unavailable' | 'unknown'
  export interface SystemServiceInfo {
    id: 'whatsapp' | 'mac-calendar' | 'transcription' | 'claude' | 'acp' | 'mcp' | 'meet-server' | 'navegador-server' | `email:${string}`
    label: string                 // "WhatsApp", "Email · ana@exemplo.com"…
    state: SystemServiceState
    detail: string | null         // linha curta em português ("3 servidores, 1 com erro"), sem segredo
    port: number | null
    lastError: { message: string; at: number | null } | null
  }
  export interface SystemOverview {
    dataDir: string
    totalBytes: number
    otherBytes: number            // o que não é de nenhum store (caches do Electron, instalação do WhatsApp)
    stores: SystemStoreInfo[]     // na ordem de SYSTEM_STORE_IDS
    services: SystemServiceInfo[] // na ordem do `id` acima, as contas de email por último na ordem das contas
    takenAt: number
  }
  export type SystemOpenResult = { ok: true } | { ok: false; error: 'failed' }
  ```
- **CA2 — Descritores.** `STORE_DESCRIPTORS: readonly { id, label, path, kind, secret, count?: (json: unknown) => number | null }[]`,
  um por `SystemStoreId`, com o caminho e o contador real de cada store (ex.: `meetings.json` → `meetings.length`;
  `chats/` → arquivos `*.json`; `email-accounts` → `email/*.json` fora `batches.json`/`invites.json`, itens = soma de
  `inbox.length + sent.length`). `secrets` = `secrets.bin` e `accounts` = `accounts/`, ambos `secret: true`.
  *Teste:* `SYSTEM_STORE_IDS` e os descritores têm o mesmo conjunto; nenhum `path` absoluto nem com `..`.
- **CA3 — `overview()` dos stores.** Para cada descritor: `inspectPath` (tamanho, mtime, `version` do topo de cada
  JSON) e `listQuarantine` da pasta do arquivo (os três estilos do 101). Arquivo que não se lê → `items: null`,
  `versions: []`, sem erro e **sem quarentenar** (o diagnóstico nunca move nem grava nada). `secret: true` → `items`
  `null` e `versions` `[]`, sem abrir o arquivo (só `stat`). `totalBytes` = `dirSize(dataDir)`; `otherBytes` = total −
  soma dos stores (mínimo 0).
- **CA4 — `overview()` dos serviços, sem efeito colateral.** Só lê estados que já existem, sem ligar nada:
  | `id` | De onde | `state` / `port` / `lastError` |
  |---|---|---|
  | `whatsapp` | `whatsapp.status()` | `state` mapeado do `WhatsAppState`; `lastError` = `status.error` traduzido pela tabela de mensagens que a tela de WhatsApp já usa |
  | `mac-calendar` | plataforma + `locateMacCalendar` | `unavailable` fora do Mac ou sem binário, senão `unknown` — **nunca** chama `status()` (que sobe o helper; o 62 CA20 garante que ele só sobe com evento gravado) |
  | `transcription` | `secrets` (`KeyStatus`) | `running` se `configured`, senão `off`; `detail` "Chave salva" / "Chave de desenvolvimento" / "Sem chave" — **sem `last4`** |
  | `claude` | `claude.locate()` (cache do serviço) | `running` com `detail` = versão; `not-installed` se `not-found` |
  | `acp` | `acp.current()` → estado do agente | `not-installed`, `running` ou `error` com a mensagem fixa do serviço |
  | `mcp` | `mcp.overview({})` **sem `cli`** (não roda `claude mcp list`; só os servidores do app e os ligados) | `detail` "N servidores, M com erro"; `lastError` = o mais recente `lastTest` com `ok: false`, só o nome do servidor e o horário |
  | `meet-server` | `meet.port()` / `status().connected` | `running` + porta, ou `off` |
  | `navegador-server` | `navegador.port()` / `connected()` | idem; **nunca** o token (contrato 86) |
  | `email:<id>` | `email.accounts()` | `state` do `EmailAccountState`, `label` com o endereço, `lastError` = `status.error` (já sem senha, `shared/email.ts:75`) |
- **CA5 — N4: nada de segredo.** Dado o app de teste com chave da AssemblyAI `aai-SEGREDO-123`, senha de email cifrada
  `c2VncmVkbw==`, token do navegador e do WhatsApp conhecidos e um valor secreto de MCP, quando `overview()` roda, então
  `JSON.stringify(result)` não contém nenhum desses valores nem os 4 últimos dígitos da chave. Nenhum conteúdo de arquivo
  (título, corpo, mensagem) aparece: só números, datas, nomes fixos dos descritores e o endereço da conta de email.
- **CA6 — `openDataFolder()`** chama `deps.openPath(dataDir)` (o `shell.openPath` do Electron; no smoke,
  `smokeFixtures.openedFiles` com `action: 'open'`), texto de erro → `{ ok: false, error: 'failed' }`.
- **CA7 — Canais.** Em `shared/ipc.ts` (tipo, `INVOKE`, `WHEN_LOCKED` `'refused'`) e com esquema `z.undefined()` em `ipc-schemas/system.ts` (89):
  `scribe:system-overview` → `SystemOverview`; `scribe:system-open-data-folder` → `SystemOpenResult`. O `test/lock-ipc.test.ts`
  cobre sem mudança.
- **CA8 — Testes** (`test/system-service.test.ts`, pasta temporária com uma cópia mínima de cada store e serviços falsos):
  CA2; contagens e versões de `meetings.json` (3 reuniões, v1), `chats/` (2 arquivos, um v0 e um v1 → `versions: [0, 1]`);
  `agents.json.corrupt-…`, `invites.json.invalid` e `chat-events.1000.bad` aparecem com o `style` certo; arquivo
  quebrado → `items: null` e continua no lugar, sem `.corrupt-` novo; `secrets.bin` só com `bytes`; o `mac-calendar` não
  chama `spawn` (espião); CA5; CA6 com `openPath` falso que devolve `'erro'`.

## Invariantes
- O diagnóstico é só leitura: nenhuma gravação, renomeação, `mkdir` nem processo novo (âncora: CA3, CA4, CA8).
- N4: nenhum segredo, nem parcial (âncora: CA5). Nada de conteúdo de usuário no resultado nem em log.
- Mesmo comportamento com o app bloqueado: os dois canais `'refused'`.

## Fora de escopo
- A tela (105), o backup (106), registrar erro novo nos serviços (o `lastError` vem do estado que já existe),
  botão de "verificar" o Calendário do Mac, evento de main para a tela atualizar sozinha. F1–F7 da spec.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (smoke de hoje sem mudança; o passo da tela é do 105).
- `git diff --stat` só com a Superfície. Sem commit pelo implementador.

## Dúvidas para o coordenador
- **"Último erro" por serviço**: só WhatsApp, email, ACP e MCP têm erro no estado hoje; transcrição, Meet e navegador não
  guardam o último erro. O contrato mostra `null` para eles em vez de criar rastreio novo nos serviços. Confirmar.
- **Calendário do Mac sem `status()`**: mostrar "Disponível" sem perguntar ao helper evita subir processo só por abrir a tela;
  o estado real da permissão fica na aba Email › Convites.
