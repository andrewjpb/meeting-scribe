---
status: aprovado
feature: pastas-assistente
tipo: plan
data: 2026-11-23
semana: 2026-W48
---

# Plan — pastas-assistente

Base: main `6079fec` (0.23.1 + contratos 159 e 160) · Spec: `spec.md` (aprovada pelo Andrew em 23/11/2026) · Contratos **165–169** · Branch/worktree: `pastas-assistente` em `~/Documents/GitHub/meeting-scribe-pastas-assistente` (merge na main no fim; a árvore principal está com a triagem 161–164 e o worktree `email-dashboard` com 155–158).

## Decisões técnicas

- D1. **Leitura por índice + ferramenta própria**, não `--add-dir`: `PASTAS.md` gravado a cada pergunta por `writeSources` e `ler_arquivo_pasta` (bloco `lap-ferramenta`, `media: true`) que copia/extrai um arquivo por vez para a pasta da conversa. O CLI continua `--restricted` sem `--add-dir`; o ACP continua recusando fora da pasta. Motivo: o Read do CLI não abre Word/planilha, `--add-dir` não controla tipo/tamanho/ocultos, e a ferramenta própria entra no `mediaSeen` e no orçamento por pergunta.
- D2. **Nome das cópias: `Midia - Pasta - <hash16>.<ext>`**, reaproveitando `mediaFileName`/`isMediaFile`/`clearMediaFiles`/`MEDIA_READ_LABELS` de `media-files.ts` com uma terceira origem (`'Pasta'`) em vez de um prefixo novo. Assim a limpeza (`corpus.ts:481`, fonte desligada, conversa apagada) e a recusa de ações pós-leitura valem sem código paralelo.
- D3. **Ids resolvidos só pelo main**: `hash16 = sha256(folderId + "\n" + relPath)` calculado em `main/chat/folders.ts`; o main guarda, por conversa, o último índice (`Map<id, FolderFileEntry>`); ferramenta, citação "Abrir" e cartão resolvem **só** por esse mapa e reconferem `realpath` dentro da pasta permitida + `stat` antes de qualquer leitura. Texto do modelo nunca vira caminho.
- D4. **Word por `textutil`** (`/usr/bin/textutil -convert txt -stdout`, `execFile` sem shell, timeout 20 s, saída cortada em 20.000 caracteres). **Planilha por leitor próprio** `main/chat/xlsx-text.ts` (zip lido a partir do diretório central com `zlib.inflateRawSync`, `sharedStrings.xml`, `sheetN.xml` → tabela por aba; valores em cache, sem fórmulas). Sem dependência nova (licença e tamanho do app).
- D5. **Lista de pastas em `settings.assistant.folders`**, gravada só pelo main depois do diálogo nativo (`scribe:assistant-folder-add` / `-remove`). O patch do renderer pode carregar `folders` (ele manda o objeto inteiro), mas o serviço **ignora** o valor e mantém o atual (molde de `audioFolder`). Regras de recusa (`folderRefusal`) puras e testadas.
- D6. **Fonte `pastas` por conversa**, desligada por padrão (`CHAT_SOURCES_OFF_BY_DEFAULT`); lista vazia = linha desabilitada no Contexto e `PASTAS.md` não gravado.
- D7. **Cartão `email-resposta` estendido**, não cartão novo: `attachments[]` e `missing[]` com `.default([])` (cartões antigos continuam válidos); com anexos, o botão Enviar some e entra **Abrir no Composer** (`scribe:chat-action-email-compose` devolve o rascunho com bytes lidos por `readEmailAttachments`; renderer `openDraft` + navega). Bytes nunca passam por `history.state`. Estado novo `'opened'`.
- D8. **Citação clicável** pelo esquema `pasta:<16 hex>` (`folderFileIdOfLink` em `shared/chat.ts`, botão em `ChatMarkdown.tsx`, `scribe:assistant-folder-reveal` → `FileOpener.reveal`). Primeira citação clicável do app; `[Email · …]`/`[WhatsApp · …]` ficam como estão.
- D9. **Smoke com pasta sintética** criada em código no userData temporário (PDF, docx e xlsx mínimos gerados por função, txt, oculto, arquivo grande esparso); `detail` só números e booleanos; o agente falso ganha scripts para `ler_arquivo_pasta`, cartão com `anexos`/`faltando` e citação `pasta:`.

## Grafo de tarefas

| # | Microtarefa | Arquivos | Depende de | Wave |
|---|---|---|---|---|
| 165 | Dados, regras e índice: `AssistantFolder` + settings; `folderRefusal`, `fileKindOf`, `scanFolders`, `renderPastasIndex`, resolver por conversa; fonte `pastas` em `shared/chat.ts`; `PASTAS.md` em `writeSources`; origem `'Pasta'` em `media-files.ts`; canais `scribe:assistant-folder-add`/`-remove` + handlers + fixture; testes | `shared/assistant-folders.ts` (novo), `main/chat/folders.ts` (novo), `shared/chat.ts`, `shared/settings-defaults.ts`, `main/settings/schema.ts`, `shared/settings-index.ts`, `main/chat/sources.ts`, `main/chat/corpus.ts`, `main/chat/media-files.ts`, `main/claude-cli/chat.ts` (só `sourceLabel`), `shared/ipc.ts`, `main/index.ts`, `main/smoke-fixtures.ts`, `test/*` | — | 1 |
| 166 | Ferramenta `ler_arquivo_pasta` (PDF/imagem por cópia, Word por `textutil`, planilha por `xlsx-text.ts`, texto), `mediaSeen`, instrução de sistema (fonte, citação, ferramenta, material), citação `pasta:` + botão Abrir + `scribe:assistant-folder-reveal`; testes | `main/chat/folder-tools.ts` (novo), `main/chat/xlsx-text.ts` (novo), `main/chat/tools.ts`, `main/chat/media-files.ts`, `main/claude-cli/chat.ts`, `shared/chat.ts`, `renderer/.../chat/ChatMarkdown.tsx`, `shared/ipc.ts`, `main/index.ts`, `test/*` | 165 | 2 |
| 167 | Telas: seção "Pastas que o Assistente pode ler" em Configurações › Claude (lista, Adicionar pasta…, Remover, aviso de recusa; sem contagem de arquivos nesta versão); linha Pastas no painel Contexto (ligada/vazia); conforme mockups 01–03 | `renderer/.../settings/SettingsScreen.tsx`, `renderer/.../chat/SourcesSection.tsx`, hooks/stores do renderer que esses dois usam, `shared/settings-index.ts` (texto), `test/*` | 165; mockups aprovados | 2 |
| 168 | Cartão `email-resposta` com anexos e faltantes, resolver por índice e limites, `scribe:chat-action-email-compose`, estado `opened`, `openDraft` + navegação, regra de e-mail com documentos na instrução; conforme mockups 05–07; testes | `shared/assistant.ts`, `main/chat/actions.ts`, `main/chat/store.ts`, `shared/ipc.ts`, `main/index.ts`, `main/claude-cli/chat.ts`, `renderer/.../chat/ActionCards.tsx`, `renderer/.../email/emailStore.ts` (só se `openDraft` precisar de `skippedAttachments`), `test/*` | 166 | 3 |
| 169 | Smoke `pastasChecks` + pasta sintética + scripts do agente falso + telas em `SCREENS`; README, guia do app, design.md, docs/telas (artboards + canvas.json), `auditoria-prints.md`, `notas-release.md`, "Pendências" aqui | `main/smoke.ts`, `main/smoke-fixtures.ts`, `test/fixtures/fake-acp-agent.mjs`, `README.md`, `apps/desktop/resources/assistente/guia-do-app.md`, `docs/specs/desktop-shell/design.md`, `docs/telas/*`, `docs/specs/pastas-assistente/*` | 167, 168 | 4 |

Waves: 1 = {165}; 2 = {166, 167} (sem arquivo em comum: 166 é main + `shared/chat.ts` + `ChatMarkdown.tsx`; 167 é `SettingsScreen.tsx` + `SourcesSection.tsx`); 3 = {168}; 4 = {169}. Teto de 2 agentes por wave; wave 2 em paralelo na mesma árvore (worktree desta frente) com a lista de arquivos de cada um no contrato.

## Gates desta feature

- Por contrato: `pnpm --filter desktop typecheck && pnpm --filter desktop lint && pnpm --filter desktop test` (da raiz do worktree).
- Gate completo `pnpm gates` da raiz (smoke ~25 min, tela do Mac desbloqueada, nada pesado em paralelo) ao fim da wave 2 e obrigatoriamente no 169.
- Regra do `detail` do smoke: só números, booleanos e textos fixos; nunca nome de arquivo real, conteúdo de arquivo ou de e-mail. Fixtures sintéticas.
- Revisor cego por contrato (recebe só diff + contrato); uma devolução no máximo; commit só pelo agente `git-commit`, na branch `pastas-assistente`.
- Fechamento: merge na main (revisar à mão `index.ts`, `ipc.ts`, `actions.ts`, `ActionCards.tsx`, `shared/assistant.ts`, `Composer.tsx` se a triagem ou o painel de e-mail tiverem entrado antes), versão pelo `release.sh`, spec para `_archive/`, cofre.

## Ambiguidades resolvidas

- "Limite da conta" (brief): não existe limite por conta; vale o limite global do app (20 MB, 10 arquivos). Anotado na spec R6.
- Citação: `[Pasta · <Pasta>/<caminho>](pasta:<id>)` — o texto visível segue o padrão `[Fonte · …]` das outras fontes; o link é o que vira botão.
- Word `.doc` e `.rtf`/`.odt`: `textutil` abre os três; ficam como legíveis. `.pages`/`.numbers`/`.key`: só anexo.

## Pendências

- Contagem "N arquivos legíveis · M só para anexo" na lista de pastas das Configurações (mockup 01): fica para uma versão seguinte; precisaria de varredura ao abrir a aba.
(demais preenchidas no fechamento)
