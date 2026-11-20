# Contrato 97 — Sub-stores de reunião pelo helper
Feature: arquitetura-seguranca · Wave: 3 · Depende de: 93 · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Migra os quatro arquivos por reunião em `userData/meetings/` para o `createJsonDir` do 93 (R11): a transcrição `<id>.json`, o resumo `<id>.summary.json`, as anotações `<id>.notes.json` e as análises `<id>.analyses.json`. São os arquivos mais lidos do app (corpus, Drive, Assistente, índice de reuniões) e o smoke grava vários deles por fora, com o app aberto: por isso **nenhuma cópia em memória**. Formato, quarentena e mensagens iguais (N1, N2, N3). `meetings.json` é do 99.

## Pré-condições
- Commit do 93 na branch (nomes do CA1 do 93: `createJsonDir`, `zodParse`, `quarantineTargets`, `serialQueue`).
- Conferir se o 87 (S4) já entrou: ele põe `mode: 0o700` no `mkdir` de `transcripts.ts:73`, `summaries.ts:39`, `notes.ts:51` e `analyses.ts:75`. O `write.mkdir` daqui repete **o que estiver no HEAD**. Se o 87 estiver aberto ao mesmo tempo, parar e avisar (mesmos arquivos).
- Ler antes: os quatro arquivos da Superfície, `src/shared/{transcription,meeting-summary-schema,meeting-notes-schema,meeting-analysis-schema}.ts` (as `version`), o contrato 93 e os testes das Invariantes.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/meetings/transcripts.ts` | `createFileTranscriptStore` sobre `createJsonDir` com quarentena `.corrupt-` (CA1) |
| `src/main/meetings/summaries.ts` | `createFileSummaryStore` sobre `createJsonDir` (CA2) |
| `src/main/meetings/notes.ts` | `createFileNotesStore` sobre `createJsonDir`; `keep` e `append` dentro de `run` (CA3) |
| `src/main/meetings/analyses.ts` | `createFileAnalysesStore` sobre `createJsonDir`; o `guard` dentro de `run` (CA4) |

Nenhum outro arquivo. `transcriptPath`, `summaryPath`, `notesPath`, `analysesPath`, `MEETINGS_DIR` e os sufixos continuam exportados com o mesmo comportamento (o corpus, o Drive e o smoke os usam).

## Critérios de aceite
Âncoras: os testes das Invariantes; "bytes iguais" = `cmp` entre o arquivo gravado no HEAD do 93 e depois, com o mesmo pedido, conferido pelo implementador e relatado.

Regras comuns aos quatro: `dir = join(dir, MEETINGS_DIR)`; `pathOf` = a função `*Path` de hoje (id fora de `^[\w-]+$` ou acima de 200 → `null`); `idOf` aceita só o próprio sufixo (`<id>.json` com `[\w-]+` para a transcrição, que por isso não pega `x.summary.json`; `<id>.summary.json`, `<id>.notes.json`, `<id>.analyses.json` para os outros); `indent: 2`; `cache` ausente (lê o disco a cada vez); **uma fila por store**, como hoje (o `queue` padrão de um `createJsonDir`); `write.mkdir` igual ao `mkdir` do HEAD; `serialize` devolve o objeto com as chaves na ordem de hoje.

- **CA1 — Transcrição.** `version: TRANSCRIPT_VERSION`, `parse = zodParse(documentSchema)` (o `names` continua cortado pelo `transform`), `readErrors: 'throw'` (erro que não é ENOENT continua lançando), quarentena `{ kind: 'rename', target: quarantineTargets.corruptIso, when: 'on-read', renameError: 'ignore' }` com o `now` do store, `onInvalid` com a mesma frase (`[transcripts] <arquivo> inválido; guardado como .corrupt-<stamp>`). `save` continua validando com `documentSchema.parse` (lança) e lançando `'id de reunião inválido'` antes de gravar. `remove` apaga sem erro se não houver arquivo.
- **CA2 — Resumo.** `version: SUMMARY_VERSION`, `parse(raw, id)` = `meetingSummarySchema` **e** `data.meetingId === id` (resumo de outra reunião copiado por cima não vale), erros de leitura valem ausente, quarentena `keep` (o arquivo fica; "Gerar resumo" o substitui), `onInvalid` com `[summaries] <arquivo> inválido; a reunião fica sem resumo`. `get` devolve `null` em ausente e inválido.
- **CA3 — Anotações.** `version: NOTES_VERSION`, `parse(raw, id)` = `meetingNotesFileSchema` e `meetingId === id`, quarentena `keep`, `onInvalid` com a frase de `[notes]` de hoje; `get` devolve `[]` em ausente e inválido. `save` com `keep` e `append` usam `run`: a leitura do que está no arquivo e a gravação acontecem na mesma vez da fila (a anotação de um agente que chega entre o pedido da tela e a gravação continua não se perdendo).
- **CA4 — Análises.** `version: ANALYSES_VERSION`, `parse(raw, id)` = `meetingAnalysesFileSchema` e `meetingId === id`, quarentena `keep`, `onInvalid` com a frase de `[analyses]`; `get` → `[]`. `save` e `add` usam `run`, com o `guard` chamado **dentro** da vez da fila, antes de gravar; `guard` falso → `null` e nenhum arquivo criado (nada de arquivo órfão depois de excluir a reunião). `add` corta em `ANALYSES_MAX` e substitui pelo mesmo id, como hoje.
- **CA5 — Formato.** Para cada um dos quatro, salvar a fixture do teste correspondente dá bytes idênticos ao HEAD do 93 (`cmp`), `0600`, e `readdirSync(meetings)` sem `*.tmp-*` depois de duas gravações seguidas (`test/transcripts-store.test.ts` "não deixa temporário para trás").
- **CA6 — Quarentena preservada.** Transcrição com `{` → `<id>.json.corrupt-<ISO>` (o teste "arquivo inválido vira .corrupt-<data>" passa sem mudança); resumo, anotações e análises inválidos **continuam no lugar** com os mesmos bytes, e o próximo salvar os substitui.
- **CA7 — Leitura de fora.** Um arquivo `meetings/x.summary.json` (ou `.notes.json`, ou `x.json`) escrito com `writeFileSync` depois de o store já ter lido aquela reunião é visto na leitura seguinte; apagado por fora, a leitura seguinte devolve ausente. (É o que o smoke faz, ver Invariantes.)
- **CA8 — Nenhuma cópia local.** `grep -nE "from 'node:fs|writeFile|readFile|rename\(|randomUUID|queue\.then" src/main/meetings/{transcripts,summaries,notes,analyses}.ts` vazio.

## Invariantes
- Testes verdes **sem alteração** (N3): `test/transcripts-store.test.ts`, `test/meeting-summary.test.ts`, `test/meeting-notes.test.ts`, `test/ai-notes.test.ts`, `test/meeting-analysis.test.ts`, `test/meeting-files.test.ts`, `test/meetings-overview.test.ts`, `test/meet-names.test.ts`, `test/automations-runner.test.ts`, `test/chat.test.ts`, `test/assistant.test.ts`, `test/acp.test.ts`, `test/acp-web.test.ts`, `test/email-organize.test.ts`, `test/email-assistant.test.ts`.
- Smoke sem alteração. Ele grava e apaga estes arquivos **por fora, com o app aberto**: `meetings/smoke-1.json` (`smoke.ts:1049`), resumos `<id>.summary.json` (`smoke.ts:1101`), `smoke-5.notes.json` (`smoke.ts:1114`), a transcrição e o resumo temporários do CA4c (`smoke.ts:2887-2903`), e lê a transcrição gravada (`smoke.ts:8009`) e a existência do resumo (`smoke.ts:5263`). Por isso nenhum dos quatro guarda cópia em memória (CA7).
- As quatro interfaces (`TranscriptStore`, `SummaryStore`, `NotesStore`, `AnalysesStore`, `WriteGuard`) e as opções de criação (`dir`, `now`, `keep`) iguais; `index.ts:931-937` sem diff.
- As quatro filas continuam independentes entre si (uma por store), como hoje; dentro de cada store, todas as reuniões numa fila só.
- Nenhum texto de transcrição, resumo ou anotação vai para log; só o caminho, como hoje.

## Fora de escopo
- `meetings.json` e a cópia em memória dele (99); quarentena `.corrupt-` em resumo, anotações e análises (101); pastas `0700` onde hoje não há modo (87); `.md`/`.m4a` exportados para a pasta da pessoa (`audio-files/*`, fora do helper).

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou).
- `git diff --stat` só com os quatro arquivos da Superfície; nenhum teste novo nem alterado; conferência de bytes do CA5 no relatório.
- Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **Q1 — 87 e 97 nos mesmos arquivos.** O plan põe o 87 (S4) na wave 2 e o 97 na wave 3, mas por numeração de feature diferente (onda 1 × onda 3); os dois mexem no `mkdir` das quatro sub-stores. A ordem segura é 87 antes do 97; ao contrário, o 87 passa a ser uma opção `write.mkdir: { mode: 0o700 }` em vez de uma edição no `mkdir`.
