# Contrato 44 — OAuth2 (XOAUTH2) para Gmail e Outlook/Microsoft
Feature: desktop-shell · Wave: 3 · Depende de: 42, 43 · PRD: `docs/specs/desktop-shell/prd-email.md`

## Pré-condições
- 42 e 43 prontos. Evidência do Outlook (PRD): Gmail/Microsoft usam IMAP/SMTP comuns com `AUTHENTICATE XOAUTH2` — aqui é igual, sem EWS.
- Client IDs são do Andrew (ele registra no Google Cloud e no Entra); ficam nas Configurações. NUNCA embutir client ID/secret no repo.

## Superfície
- Criar: `src/main/email/oauth.ts` (fluxo loopback + PKCE + refresh), `test/email-oauth.test.ts`.
- Alterar: `email/service` e clientes (SASL XOAUTH2), tipos em `shared/email.ts`, seção de Configurações do 43, `README.md` (passo a passo de registrar os apps Google/Microsoft).

## Critérios de aceite
- CA1 — Dado client ID configurado, quando o Andrew escolhe "Conta Google", então o app abre o navegador padrão em `accounts.google.com/o/oauth2/v2/auth` com PKCE (S256), `redirect_uri` de loopback `http://127.0.0.1:<porta efêmera>`, scope `https://mail.google.com/`, `access_type=offline`; o callback troca o código por tokens (endpoint injetável no teste), a conta nasce com `imap.gmail.com:993`/`smtp.gmail.com:465` e `auth.kind:'oauth-google'`, e o refresh token vai cifrado via `safeStorage` (mesma regra do CA1 do 42).
- CA2 — Dado "Conta Outlook/Microsoft", então igual com `login.microsoftonline.com/common/oauth2/v2.0/authorize` (public client, sem secret), scopes `offline_access https://outlook.office365.com/IMAP.AccessAsUser.All https://outlook.office365.com/SMTP.Send`, servidores `outlook.office365.com:993`/`smtp.office365.com:587 starttls`.
- CA3 — Dado access token expirado (fake retorna 401/`invalid_token` uma vez), quando IMAP ou SMTP autentica, então o service renova com o refresh token e repete UMA vez com sucesso; refresh inválido → conta em estado `reauth` e a tela mostra "Entrar de novo" (sem loop, sem crash).
- CA4 — Dado os clientes IMAP/POP3/SMTP do 42, então a autenticação por `XOAUTH2` monta a string SASL (`user=...\x01auth=Bearer ...\x01\x01` em base64) correta — teste de unidade byte a byte — e POP3 fica explícito como senha-apenas (OAuth não se aplica; Gmail/Outlook entram como IMAP).
- CA5 — Dado client ID ausente, então os botões Google/Microsoft aparecem desabilitados com texto curto apontando o campo de configuração; o README ganha a seção "Conectar Gmail e Outlook" com o registro dos apps (consent screen, redirect loopback, scopes) sem nenhum segredo de exemplo real.
- CA6 — Nenhum token em log; `settings.json` nunca contém token em claro (teste).

## Invariantes
- Contas senha+IMAP/POP3 do 42/43 continuam funcionando sem mudança de settings (migração aditiva).

## Fora de escopo
- Exchange/EWS/Graph; Gmail API/Graph API; contas corporativas com política condicional.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
