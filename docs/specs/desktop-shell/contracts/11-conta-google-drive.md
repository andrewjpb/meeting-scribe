# Contrato 11 — Entrar com a conta Google e guardar cada reunião no Google Drive
Feature: desktop-shell  ·  Wave: 11  ·  Depende de: 10

## Pré-condições
- Contratos 01 a 10 aceitos; `gates.sh` verde.
- Pedido do Andrew (15/11/2026 20:40): "guardar automaticamente fazendo uma integração com Google, entrando com a conta do Google e puxando as informações dele". Escolha às 20:48: **tudo numa pasta** (áudio, transcrição e resumo) no Drive.
- O Andrew cria o cadastro no Google Cloud (projeto, Drive API e Calendar API ligadas, tela de consentimento "Externo" em teste com o e-mail dele como usuário de teste, cliente OAuth do tipo **"App para computador"**). Ele cola o **ID do cliente** e a **chave secreta do cliente** no app (CA2). Nada disso fica no código, no repositório ou no cofre.
- Login de app de computador pelo padrão do Google: navegador do sistema, redirecionamento para `http://127.0.0.1:<porta livre>` (loopback), PKCE S256 e `state`. Nada de janela de login dentro do Electron (o Google bloqueia e seria inseguro).

## Superfície
- `src/main/accounts/` (novo) — OAuth genérico com PKCE + loopback (reaproveitado pela Microsoft no contrato 12), cofre de tokens, perfil.
- `src/main/google/` (novo) — perfil e Drive.
- `src/main/secrets.ts` (padrão do `safeStorage`), settings, `src/shared/` (tipos, IPC), preload.
- `features/settings/` — bloco "Contas"; tela de detalhe (estado no Drive); barra lateral (foto/nome da conta, opcional).
- `src/main/smoke.ts` + fixtures (servidor OAuth e Drive falsos, sem rede).

## Critérios de aceite
- CA1: módulo `oauth.ts` puro + injetável: gera `code_verifier`/`code_challenge` S256 e `state` aleatórios; sobe um servidor HTTP em `127.0.0.1` porta 0 que aceita **um** pedido em `GET /callback`, confere o `state`, responde uma página simples "Pronto, pode voltar ao app." e fecha; tempo limite de 5 min; abre a URL de autorização com `shell.openExternal` (só `https://accounts.google.com/` e, no 12, `https://login.microsoftonline.com/`); troca o código por tokens no endpoint de token com `net.fetch` no main. Erros: `cancelled`, `timeout`, `state`, `denied`, `network`, `invalid-client`. Testes com servidor e endpoint falsos.
- CA2: Configurações ganha o bloco **"Contas"** (logo depois de "Marca"):
  - linha "Google": sem cadastro, botão "Configurar…" abre um painel com os campos "ID do cliente" e "Chave secreta do cliente" (a chave em campo de senha), ajuda "Crie em console.cloud.google.com → Clientes → App para computador." e "Salvar"; os dois ficam cifrados com `safeStorage` (como a chave da AssemblyAI) e nunca voltam ao renderer (só "configurado: sim/não" e o ID com o meio mascarado);
  - com cadastro e sem login: "Entrar com Google"; durante: "Continue no navegador…" + "Cancelar";
  - logado: foto (data URL baixada no main, até 256 px), nome e e-mail; botão "Sair" (revoga o token em `https://oauth2.googleapis.com/revoke` e apaga do disco);
  - interruptor "Guardar no Google Drive" (padrão **ligado** depois do primeiro login) com a ajuda "Depois de cada reunião, o áudio, a transcrição e o resumo vão para a pasta "LAP Reuniões" do seu Drive.".
  Segue `design.md`. Smoke: `configuracoes-contas-light.png` e `-dark.png` (deslogado e logado com fixture).
- CA3: escopos pedidos no login: `openid email profile https://www.googleapis.com/auth/drive.file` (o 12 acrescenta o da agenda com `include_granted_scopes=true`). `access_type=offline` e `prompt=consent` no primeiro login para vir o `refresh_token`. Tokens em `userData/accounts/google.bin` cifrados (`safeStorage`); o access token renova sozinho 60 s antes de vencer; `invalid_grant` = sessão expirada → estado "Entre de novo" na linha da conta, sem apagar nada local. Tokens nunca chegam ao renderer nem aos logs. Testes.
- CA4: Drive: na primeira vez, cria a pasta **"LAP Reuniões"** na raiz (`application/vnd.google-apps.folder`) e guarda o id; se ela for apagada no Drive, cria de novo. Cada reunião vira uma subpasta com o mesmo nome base dos arquivos locais (`AAAA-MM-DD HHhMM - título`). Envia: o áudio (`.m4a`/`.webm`, upload **resumable** em pedaços de 8 MB), a transcrição `.md` e o `- resumo.md`. Escopo `drive.file`: o app só vê o que ele criou.
- CA5: fila de envio no main, persistida em `userData/drive-queue.json`, um envio por vez: entra ao encerrar (áudio + transcrição) e quando o resumo fica pronto ou é gerado de novo (o resumo **substitui** o arquivo anterior no Drive, mesmo id). Sem internet ou erro 5xx/429: tenta de novo com espera crescente (30 s, 2 min, 10 min, 30 min, depois de hora em hora); 401 renova o token uma vez; 403/404 de pasta recria a pasta. Reabrir o app continua a fila. Reunião sem arquivos locais (opção da pasta desligada): envia a transcrição e o resumo gerados na hora com `transcriptMarkdown`/`summaryMarkdown`. Excluir a reunião no app **não** apaga nada do Drive. Testes com Drive falso (sucesso, queda no meio do resumable e retomada, 401, pasta apagada, fila após reiniciar).
- CA6: detalhe da reunião, aba "Áudio": linha "Google Drive" com o estado: "Enviando… 45%", "No Drive" + botão "Abrir no Drive" (abre `https://drive.google.com/drive/folders/<id>` com `shell.openExternal`), "Aguardando internet", "Erro: <motivo curto>" + "Tentar de novo". Na lista de Reuniões (contrato 10), um ícone discreto de nuvem quando está no Drive.
- CA7: o envio usa só o que está nos arquivos do app (caminhos de `meetings.json` + checagem de extensão do contrato 07); o renderer só manda `meetingId`. Destinos de rede novos, todos no main via `net.fetch`: `accounts.google.com` (só navegador), `oauth2.googleapis.com`, `openidconnect.googleapis.com` ou `www.googleapis.com/oauth2`, `www.googleapis.com/drive/v3`, `www.googleapis.com/upload/drive/v3`, `lh3.googleusercontent.com` (foto). Nenhum outro. A CSP do renderer não muda.
- CA8: smoke com servidor OAuth e Drive falsos (injetados, sem rede): configura o cliente, faz login (o "navegador" é um pedido HTTP do próprio smoke ao loopback), mostra a conta, grava a fixture, confere a subpasta e os três arquivos no Drive falso, regera o resumo e confere a substituição, sai da conta. `externalRequests: []`.

## Invariantes
- Contratos 01 a 10 continuam passando. Sem login, o app funciona como hoje e não faz nenhum pedido ao Google.
- Segredos (chave secreta do cliente, tokens) só cifrados em `userData`; nunca no renderer, em log, no smoke report, no repositório ou no cofre.
- `prova/` e `docs/` não mudam.

## Fora de escopo
- Google Docs, compartilhar a pasta com outras pessoas, baixar reuniões do Drive para o app, apagar no Drive, várias contas Google, verificação do app pelo Google (fica em modo teste, até 100 usuários de teste).

## Gates
- `gates.sh` (smoke à mão com `--no-sandbox`) e `scripts/pack.sh`.

## Telas de impacto no usuário
- Configurações: bloco "Contas" com Google (configurar, entrar, sair, guardar no Drive).
- Detalhe: estado no Google Drive e "Abrir no Drive". Lista: ícone de nuvem.

## Notas do coordenador
- Nada de commit. O teste real depende do Andrew criar o cliente OAuth; até lá, só o smoke com fakes.
