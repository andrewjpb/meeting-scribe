# Contrato 42 — Núcleo de email: contas, IMAP/POP3/SMTP, autoconfig, store e IPC
Feature: desktop-shell · Wave: 1 · Depende de: — · PRD: `docs/specs/desktop-shell/prd-email.md`

## Pré-condições (conferir na implementação)
- Trabalhar SÓ no worktree `~/Documents/GitHub/meeting-scribe-email` (branch `email`); rodar `pnpm install` na raiz antes.
- Seguir o desenho de `apps/desktop/src/main/whatsapp/` (service/client/store), `src/main/settings/` e `src/shared/ipc.ts` — mesmos padrões de canal, teste de lock-ipc e settings com defaults/índice.
- Novas dependências permitidas: `imapflow`, `nodemailer`, `mailparser` (+ tipos). POP3 é cliente próprio — NÃO adicionar lib POP3.

## Superfície
- Criar: `apps/desktop/src/shared/email.ts` (tipos), `src/main/email/{service,imap-client,pop3-client,smtp-client,autoconfig,email-store,secrets}.ts`, testes em `apps/desktop/test/email-*.test.ts`.
- Alterar: `src/shared/ipc.ts`, `src/shared/settings-defaults.ts`, `src/shared/settings-index.ts`, `src/main/settings/schema.ts`, `src/main/index.ts`, `src/preload/index.ts`, `test/lock-ipc.test.ts`, `test/settings-store.test.ts`.

## Critérios de aceite
- CA1 — Dado o settings vazio, quando se adiciona uma conta via IPC `scribe:email-add-account` com `{address, password, incoming{protocol:'imap'|'pop3',host,port,security:'tls'|'starttls'|'none'}, outgoing{host,port,security}}`, então ela é gravada com `id` e a senha SÓ cifrada por `safeStorage` (base64 no settings); o settings nunca contém a senha em claro (teste afirma isso lendo o JSON gravado).
- CA2 — Dado um endereço `fulano@gmail.com` (e outros presets), quando se chama `scribe:email-autoconfig`, então volta a configuração do preset embutido sem rede; dado um domínio fora dos presets com ISPDB disponível (HTTP falso no teste), então volta a configuração do XML do ISPDB (host/porta/socketType mapeados); dado ISPDB fora do ar, então volta `null` em ≤5 s (o renderer cai no manual).
- CA3 — Dado um cliente IMAP falso injetado no service, quando a conta conecta, então o service lista as últimas 200 da INBOX (UID, flags, envelope), emite evento de mensagem nova ao chegar uma (caminho do IDLE), reflete `marcar lida` (STORE \Seen) e `apagar` (\Deleted + expunge) e grava tudo no `email-store` em `userData` (arquivo por conta); corpo (`scribe:email-get-body`) é baixado sob demanda, passado pelo `mailparser` e cacheado.
- CA4 — Dado um servidor POP3 FALSO real (socket TCP do teste) com 3 mensagens, quando o poll roda, então o cliente próprio fala `USER/PASS` (e `STLS` quando `starttls`), usa `UIDL` para detectar as 2 ainda não baixadas, `RETR` delas, NÃO manda `DELE` por padrão e marca os UIDLs como vistos no store; com `deleteFromServer:true`, manda `DELE`.
- CA5 — Dado o `smtp-server` do nodemailer como servidor falso, quando `scribe:email-send` recebe `{accountId, to, subject, text, inReplyTo?}`, então a mensagem chega no servidor falso com From da conta, Message-ID e, se resposta, `In-Reply-To`/`References` corretos; em conta IMAP, o enviado é gravado via APPEND na pasta de enviados (no fake, registra a chamada); falha de SMTP volta erro tipado para o renderer, sem crash.
- CA6 — Dado senha errada ou servidor fora, quando a conta tenta conectar, então o estado da conta vira `error` com mensagem curta, os eventos continuam para as outras contas e NADA de senha aparece em log (teste em cima do logger).
- CA7 — Canais novos todos em `ipc.ts` tipados + preload + `lock-ipc.test.ts` atualizado (bloqueados quando o app está bloqueado, exceto os de leitura de estado já liberados por padrão do projeto — seguir a regra existente).

## Invariantes
- WhatsApp, reuniões, Assistente e settings existentes intocados (além das chaves novas); `settings-store.test.ts` antigo continua verde.
- Nenhum tráfego de rede em teste além dos servidores falsos locais.

## Fora de escopo desta tarefa
- UI (contrato 43), OAuth (44), Assistente (45), múltiplas pastas, busca no servidor.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde (typecheck, lint, testes, build, smoke existente intacto).
