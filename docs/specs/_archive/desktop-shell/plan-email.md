# Plan — Email (IMAP, POP3 e SMTP)
PRD: `prd-email.md` · Escrito no fechamento (19/11/2026), a partir do que foi feito. Na abertura, o grafo estava dentro da PRD; o checklist do `~/CLAUDE.md` exige um plan separado.

## Decisões técnicas
- **Stack, no processo main do Electron, sem bridge:**
  - `imapflow` para o IMAP, com IDLE;
  - `nodemailer` para o SMTP;
  - `mailparser` para o MIME.
  - O POP3 é um cliente próprio sobre `node:net` e `node:tls`, porque não há biblioteca POP3 mantida.
  - As três bibliotecas vão embutidas no build do main (`electron.vite.config.ts`), porque o `pack.sh` não as copia.
- **Descoberta dos servidores:** primeiro os presets embutidos, depois o ISPDB do Thunderbird (só o domínio sai) e, por fim, o manual.
- **Senhas:** guardadas com o `safeStorage` do Electron, em base64, no `settings.json` (`emailAccounts`, fora do `AppSettings`, para não ir ao renderer com o app bloqueado).
- **Envio:** só com o token de clique, gerado no preload com a ativação do usuário. A exceção são as tarefas agendadas com permissão dada antes (contrato 51): elas usam um caminho interno, sem IPC.
- **Tela:** as contas ficam no sidebar que já existe, com a lista e a leitura em duas colunas, na estrutura do Outlook desktop, com os tokens do app.
- **HTML:** sanitizado por uma lista própria de marcas e atributos permitidos. As imagens remotas só carregam no clique: quem baixa é o main, com o filtro SSRF (nome, DNS e 5 MB).
- **Assistente:** recebe o `EMAILS.md` e os arquivos de corpo na pasta da conversa. A busca no servidor passa pelo protocolo próprio `lap-ferramenta`, sem MCP.
- **OAuth (Gmail e Outlook):** ADIADO. Exigiria um client ID registrado, e o sistema é open source e não deve ter vínculo com conta de ninguém. No Gmail se usa a senha de app.

## Grafo de tarefas (como foi executado)
| # | Microtarefa | Depende | Wave | Commit |
|---|---|---|---|---|
| 42 | Núcleo: contas, IMAP, POP3, SMTP, autoconfig, store e IPC | — | 1 | `d7e8a22` (+ `4c2da7f` empacotamento) |
| 43 | Telas no estilo Outlook, notificações, anexos, sanitização (CA1–CA9) | 42 | 2 | `4236792` |
| 44 | OAuth Gmail e Outlook | — | — | adiado |
| 45 | Email no Assistente: pendências, rascunho, lembrete, busca no servidor (CA1–CA7) | 42, 43 | 3 | `a7b5f61` |
| 51 | Tarefas agendadas que enviam com permissão dada antes (era o 46) | 23, 42, 45 | 4 | `f783568` |
| — | README (seção Email, senha de app do Gmail, privacidade) | — | — | `21ebc73` |
| — | Merge da main 0.14.0 | — | — | `8546027` |

Uma wave por vez, porque a máquina tinha pouca memória e as waves dividiam settings e smoke. Cada contrato passou por implementador, gates, revisor cego, no máximo uma devolução e commit pelo agente de commits.

## Gates
- `SMOKE_NO_SANDBOX=1 caffeinate -dimsu bash apps/desktop/scripts/gates.sh` verde nos 8 passos, em cada contrato. Último resultado: 1683 testes e 98 PNGs.

## Pendências que ficaram
- OAuth (contrato 44, adiado).
- Triagem por IA: malicioso, urgência e pastas (contratos 52, 55 e 56, depois dos conectores).
- Teste navegado com uma conta real, numa sessão nova (prompt em `~/Documents/LAP/Entregas/meeting-scribe/`).
- A corrida de DNS no "Carregar imagens", aceita: é um GET cego, só de `image/*`.
