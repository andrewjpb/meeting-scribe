# Contrato 22 — Bloquear o app: tela fosca com senha ou Touch ID
Feature: desktop-shell  ·  Wave: 20  ·  Depende de: 19 (versão 0.4.0)

## Pré-condições
- Contrato 19 aceito; 0.4.0 publicada; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026): "um botão de bloquear a tela, e o sistema fica fosco com bloqueio de senha".
- Decisões do coordenador: o bloqueio é **do app** (não do macOS); a gravação, a transcrição, a tradução e as análises em curso **continuam** com o app bloqueado; desbloqueio por **Touch ID** (`systemPreferences.promptTouchID`, quando o Mac tem) ou por uma **senha do app** criada pela pessoa.

## Superfície
- `src/main/lock/` (novo: senha com hash, tentativas, estado do bloqueio), `src/shared/` (tipos, IPC), preload; settings.
- `src/renderer/src/app/` (camada de bloqueio sobre tudo), barra lateral e `ControlBar` (botão), `features/settings/` (aba Geral › "Bloqueio").
- `src/main/smoke.ts`.

## Critérios de aceite
- CA1 — **senha do app**: Configurações › Geral ganha o bloco **"Bloqueio"**: "Criar senha" / "Trocar senha" / "Remover senha" (pede a atual), senha de 4 a 64 caracteres com confirmação; guardada só como hash **scrypt** com sal aleatório (Node `crypto.scrypt`, parâmetros fortes, comparação em tempo constante) em `userData/lock.json` (0600); nunca vai ao renderer nem a log. Interruptor "Usar Touch ID" (só aparece se `systemPreferences.canPromptTouchID()`). Sem senha e sem Touch ID, o botão de bloquear fica desabilitado com a dica "Crie uma senha em Configurações › Geral". Testes do main.
- CA2 — **bloquear**: botão "Bloquear" (ícone de cadeado) no rodapé da barra lateral e na `ControlBar` durante a gravação; atalho **⌘⇧L**; item de menu "Bloquear LAP Reuniões". Opções no bloco "Bloqueio": "Bloquear sozinho depois de [nunca | 1 | 5 | 15 | 30] min sem uso" (padrão nunca) e "Bloquear quando o Mac bloquear a tela ou dormir" (padrão ligado; `powerMonitor` `lock-screen`/`suspend`).
- CA3 — **tela fosca**: ao bloquear, uma camada cobre a janela inteira: o conteúdo fica **desfocado e escurecido** (`backdrop-filter: blur(24px)` + véu pelos tokens; com `prefers-reduced-transparency` ou `prefers-reduced-motion`, um fundo opaco sem animação) e no centro aparecem o logo/nome da marca (09), "LAP Reuniões está bloqueado", o campo de senha, "Desbloquear" e, se ligado, "Usar Touch ID". Durante uma gravação a camada mostra também uma linha discreta "Gravando · 12:34" (sem nenhum texto da reunião). Nada da tela de trás pode ser lido (o desfoque é forte o bastante; o smoke mede que nenhum texto fica legível por OCR simples do print — ou, se OCR não for viável, que o contraste/tamanho do desfoque segue o valor fixo) e nada recebe clique, teclado ou foco (`inert` em todo o resto; Tab fica preso na camada). Segue `design.md` (sem sombra, raio ≤ 6 px).
- CA4 — **o que fica protegido com o app bloqueado**: o renderer não mostra transcrição, resumo, notas, chat, análises nem Configurações; o main **recusa** todos os canais IPC de leitura de conteúdo (reuniões, transcrição, resumo, notas, análises, chat, arquivos, busca, cópia para a área de transferência) com o erro `locked`, exceto os da própria gravação em curso (para não perder dados) e os do bloqueio. As notificações do macOS que mostram conteúdo (contrato 12, se existir) passam a dizer só "LAP Reuniões" enquanto bloqueado. O título da janela vira "LAP Reuniões — bloqueado". Testes do main por canal.
- CA5 — **desbloquear**: senha certa ou Touch ID aprovado → a camada some e a tela volta exatamente onde estava (rota, rolagem, rascunhos, painel aberto). Senha errada: "Senha incorreta"; depois de 5 erros seguidos, espera crescente (30 s, 1 min, 5 min…) com contagem na tela, guardada no main (reiniciar o app não zera). Esqueceu a senha: o link "Esqueci a senha" explica que dá para apagar o `lock.json` só com o app fechado (o que remove a senha, sem apagar reuniões) — o app não oferece atalho para isso.
- CA6 — **reabrir o app**: se o app foi fechado bloqueado, ou "Pedir senha ao abrir" estiver ligado (opção no bloco, padrão desligado), ele abre já bloqueado.
- CA7 — **smoke**: cria senha, bloqueia pelo botão e por ⌘⇧L, confere a camada (desfoque aplicado, foco preso, cliques bloqueados, título), confere que canais de conteúdo devolvem `locked` e que a gravação de fixture continua contando quadros e transcrevendo, erra a senha 5 vezes (espera aparece), desbloqueia com a senha certa e confere que voltou à mesma tela e rolagem; Touch ID com substituto. PNGs `bloqueado-light.png`, `bloqueado-dark.png`, `bloqueado-gravando-light.png`, `configuracoes-bloqueio-light.png`. `externalRequests: []`.

## Invariantes
- Contratos 01 a 19 continuam passando. Bloquear nunca para nem pausa a gravação. A senha nunca fica em texto puro em lugar nenhum. `prova/` e `docs/` não mudam.

## Fora de escopo
- Criptografar os arquivos das reuniões em disco, bloquear o Mac, várias contas, recuperar senha por e-mail.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Botão "Bloquear" (barra lateral, barra da gravação, ⌘⇧L, menu).
- Tela fosca de bloqueio com senha e Touch ID.
- Configurações › Geral › "Bloqueio".

## Notas do coordenador
- Nada de commit pelo implementador.
