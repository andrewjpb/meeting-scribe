# Contrato 98 — Conversas, acervo e arquivos derivados pelo helper; índice do `chat.list`
Feature: arquitetura-seguranca · Wave: 4 · Depende de: 93 · Spec/Plan: `docs/specs/arquitetura-seguranca/spec.md`, `plan.md` (RASCUNHO, aguardam aprovação)

Fecha a parte do chat de R11 e de R17. `chats/<id>.json` passa pelo `createJsonDir` do 93, e os quatro `writeAtomic` locais que gravam os `.md` que o agente lê (`chat/corpus.ts:269`, `chat/sources.ts:221`, `email/organize.ts:141`, `email/assistant-tools.ts:75`) dão lugar ao `writeAtomic` do helper. `chat.list` deixa de ler e parsear todos os `chats/*.json` a cada chamada (`chat/store.ts:395-408`): passa a usar um índice em memória validado por `stat`, porque o smoke troca a pasta `chats/` por fora com o app aberto. Formato igual (N1, N3); **os links físicos do acervo para `chat-scope/` continuam funcionando**.

## Pré-condições
- Commit do 93 na branch (nomes do CA1 do 93: `createJsonDir`, `writeAtomic`, `ensureDir`, `zodParse`).
- Ler antes: `src/main/chat/store.ts` (inteiro), `src/main/chat/corpus.ts:1-20, 225-370` (`placeFile`, `sameFile`, `ensureDir`, `writeAtomic`, `writeScopeIndex`, `refreshScopes`, `writeMeeting`, `writeIndex`), `src/main/chat/sources.ts:215-290`, `src/main/email/organize.ts:138-146`, `src/main/email/assistant-tools.ts:70-80`, `src/main/smoke.ts:8722-8756` (`withLevelChats`), o contrato 93 e os testes das Invariantes.

## Superfície (caminhos relativos a `apps/desktop/`)
| Arquivo | O que muda |
|---|---|
| `src/main/chat/store.ts` | `createFileChatStore` sobre `createJsonDir` (CA1) e índice do `list` (CA2) |
| `src/main/chat/corpus.ts` | `writeAtomic` e `ensureDir` locais saem; os do helper (CA3, CA4) |
| `src/main/chat/sources.ts` | `writeAtomic` local sai; o do helper com `skipIfUnchanged` (CA5) |
| `src/main/email/organize.ts`, `src/main/email/assistant-tools.ts` | `writeAtomic` local sai; o do helper (CA6) |
| `src/main/email/export.ts`, `src/main/whatsapp/export.ts` | idem: `writeAtomic`/`writeFileAtomic` local sai; o do helper (CA6). Acrescentados pelo coordenador em 20/11/2026: o contrato 103 exige estes dois migrados |

Nenhum outro arquivo: `chat/service.ts`, `index.ts`, testes e `smoke.ts` sem diff.

## Critérios de aceite
Âncoras: os testes das Invariantes e um script descartável do implementador (fora do repo, saída no relatório) para o CA2 e o CA7.

- **CA1 — `chats/<id>.json`.** `createJsonDir` com `dir = join(dir, CHATS_DIR)`, `pathOf` = o de hoje (`chatIdSchema`), `idOf` = `^[\w-]{1,100}\.json$` sem o sufixo, `parse(raw, id)` = `chatSchema` (com os `.default` de hoje para arquivos dos contratos 15–17) **e** `data.id === id`, sem `version` (o arquivo não tem), erros de leitura valem ausente, quarentena `keep` (inválido some da lista, sem aviso), `indent: 2`, `write.mkdir: { mode: 0o700, chmod: true }` (o `mkdir` + `chmod(folder, 0o700)` de hoje). `save` aplica `clampChat` e `chatSchema.parse` antes do `write` e continua lançando `'id de conversa inválido'`; `mutate` é um `update` que lança `'id de conversa trocado'` como hoje; `remove` devolve o boolean do `remove` do helper.
- **CA2 — Índice do `list` (R17).** O store guarda `Map<id, { ino, mtimeMs, size, item: ChatListItem | null }>`. Cada `list()`, dentro da fila: `entries()` do helper; para cada entrada cuja assinatura (`ino`, `mtimeMs`, `size`) é igual à guardada, usa o `item` guardado (inclusive `null` = inválido) **sem ler o arquivo**; as demais são lidas e parseadas; ids que sumiram saem do mapa. `save`, `mutate` e `remove` apagam a entrada do id (a próxima lista relê só ele). Ordem e conteúdo do resultado iguais aos de hoje (`updatedAt` decrescente). Nada é gravado em disco para o índice (N1). Prova observável, no script: (a) 50 conversas, `list()` duas vezes → mesmo resultado; (b) reescrever um `chats/<id>.json` **no lugar** com outro título do mesmo tamanho e restaurar o `mtime` com `utimesSync` → a terceira `list()` ainda mostra o título antigo (não releu); (c) trocar o arquivo por um novo (`rm` + `writeFileSync`) → a quarta mostra o novo; (d) renomear `chats/` e criar outra pasta com 3 conversas, como `withLevelChats` → a lista mostra só as 3.
- **CA3 — Acervo e links físicos.** Em `corpus.ts`, `writeMeeting` e `writeIndex` gravam com `writeAtomic(path, content)` do helper (temporário + `rename`, **sem** `skipIfUnchanged`): cada gravação continua criando um inode novo, que é o que faz `refreshScopes`/`refreshScope` (via `sameFile`) perceberem a mudança e refazerem o link em `chat-scope/<id>/`. `placeFile` (`link` com volta para `copyFile` + `chmod 0600`) e `sameFile` ficam como estão. Depois de mudar o resumo de uma reunião que está numa pasta de escopo: o `.md` da pasta tem o mesmo `ino` do `.md` novo do acervo e o conteúdo novo.
- **CA4 — Pastas do acervo.** O `ensureDir` local vira `ensureDir(path, { mode: 0o700, chmod: true })` do helper: `chat-corpus/` e `chat-scope/<id>/` `0700` mesmo quando já existiam com outro modo; arquivos `0600`. `writeScopeIndex` usa `writeAtomic(file, content, { skipIfUnchanged: true })` no lugar de "ler, comparar, gravar, `chmod`": índice igual não é regravado (o inode fica), diferente é.
- **CA5 — Fontes do Assistente.** Em `sources.ts`, `writeAtomic(path, content, { skipIfUnchanged: true })`: `ESTADO`, guia e automações iguais não são regravados (o teste de inode de `test/assistant.test.ts:955-987` passa sem mudança); diferentes, sim, `0600`.
- **CA6 — Email do Assistente.** Em `organize.ts` (`EMAIL_CONVERSATIONS_FILE`, `EMAIL_FOLDERS_FILE`, `EMAIL_MOVE_FILE`) e `assistant-tools.ts` (`EMAIL_SEARCH_FILE`, o `.md` de cada mensagem e o da conversa), `writeAtomic(path, content)` do helper: mesmos bytes, `0600`, sempre regravado (como hoje, sem `skipIfUnchanged`).
- **CA7 — Formato.** `cmp` igual entre HEAD do 93 e depois para: um `chats/<id>.json` gravado por `save` com a fixture de `test/chat.test.ts:500`; o `INDICE.md` e um `.md` de reunião do acervo depois de `rebuild`; o `INDICE.md` de uma pasta de escopo.
- **CA8 — Nenhuma cópia local.** `grep -nE "function writeAtomic|function ensureDir|\.tmp-|writeFile\(|rename\(" src/main/chat/{store,corpus,sources}.ts src/main/email/{organize,assistant-tools}.ts` vazio; `grep -n "node:fs" src/main/chat/store.ts` vazio. Em `corpus.ts` ficam só `copyFile`, `link`, `readdir`, `readFile`, `rm`, `stat` (do 103). Em todo `src/main`, `grep -rn "function writeAtomic" src/main` só acha `storage/json-file.ts` e `email/email-store.ts` (este sai no 100).

## Invariantes
- Testes verdes **sem alteração** (N3): `test/chat.test.ts` (inclusive `0700`/`0600` das linhas 422-466 e 500-526: arquivo `{`, cópia com outro id e papel inválido ficam fora da lista), `test/assistant.test.ts` (links físicos e inodes, linhas 955-1060), `test/acp.test.ts`, `test/acp-web.test.ts`, `test/mcp.test.ts`, `test/whatsapp.test.ts`, `test/email-organize.test.ts`, `test/email-assistant.test.ts`, `test/email-automations.test.ts`, `test/email-folders.test.ts`.
- Smoke sem alteração. Ele lê `chats/*.json` direto (`readChatFiles`, `smoke.ts:532-538`), **troca a pasta `chats/` inteira com o app aberto** no contrato 67 (`withLevelChats`, `smoke.ts:8722-8756`: "o main lê a pasta a cada lista") e apaga `chat-corpus/` para ver o acervo ser refeito (`smoke.ts:605-606`). O CA2 (d) e o `stat` por lista existem por causa disso: um índice só em memória, sem `stat`, quebraria esse passo.
- O acervo nunca grava no lugar: todo `.md` do acervo nasce por `rename` (link simbólico continua proibido; a pasta da conversa é tudo o que o agente lê).
- `ChatStore`, `ChatCorpus`, `writeSources`, `CHATS_DIR`, `CHAT_CORPUS_DIR`, `CHAT_SCOPE_DIR`, `CHAT_INDEX_FILE` iguais.
- Nenhum texto de conversa, reunião ou email vai para log.
- Quarentena, preservada até o 101: conversa inválida não renomeia, só some da lista.

## Fora de escopo
- `version` e quarentena `.corrupt-` em `chats/` (101); índice gravado em disco; `chat-events.json` (94); `meetings.json` (99); `email-store.ts` (100); os demais `fs` do corpus (`link`, `copyFile`, `readdir`, `rm`, `stat`), que entram na lista de exceções do 103.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde (8 passos; 9 se o 88 já entrou), com atenção ao passo do contrato 67 no smoke.
- `git diff --stat` só com os cinco arquivos da Superfície; nenhum teste novo nem alterado; saída do script do CA2 e do CA7 no relatório.
- Sem commit: quem coordena commita pelo agente de commits.

## Dúvidas para o coordenador
- **Q1 — "Índice" do R17.** A spec não diz se o índice é em disco ou em memória. Escolhido em memória com `stat` (CA2): um arquivo `chats/index.json` seria formato novo (N1 pede migração) e ficaria desatualizado quando o smoke troca a pasta. Custo: um `readdir` e um `stat` por conversa a cada lista, contra ler e parsear todas.
