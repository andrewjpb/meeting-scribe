---
tipo: plan
slug: arquitetura-seguranca
status: rascunho (aguarda aprovação da spec)
criado: 2026-11-20
semana: 2026-W47
---

# Plan — Arquitetura e segurança

Spec: `spec.md`. Caminhos relativos a `apps/desktop/`.
Os números de contrato (NN) são atribuídos na hora de escrever cada um, na sequência de
`docs/specs/desktop-shell/contracts/` (outras frentes estão criando contratos em paralelo).

## Decisões técnicas

- **T1 — Iframe `srcdoc` com `sandbox=""`** para o email (R1): sem script e sem mesma origem, o
  preload não existe lá dentro. Altura medida pelo pai não é possível sem same-origin; usar
  `sandbox="allow-same-origin"` **não** é aceitável. Solução: CSS no `srcdoc` + altura por
  `ResizeObserver` num wrapper com rolagem própria, ou medir num render oculto. Decidir no contrato com mockup.
- **T2 — Gesto no main, não no renderer** (R2): reaproveitar o token de clique do preload
  (`src/preload/index.ts:37-90`) e validar no `handle`.
- **T3 — `handle(channel, schema, fn)`** (R3): o esquema vira parâmetro obrigatório do wrapper em
  `src/main/ipc.ts`; tipos de `shared/ipc.ts` derivam do esquema quando possível. Migração por área
  para não gerar um diff único de ~197 canais.
- **T4 — Helper, não ORM** (R11): `storage/json-file.ts` resolve atomicidade, fila, validação,
  quarentena e migração. As interfaces dos stores não mudam. Um ORM (Drizzle/Kysely) só entra se
  um dia F1 for feito.
- **T5 — Formato em disco preservado** nas microtarefas de migração (N3); mudança de formato só em
  microtarefa própria, com migração (R15).
- **T6 — Composition root por área** (R16): `composition/{core,meetings,email,chat,integrations}.ts`,
  cada um recebe `dataDir` e as dependências explícitas, e devolve seus serviços.
- **T7 — Assinatura** (R5/R6): depende de D1. Com Developer ID: `codesign --options runtime` +
  `notarytool` no `scripts/pack.sh`; o updater confere Team ID. Sem: fuses + assinatura destacada
  (ed25519, chave pública no código, privada fora do repo).
- **T8 — Lint de arquitetura** (R12): `no-restricted-imports` no `eslint.config.mjs` com overrides
  por pasta; entra só no fim da onda 3, quando a lista de exceções é a real.

## Grafo de tarefas

| # | Microtarefa | Arquivos que toca | Depende de | Wave |
|---|---|---|---|---|
| S1 | Email em iframe isolado (R1) | `renderer/.../email/ReadingPane.tsx`, `sanitize.ts`, `main/security.ts`, smoke | mockup | 1 |
| S2 | Gesto em `claude-path-set` e `mcp-test` draft (R2) | `preload/index.ts`, `main/index.ts` (2 handlers), `claude-cli/service.ts`, `mcp/service.ts` | — | 1 |
| S3 | Token e Host nos servidores locais (R4) | `main/navegador/server.ts`, `main/meet/server.ts`, extensão | D3 | 1 |
| S4 | Quarentena de anexo, imagens remotas, pastas 0700, devTools, guard global (R7, R8, R10) | `main/index.ts` (anexo), `email/remote-images.ts`, `build/extendInfo.plist`, `window.ts`, `security.ts`, 6 stores (mkdir) | S2 (mesmo index.ts) | 2 |
| S5 | `pnpm audit` nos gates (R9) | `scripts/gates.sh`, lista de exceções | — | 1 |
| S6 | Wrapper IPC com esquema + lote 1 (email, convites) (R3) | `main/ipc.ts`, `shared/ipc.ts`, handlers de email | S2, S4 | 3 |
| S7 | IPC lotes 2 e 3 (reuniões, chat, config, WhatsApp, resto) | `main/index.ts`, serviços | S6 | 4–5 |
| S8 | Fuses + hardened runtime + notarização (R5) | `scripts/pack.sh`, `build/entitlements.plist`, `package.json` | D1 | 2 |
| S9 | Verificação de assinatura no updater (R6) | `main/updates/{download,service}.ts` | S8 | 3 |
| A1 | Helper `storage/json-file.ts` + testes (R11, R14, R15) | `main/storage/*` (novo) | — | 1 |
| A2 | Migrar stores pequenos: agents, schedules/runs, chat-events, batches, mcp | os 5 stores | A1 | 2 |
| A3 | Lock com fila; links/aceite do WhatsApp com fila (R13) | `lock/store.ts`, `whatsapp/service.ts` | A1 | 2 |
| A4 | Caches: insights, transcripts do WhatsApp, calendar-cache, drive-queue (assíncrono) (R13) | `whatsapp/{insights,transcripts}.ts`, `calendar/service.ts`, `google/drive-sync.ts` | A1 | 3 |
| A5 | Sub-stores de reunião: transcripts, summaries, notes, analyses | `meetings/*.ts` | A1 | 3 |
| A6 | Chat, corpus, sources, organize, assistant-tools (arquivos derivados) + índice do `chat.list` (R17) | `chat/*.ts`, `email/{organize,assistant-tools}.ts` | A1 | 4 |
| A7 | `meetings.json` com cópia em memória (R17) | `meetings/store.ts` | A5 | 4 |
| A8 | email-store, invites, settings | `email/email-store.ts`, `invites/store.ts`, `settings/store.ts` | A1 | 5 |
| A9 | Uniformizar quarentena e `version` em todos (R14, R15) | todos os stores + testes + smoke | A2–A8 | 6 |
| A10 | Composition root e `dataDir` (R16) | `main/index.ts`, `main/composition/*` (novo), `email/service.ts`, `invites/service.ts` | A8, S7 | 7 |
| A11 | Lint de arquitetura (R12) | `eslint.config.mjs` | A10 | 8 |
| C1 | Serviço de diagnóstico (R19): tamanhos, versões, quarentena, estado dos serviços | `main/system/*` (novo), `shared/ipc.ts` | A9, A10 | 8 |
| C2 | Tela Configurações › Sistema (R19) | `renderer/.../settings/*`, smoke | C1, mockup | 9 |
| C3 | Backup e restauração (R20) | `main/system/backup.ts`, tela Sistema | C2 | 10 |

Regras de wave: até 3 agentes por wave, sem arquivo em comum. `main/index.ts` é o gargalo: S2, S4,
S6, S7 e A10 nunca rodam juntos. Ondas, para relato: **onda 1 = S1–S5 (ataques reais)**,
**onda 2 = S6–S9 (IPC e distribuição)**, **onda 3 = A1–A11 (armazenamento)**, **onda 4 = C1–C3 (tela Sistema)**.

## Ganho por onda (estimativa da nota)

| Depois de | Nota | Por quê |
|---|---|---|
| hoje | 7 | base isolada, mas com caminho email → execução e sem camada de dados |
| onda 1 | 8 | caminho de execução fechado, servidores locais com segredo |
| onda 2 | 8,5 | IPC validado no registro, app assinado e atualização verificada |
| onda 3 | 9 | um só jeito de gravar, sem corrida, sem perda silenciosa, `index.ts` enxuto |
| onda 4 | 9+ | o usuário vê e controla dados e serviços, com backup |

## Gates desta feature

`SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` (8 passos; 9 depois de S5).
Toda microtarefa A* exige os testes de store existentes verdes **sem alteração** (exceto A9).
S1 exige passo novo de smoke com email hostil. S8 exige `codesign -dv` e leitura dos fuses no `pack.sh`.

## Riscos

- **Iframe do email** (S1) pode quebrar altura, seleção de texto, atalhos e o cartão de convite:
  por isso mockup e smoke dedicados.
- **Hardened runtime** (S8) pode quebrar captura de áudio, JIT e o ACP com `RunAsNode`: testar no
  `.app` empacotado antes de publicar; entitlements a ajustar.
- **Refatoração longa** (onda 3) colide com as outras frentes na `main`: fazer A1 primeiro (arquivo
  novo, sem conflito) e migrar um grupo por vez.
- **A8 (settings)** guarda senhas de email cifradas: migração com teste de ida e volta.

## Numeração dos contratos (atribuída em 2026-11-20; o maior em uso era o 83)

| Contrato | Microtarefa | Wave | | Contrato | Microtarefa | Wave |
|---|---|---|---|---|---|---|
| 84 | S1 email em iframe isolado | 1 | | 96 | A4 caches e disco assíncrono | 3 |
| 85 | S2 gesto nos canais que executam | 1 | | 97 | A5 sub-stores de reunião | 3 |
| 86 | S3 servidores locais com segredo | 1 | | 98 | A6 chat e arquivos derivados | 4 |
| 87 | S4 endurecimentos menores | 2 | | 99 | A7 meetings.json em memória | 4 |
| 88 | S5 pnpm audit nos gates | 1 | | 100 | A8 email, convites, settings | 5 |
| 89 | S6 wrapper IPC com esquema + lote 1 | 3 | | 101 | A9 quarentena e version uniformes | 6 |
| 90 | S7 IPC lotes 2 e 3 | 4–5 | | 102 | A10 composition root e dataDir | 7 |
| 91 | S8 fuses, hardened runtime, notarização | 2 | | 103 | A11 lint de arquitetura | 8 |
| 92 | S9 assinatura no updater | 3 | | 104 | C1 serviço de diagnóstico | 8 |
| 93 | A1 helper storage/json-file | 1 | | 105 | C2 tela Sistema | 9 |
| 94 | A2 stores pequenos | 2 | | 106 | C3 backup e restauração | 10 |
| 95 | A3 lock e WhatsApp com fila | 2 | | | | |

Contratos em `docs/specs/arquitetura-seguranca/contracts/NN-<nome>.md`. Se outra frente ocupar um
número antes do commit, renumerar aqui e nos arquivos.

## Ajustes de dependência depois dos contratos (20/11/2026)

- **87 depende também do 84** (a confirmação de link sai do `ReadingPane.tsx` e vai para diálogo nativo do main). Ordem da onda 1: 84 → 85 → 87.
- **87 entra antes do 94 e do 97** (os três mexem no `mkdir` dos mesmos stores).
- **96 toca uma linha de `index.ts`** (`await services.drive.ready()`), que o 89 também edita na wave 3: não rodar 96 e 89 juntos.
- **89/90 e 95** cruzam em `whatsapp/service.ts` (`spendClick`): 95 antes do lote 3 do 90.
- **98 ganhou `email/export.ts` e `whatsapp/export.ts`** na Superfície (o 103 exige).
- **102** cria `src/main/shell/` (fora do plano original) para chegar a 700 linhas no `index.ts`.
- **105 e o CA8 do 106** ficam bloqueados até o mockup da tela Sistema; **84** até o mockup da leitura em moldura.
- **`storage/` cresce** além do 93: `files.ts`, `invalid-log.ts`, `quarantine.ts`, `inspect.ts`, `archive.ts` (contratos 101, 104, 106).
