# Contrato 28 — Pastas de reuniões + gravação em andamento na lista
Feature: desktop-shell · Wave: 28 · Depende de: 07 (meetings), 19 (gravação) · PRD: `docs/specs/desktop-shell/prd-pastas-de-reunioes.md`

## Pré-condições (fatos do código, conferidos em 18/11/2026 — a árvore tem o contrato 27 NÃO commitado; construir por cima dela sem tocar nos arquivos do Meet)
- Tela da lista: `MeetingsScreen` (`apps/desktop/src/renderer/src/features/meetings/MeetingsScreen.tsx:20`); grupos por dia via `groupByDay` (`features/meetings/format.ts:87`); linha `MeetingRow.tsx:42` — a linha INTEIRA é `<Link to={meetingPath(id)} data-meeting={id}>`. Dados do hook `useMeetingsOverview` (`useMeetingsOverview.ts:32`, invoke `scribe:meetings-overview`), sem store zustand; busca em `useMeetingsSearch` (:97, global).
- Tipo `Meeting` em `src/shared/meetings.ts:29` (`id,title,startedAt,durationMs,sources,audioPath,transcriptPath,calendar?`); `MEETING_TITLE_MAX=200` (:52). Persistência: arquivo único `userData/meetings.json`, `meetingSchema`/`fileSchema {version: literal(1)}` em `src/main/meetings/store.ts:34-46`, fila serial + escrita atômica (:82-114); `MeetingsStore {list,get,create,rename,remove,setFiles}` (:59). Serviço em `src/main/meetings/service.ts`.
- IPC: canais meetings em `src/shared/ipc.ts:52-60`, `INVOKE` :387, `WHEN_LOCKED` :584 (meetings `'refused'`, create `'session'`); todo canal novo precisa de política (teste `test/lock-ipc.test.ts:74`). Main registra com `handle(channel, appOrigin, fn)` em `registerIpc` (`src/main/index.ts:1096`); `touched(id)` (:1067) sincroniza o corpus do chat.
- Gravação em andamento: `useRecording` (`features/live/recordingStore.ts`, zustand) — `session !== null` = gravando (padrão de uso: `CalendarBanner.tsx:14`); `title`, `startedAt`; fase em `capture.phase`; tempo via `useElapsed(session?.clock ?? null, phase==='recording')` (`features/live/useElapsed.ts:5`) + `formatElapsed`; indicador vermelho pulsante: `STATUS`/`RecordingStatus` em `LiveScreen.tsx:149-170` (`bg-rec rec-pulse`, `text-rec`). Rota da gravação: `/gravacao` (`src/shared/routes.ts`, `app/routes.tsx:30`).
- Menu em linha: único padrão existente é o dropdown inline do `ChatRow` (`features/chat/ChatScreen.tsx:97-217`): botão `MoreHorizontal` `aria-haspopup="menu"`, container `role="menu" absolute top-full right-2 z-10 … rounded-[var(--radius-control)] border border-line-strong bg-bg-raised py-1`, item `MENU_ITEM` (:94), navegação por setas/Home/End, fecha no blur, perigoso em `text-rec`. Botão dentro da linha-link fica FORA do `<a>` (como no ChatRow) ou usa `preventDefault`.
- Design: `src/renderer/src/design/` (`Button`, `Icon` lucide 16/14px traço 1.5, `Segmented`, `Tabs`, `PageHeader`, `EmptyState`, `Field`).
- Smoke: `seedMeetings` (`src/main/smoke.ts:830`) e `seedListMeetings` (:884) escrevem `meetings.json` `{version:1,meetings}` direto (:842, :896); seletores `LIST_ROWS` (:942) e `LIST_GROUPS` (:949); checks `meetingsListCheck` (:952) e `meetingsSearchCheck` (:988); em `runSmoke`, `meetingsList` (:6040), passo "5. Lista…" (:6214-6231), obrigatórios `['list','listDark','search']` (:6433).
- Testes: `test/meetings-store.test.ts` (CRUD, rename preserva calendar, doc antigo, escrita atômica), `test/meetings-overview.test.ts`, `test/renderer/meetings-format.test.ts`, `test/lock-ipc.test.ts`.

## Critérios de aceite

### CA1 — Modelo e persistência (compatível, sem migração)
- `src/shared/meetings.ts`: tipo novo `MeetingFolder { id: string; name: string }`, `FOLDER_NAME_MAX = 60`; `Meeting` ganha `folderId?: string | null` (opcional). `NewMeeting` NÃO muda.
- `store.ts`: `fileSchema` continua `version: 1` e ganha `folders` opcional (default `[]`); `meetingSchema` aceita `folderId` opcional/nullable (rename/setFiles não o perdem — mesmo cuidado do `calendar`). Arquivo antigo sem os campos continua carregando; nomes de pasta `trim` + corte em 60; pasta sem nome não é criada.
- `MeetingsStore` ganha: `folders(): MeetingFolder[]`, `createFolder(name)` → `MeetingFolder`, `renameFolder(id,name)` → `MeetingFolder|null`, `deleteFolder(id)` → `boolean` (reuniões da pasta ficam com `folderId: null`; nenhuma reunião é apagada), `move(id, folderId: string|null)` → `Meeting|null` (`folderId` inexistente → recusa com `null`). Tudo pela mesma fila serial e escrita atômica.

### CA2 — IPC
- Canais novos em `src/shared/ipc.ts` + `INVOKE` + `WHEN_LOCKED` (todos `'refused'`): `scribe:folders-list` → `MeetingFolder[]`; `scribe:folders-create {name}` → `MeetingFolder|null`; `scribe:folders-rename {id,name}` → `MeetingFolder|null`; `scribe:folders-delete {id}` → `boolean`; `scribe:meetings-move {id, folderId: string|null}` → `Meeting|null`.
- Handlers em `registerIpc` (`src/main/index.ts`), validação zod dos payloads como nos canais vizinhos. `scribe:meetings-overview` passa a expor o `folderId` de cada reunião (ele já viaja dentro de `meeting`; garantir que não é filtrado) e NÃO muda de assinatura.

### CA3 — Barra de pastas na lista
- Em `MeetingsScreen`, abaixo do `PageHeader` e acima de "Próximas": barra horizontal com "Todas" + uma opção por pasta (nome + contagem de reuniões) + botão "Nova pasta" (ícone `FolderPlus` ou `Plus`, abre campo inline para o nome; Enter cria, Esc cancela). Sem pasta criada, a barra mostra só "Todas" + "Nova pasta".
- Selecionar pasta filtra a lista (filtro no renderer sobre as linhas do overview, por `folderId`); "Todas" volta ao comportamento atual. A seleção NÃO persiste entre sessões. Grupos de dia e totais continuam funcionando dentro do filtro. Pasta selecionada vazia → `EmptyState` "Nenhuma reunião nesta pasta".
- Com uma pasta selecionada, ações "Renomear" e "Excluir pasta" acessíveis (menu "⋯" na própria opção selecionada, padrão ChatRow: renomear inline, confirmação inline para excluir; texto deixa claro que as reuniões não são apagadas). Visual: usar `Segmented`/`Tabs` ou chips coerentes com o design system; dark ok; marcar a barra com `data-folders` e cada opção com `data-folder="<id>"` (Todas: `data-folder="all"`).
- A busca (⌘F) continua global: com termo ativo, a barra some ou desabilita (como "Próximas" já some na busca).

### CA4 — Mover reunião pela linha
- Cada linha ganha botão "⋯" (`MoreHorizontal`, fora do `<a>` ou com `preventDefault`, padrão ChatRow) com menu "Mover para…": lista as pastas, "Fora de pasta" (quando está numa) e "Nova pasta…" (campo inline; cria e já move). Mover chama `scribe:meetings-move` e a lista reflete sem recarregar a tela (atualizar o estado do hook). Marcar o botão com `data-meeting-menu`.
- Na linha, quando a reunião está numa pasta e o filtro é "Todas", mostrar o nome da pasta discreto na linha de meta (ex.: `· Cliente X`, `text-12 text-text-muted`).

### CA5 — Gravando agora na lista
- Em `MeetingsScreen`, quando `useRecording((s) => s.session !== null)`: cartão acima de tudo (inclusive do EmptyState e de "Próximas") com o ponto vermelho pulsante (`bg-rec rec-pulse`), "Gravando agora", o título da gravação e o tempo decorrido ao vivo (`useElapsed` + `formatElapsed`); clique navega para `/gravacao`. Marcar `data-recording-now`. Aparece também com busca ativa e com pasta selecionada. Dark ok.

### CA6 — Segurança e invariantes
- Nada de rede nova; nomes de pasta são dado (zod, corte 60), nunca instrução; se nome de pasta entrar em prompt de IA algum dia, não é deste contrato. `prova/` não muda. Contratos 01–27 continuam passando; NÃO tocar em `extensions/`, `src/main/meet/`, `meetStore.ts` (contrato 27 pendente de teste na mesma árvore).

### CA7 — Testes e smoke
- Vitest: em `meetings-store.test.ts` (ou arquivo novo `meetings-folders.test.ts`): criar/renomear/excluir pasta; excluir pasta zera `folderId` sem apagar reunião; mover para pasta inexistente recusa; arquivo antigo sem `folders` carrega; rename/setFiles preservam `folderId`; nome cortado em 60. `lock-ipc.test.ts` cobre os canais novos. Renderer: filtro por pasta sobre linhas de overview (função pura, se houver).
- Smoke: check novo `meetingsList['folders']` no passo 5 (entra nos obrigatórios junto de `['list','listDark','search']`): criar pasta "Cliente X" pela UI, mover smoke-1 pelo menu da linha, selecionar a pasta → só smoke-1 aparece; "Todas" → tudo volta e a linha de smoke-1 mostra "Cliente X". Check `meetingsList['recordingNow']`: durante a gravação curta que o smoke já faz, navegar à lista e conferir `[data-recording-now]` com o tempo andando; clique volta a `/gravacao`. Sem PNG novo obrigatório.

## Fora de escopo
- Subpastas; arrastar e soltar; cor/ícone de pasta; busca por pasta; persistir a pasta selecionada; pastas no WhatsApp/Drive/automações.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.

## Telas de impacto no usuário
- Reuniões (lista): cartão "Gravando agora"; barra de pastas; menu "⋯" nas linhas; nome da pasta na meta da linha.

## Notas do coordenador
- NÃO commitar. ATENÇÃO: o app pode estar rodando em `pnpm dev` com gravação ao vivo do Andrew — antes de editar qualquer arquivo, confirmar com o coordenador que o dev parou (editar `src/main/**` reinicia o app e mataria a gravação dele).
