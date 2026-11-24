---
status: aprovada
feature: pastas-assistente
tipo: analise
data: 2026-11-23
semana: 2026-W48
---

# Análise — pastas-assistente

Levantamento feito em 23/11/2026 (Explore em Opus + prova do Claude CLI 2.1.330 instalado). Caminhos relativos a `apps/desktop/src/`.

## O que o Andrew quer (caso real)

"Em uma pasta tenho todos os documentos da LAP, e no email o Michel quer alguns documentos, porém alguns eu já tenho; daria permissão para a IA nessa pasta específica para ela analisar os documentos que tenho e anexar a um email e responder o Michel, analisar documentos também que ele pediu; quero resolver tudo pelo sistema."

Três capacidades: (1) o Assistente lê pastas escolhidas do Mac, só leitura; (2) ao ler um e-mail que pede documentos, cruza o pedido com o que existe e propõe a resposta com os anexos prontos; (3) analisa documentos da pasta ou anexos do e-mail.

## Como o Assistente funciona hoje

- **CLI** (`main/claude-cli/chat.ts:247`): `-p --model … --input-format/--output-format stream-json`, `--tools Read,Grep,Glob`, `--disallowedTools Bash Edit Write …`, `--permission-mode dontAsk`, **`--restricted`**, `--setting-sources ""`, `--strict-mcp-config --mcp-config '{"mcpServers":{}}'`. `cwd` = `userData/chat-scope/<chatId>/`. O ACP (`main/acp/agent.ts:318-345`) recusa leitura fora da pasta por `realpath`.
- **Fontes** (`main/chat/sources.ts:477` `writeSources`): um `.md` por fonte ligada, gravado a cada pergunta com `writeAtomic` (0600); interruptor por conversa em `ChatScope.sources` (`shared/chat.ts:112`), tela `features/chat/SourcesSection.tsx`. Nenhuma fonte tem par nas Configurações.
- **Ferramentas próprias** (contrato 149): bloco ```` ```lap-ferramenta ```` com JSON; `toolCallOf()` valida com zod (`main/chat/tools.ts:78`); `tool.run()` grava o resultado num arquivo da pasta e o modelo lê com Read (`service.ts:519-558`, até 4 rodadas, ferramentas de mídia elevam para 12). Interface `AssistantTool {name, describe, pending, step, run, changes?, rounds?, creates?, media?}`.
- **Mídia**: `ler_anexo_email` (`main/email/assistant-tools.ts:330-459`) grava `Midia - Email - <hash16>.pdf|png|md` (0600) e **quem lê o PDF e a imagem é o Read do CLI**; texto vira `.md` com `quotedMaterial` até 20.000 caracteres; **Word, Excel, PowerPoint recusados**. Limites em `shared/assistant.ts:31-40` (8 mídias por pergunta via `createMediaBudget`, 20 MB imagem/PDF). Depois de uma mídia, ferramentas com `changes`/`creates` são recusadas (`mediaSeen`, `service.ts:479-543`); cartões `lap-acao` não são bloqueados porque exigem clique.
- **Citações**: `[Email · …]` e `[WhatsApp · …]` são texto puro. Só `meeting:<id>` (`shared/chat.ts:339`) vira botão em `ChatMarkdown.tsx:30-45`; `https` vira botão com confirmação. `shell.openPath/showItemInFolder` existem em `main/index.ts:2435` (`FileOpener`, substituído no smoke por `openedFiles`).
- **Cartões**: ```` ```lap-acao ```` → `extractActions` (`main/chat/actions.ts:864`) → `proposedSchema` (zod, `:156`) → `resolve()` lê do cache do app, nunca do texto (`:786` para `email-resposta`). `EmailReplyAction` (`shared/assistant.ts:219`) não tem anexos; `EmailReplyCard` (`ActionCards.tsx:493-602`) envia direto por `emailSend` com token de clique. **"Abrir no Composer" não existe**; o mais perto é `EmailNavigationState.compose {to, subject}` (`shared/routes.ts:101`) e `useEmail.openDraft(draft)` (`emailStore.ts:458`).
- **Composer**: `ComposeDraft.attachments: EmailOutgoingAttachment[] {name, bytes: Uint8Array}`; anexar = `scribe:email-attach-pick` (diálogo nativo) + `readEmailAttachments(paths)` (`main/email/attach.ts`). Envio `EmailSendRequest {…, attachments?, clickToken}`; `sendSchema` (`main/email/service.ts:252`) exige ≤ 10 arquivos e ≤ 20 MB somados (`EMAIL_ATTACH_MAX_*`, `shared/email.ts:240`). **Não há limite por conta.** Token de clique: `navigator.userActivation.isActive` no preload (`preload/index.ts:75-91`), uso único no main (`createEmailClickGuard`).
- **Configurações › Claude**: `panel('claude')` em `SettingsScreen.tsx:380`, seção "Chat e resumo" com `assistant.media` (`:432`). `AssistantSettings` em `shared/settings-defaults.ts:85`; `assistantPatchSchema`/`lenientAssistantSchema` `.strict()` só com `media` (`main/settings/schema.ts:166`). Precedente de caminho escolhido só pelo main: `audioFolder` + `scribe:audio-folder-choose`. `dialog.showOpenDialog({properties:['openDirectory',…]})` já existe (`index.ts:2326-2343`).
- **Smoke**: `main/smoke.ts` (`midiaChecks :7713` é o molde), fixtures em `main/smoke-fixtures.ts` (`chosenEmailAttachments`, `openedFiles`), agente falso `test/fixtures/fake-acp-agent.mjs`; `detail` só com números e booleanos; `expectedShots` com comentário por contrato.

## Prova do CLI (23/11/2026)

| Teste | Resultado |
|---|---|
| Sem `--restricted`, Read fora do cwd | **permitiu** (leu o arquivo) |
| `--restricted --add-dir X`, Read fora de cwd e X | recusado: "--restricted confines the file tools to the working directory" |
| `--restricted`, Write em X com `dontAsk` | negado, arquivo não criado |
| Read em `.pdf`, `.txt`, `.md`, `.csv` | lê (PDF nativo) |
| Read em `.docx`, `.xlsx` | recusa: "This tool cannot read binary files" |

## Decisão: `--add-dir` × índice + leitura sob demanda

**Escolhido: índice `PASTAS.md` + ferramenta própria `ler_arquivo_pasta`** (mesmo mecanismo do contrato 149). Motivos: o Read do CLI não abre Word nem planilha; `--add-dir` não dá controle de tipo, tamanho, ocultos ou pastas sensíveis no momento da leitura; o ACP não tem `--add-dir` e recusaria por `realpath`; a ferramenta própria passa pelo `mediaSeen` (material de terceiros não induz ação) e pelo orçamento por pergunta. O `--restricted` atual fica como está, sem `--add-dir`: a única porta para o conteúdo das pastas é a ferramenta do app.

## Lacunas a fechar

1. Nenhuma fonte tem configuração global: a lista de pastas vai para `settings.assistant.folders`, gravada só pelo main depois do diálogo nativo.
2. Prefixo `Pasta - <hash16>.…` precisa entrar em `isMediaFile` (limpeza em `corpus.ts:481` e `clearMediaFiles`) e não pode casar com o regex de reunião `* - <id>.md` (`corpus.ts:336`) — atenção ao formato.
3. Extração de Word: `textutil -convert txt -stdout` (nativo do macOS, sem dependência). Planilha: leitor próprio mínimo (zip + `sharedStrings.xml` + `sheetN.xml`) ou dependência compatível com GPL-3.0; decidir no plan.
4. Cartão com anexos: o modelo só indica **ids** do índice; o main resolve caminho (`realpath` dentro da pasta permitida), confere tamanho e soma antes de ler; bytes nunca vêm do texto nem passam por `history.state`.
5. "Abrir no Composer": canal novo que devolve o rascunho com bytes; renderer chama `openDraft` e navega. Envio só pelo `emailSend` com token de clique, como hoje.
6. Citação clicável: esquema `pasta:<id>`, parser em `shared/chat.ts`, botão "Abrir" em `ChatMarkdown.tsx`, IPC que recebe só o id e revela no Finder.

## Trabalho em curso que colide

- Árvore principal: contrato 161 (triagem) com `main/index.ts`, `shared/ipc.ts`, `main/whatsapp/*` sujos; 162/163 vão tocar `features/chat` e `main/chat`.
- Branch `claude/system-git-verification-1203c7` (não mesclada): 150, 152, 153, 154 em cartões e IPC (`ActionCards.tsx`, `actions.ts`, `shared/assistant.ts`).
- Worktree `email-dashboard`: `features/email/*` (`emailStore`, `format`, `EmailScreen`).
- Conclusão: esta frente roda num **worktree próprio `pastas-assistente`** a partir da main, com merge no fim e atenção a `index.ts`, `ipc.ts`, `actions.ts`, `ActionCards.tsx`, `shared/assistant.ts`, `Composer.tsx`.

## Numeração

Maior contrato em uso: 163 na main; 164 reservado (triagem); 155–158 (email-dashboard); 152 e 154 na branch não mesclada. **Esta frente começa no 165.**
