# Plan — Organização do email

Spec: [spec.md](./spec.md). Contratos em `docs/specs/desktop-shell/contracts/` (52 a 56).

## Decisões técnicas
- **Pastas**: `email-store.ts` passa de `folder: 'inbox'|'sent'` para `mailbox: string` (o path IMAP), com migração:
  `inbox` → `INBOX`, `sent` → path com `\Sent`. Cache por pasta: as 200 mais recentes, carregadas ao abrir a pasta
  (INBOX segue no IDLE; as outras atualizam ao abrir e a cada 5 min enquanto abertas).
  Porquê: mantém o desenho atual (cache + corpo sob demanda) sem baixar a conta inteira.
- **Contagem**: `STATUS (UNSEEN)` por pasta ao conectar e ao mover; árvore pelo delimitador do `LIST`.
- **Mover**: `imapflow.messageMove` (usa `MOVE` se o servidor tem, senão `COPY`+`EXPUNGE`). Lote por pasta.
- **Pastas**: `mailboxCreate`, `mailboxRename`, `mailboxDelete`; pastas com `specialUse` ou `INBOX` bloqueadas.
- **Regras**: módulo puro `main/email/rules.ts` (`matchRule(message, rule)` e `planActions(message, rules)`),
  aplicado em `service.ts` no `onNew` antes de `notify.ts`. Ações executadas com a sessão IMAP já aberta.
  Esquema zod no settings (`emailRules: Rule[]` por conta). Limite: 50 regras por conta.
- **"Executar agora"**: `planActions` em modo simulação devolve a contagem; confirma; executa em lote.
- **Assinatura**: `emailSignatures[accountId] = { text, onNew, onReply }` no settings. O Composer insere
  `\n\n-- \n<texto>` acima da citação; no HTML, `<div class="signature">` com links auto-detectados e texto escapado.
- **Aba Email**: `email` entra em `SETTINGS_TABS` depois de `contas` (⌘ fica 1–9). `EmailSection` sai de Contas
  e ganha as seções novas; entradas novas em `settings-index`.
- **IPC**: canais novos no preload com zod `.strict()` (padrão do `service.ts`): `email:folders`, `email:openFolder`,
  `email:move`, `email:folderCreate/Rename/Delete`, `email:rules:get/set/runNow`, `email:signature:get/set`.
  Nenhum deles envia email, então não usam token de clique.

- **Agente**: ferramentas no mesmo registro de `assistant-tools.ts` (padrão de `buscar_emails`). `mover_emails` recebe
  `refs` + pasta destino + motivo por assunto; grava o lote (`email-batches.json`: ref, pasta de origem, UID novo pelo
  `COPYUID`) antes de devolver. Desfazer move de volta pelo UID novo. A decisão resolvido/pendente é do modelo, lendo o fio;
  o app só executa e registra. Ferramentas de mover ficam fora do perfil das tarefas agendadas.
- **Ao vivo (R12)**: ferramenta `informar_progresso` (etapa, contadores, decisão por assunto com motivo e evidência);
  cada chamada vira evento `email:organize:progress` (main → renderer) e alimenta o chat e o painel. `mover_emails`
  também emite. **Parar** cancela o turno do ACP (mesmo caminho do botão parar do chat).

## Grafo de tarefas e waves
| Wave | Contrato | O quê | Depende |
|---|---|---|---|
| 1 | 52 núcleo de pastas | store por pasta + migração, LIST/STATUS, abrir pasta, mover, criar/renomear/apagar, IPC, testes no IMAP falso | — |
| 1 | 54 assinatura (núcleo) | settings + função que monta texto/HTML com assinatura + IPC + testes | — |
| 2 | 53 regras | `rules.ts`, aplicação no `onNew`, "Executar agora", erro por regra, IPC, testes | 52 |
| 3 | 56 agente organiza | ferramentas `listar_pastas`/`criar_pasta`/`mover_emails` no MCP do Assistente, lote com Desfazer (registro em userData), `informar_progresso` + eventos ao vivo, Parar, cartão no chat, bloqueio em tarefa agendada, testes | 52 |
| 4 | 55 telas | sidebar com árvore, seleção múltipla, arrastar, "Mover para…", Composer com assinatura, aba Email completa, painel "Organizando" ao vivo com Parar e Desfazer, busca ⌘F, smoke | 52, 53, 54, 56 |

Um implementador por vez (memória do notebook), revisor cego depois de cada um.
Gate de design: mockup da aba Email e do sidebar aprovado pelo Andrew antes do contrato 55.

## Gates
`SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` (typecheck, lint, testes, build, smoke, tokens, formas, pytest).

## Fechamento
Teste navegado em sessão nova, README (seção Email: pastas, regras, assinatura), spec para `docs/specs/_archive/`,
merge na `main` (ou o comando de push para o Andrew).
