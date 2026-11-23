# Contrato 144 — Atendimento no WhatsApp: smoke de ponta a ponta, prints e documentação permanente

Feature: whatsapp-agentes  ·  Wave: 6  ·  Depende de: 143

Constituição: `CLAUDE.md` do usuário e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Contratos 138 a 143 aceitos e commitados. `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde antes de começar.
- Spec: `docs/specs/whatsapp-agentes/spec.md`, seções "Verificação end-to-end" e "Prints exigidos".

## Contexto mínimo
O smoke (`apps/desktop/src/main/smoke.ts`, com dados em `smoke-fixtures.ts`) abre o app de verdade, navega,
confere e tira prints. O WhatsApp do smoke roda com o serviço falso (`backend_fake.py`), acionado por
`ctx.whatsapp.fake('incoming' | 'sent' | 'presences' | …, body)`; as conversas são `WA_ANA`, `WA_BRUNO` e
`WA_ATLAS` (grupo). Modelos: `whatsappChecks` (navega com `clickNav(contents, 'whatsapp')`) e
`automationsChecks`. Prints: `capture(win, ctx.outDir, '<nome>')`; o escuro abre outra janela com
`ctx.openWindow({ theme: 'dark' })`. Há uma contagem fixa de PNGs (`expectedShots`, perto do fim do arquivo):
cada contrato que acrescenta prints soma ao número e deixa um comentário acima. O atendimento chama o modelo
por `runClaudeOneShot`; descubra como o smoke já substitui o `claude` nas outras features (rascunho do
WhatsApp, resumo, chat) e use o mesmo mecanismo. O `SmokeContext` ainda não conhece o serviço de atendimento.

## Superfície
- Alterar `apps/desktop/src/main/smoke.ts` e, se preciso, `smoke-fixtures.ts`; em `apps/desktop/src/main/index.ts`, só o necessário para o smoke alcançar o atendimento (por exemplo, expor o serviço/store no `SmokeContext`), sem mudar o comportamento fora do smoke.
- Alterar `README.md` (raiz) e `apps/desktop/resources/assistente/guia-do-app.md`; `docs/telas/README.md` se ele listar telas ou prints.
- Nenhum arquivo de `src/renderer` muda, salvo acrescentar um atributo `data-*` que falte para um check (relate qual).

## Critérios de aceite

### Checks novos (função própria, por exemplo `atendimentoChecks`, registrada como as demais)
Cada item é um check nomeado no `report.json`, que falha com mensagem clara.
- CA1. Criar pela tela (Automações › Atendimento › "Novo agente") o agente "Recados" com a regra "Responda só confirmando o recebimento."; o cartão aparece com "Haiku · Nenhuma conversa".
- CA2. "Testar" no formulário devolve um texto em "Responderia" e `/_fake/sent` não muda.
- CA3. Na conversa `WA_ANA`, abrir o painel "Atendimento", escolher "Recados", modo "Responder sozinho", atraso 0 a 0, e "Salvar": abre o aviso de risco; "Cancelar" não salva (nenhum atendimento no estado); de novo "Salvar", marcar a caixa e "Ligar atendimento": o atendimento fica gravado e o selo do cabeçalho mostra "Recados · atendendo".
- CA4. Mensagem recebida de `WA_ANA` (`fake('incoming')`): em até 20 s há exatamente um envio novo em `/_fake/sent` para `WA_ANA`, com o texto do modelo falso; a mensagem aparece na conversa com o nome do agente junto da hora.
- CA5. Mensagem recebida de `WA_BRUNO` (sem atendimento): depois de 5 s, `/_fake/sent` não mudou.
- CA6. O grupo `WA_ATLAS` não mostra o botão "Atendimento".
- CA7. Trocar `WA_ANA` para "Rascunho para eu aprovar" e receber outra mensagem: nenhum envio; a caixa da proposta aparece com o texto; o selo mostra "propôs uma resposta"; clicar "Enviar" gera um envio e a caixa some.
- CA8. Simular mensagem `fromMe: true` em `WA_ANA` que não saiu do app: o selo passa a "pausado até HH:MM" e o painel oferece a retomada (se o contrato 143 a entregou).
- CA9. "Pausar todos os atendimentos": o botão vira "Retomar atendimentos"; mensagem recebida de `WA_ANA` não gera envio nem proposta; "Retomar atendimentos" volta ao estado anterior.
- CA10. Automações › Atendimento › Histórico mostra linhas "Respondeu", "Propôs", "Você enviou a proposta" e "Pausou" para a conversa da Ana, e nenhuma célula contém o texto das mensagens.
- CA11. Excluir o agente "Recados": o atendimento de `WA_ANA` fica desligado (selo "desligado" ou sem etiqueta na lista).
- CA12. Os checks deixam o app como encontraram no que importa aos checks seguintes (nenhum atendimento ligado, `pausedAll` desligado), e não tornam instável nenhum check existente. Nenhuma espera fixa maior que o necessário: use espera por condição com limite.

### Prints (todos com pelo menos 1120×740 e mais de 50 cores, como os demais)
- CA13. São gerados exatamente estes nove: `whatsapp-atendimento-painel-light`, `whatsapp-atendimento-painel-dark`, `whatsapp-atendimento-selo-light`, `whatsapp-atendimento-rascunho-light`, `whatsapp-atendimento-risco-light`, `automacoes-atendimento-light`, `automacoes-atendimento-dark`, `automacoes-atendimento-form-light`, `automacoes-atendimento-historico-light`. O de histórico mostra a tabela com linhas; o de selo mostra a lista com a etiqueta e o cabeçalho com o selo.
- CA14. `expectedShots` sobe em 9, com o comentário do contrato 144 acima, no padrão dos anteriores. O smoke termina com "N PNGs … ok".

### Documentação permanente
- CA15. `README.md`, em "Experimental": subseção nova "Atendimento no WhatsApp (por sua conta e risco)", em até 12 linhas: o que é (agentes com as suas regras respondem conversas que você marca, uma a uma); que cada conversa tem as próprias opções (agente, rascunho ou responder sozinho, atraso de X a Y minutos, "digitando", horário, limite por hora, pausa quando você responde); que o padrão é Rascunho; que só funciona com o app aberto e o Mac acordado; que não vale para grupos nem mídia; o risco de bloqueio do número; que o agente não tem ferramentas nem lê nada além daquela conversa e passa para você quando perguntam se é um robô.
- CA16. `README.md` deixa de citar "a confirmação do macOS" no envio do WhatsApp (hoje nas linhas ~54, ~64 e ~221; o diálogo foi retirado pelo contrato 33). A frase "nenhuma mensagem sai sem o seu clique" passa a dizer a exceção: conversas que você marcou para um agente responder sozinho.
- CA17. `guia-do-app.md`: a seção "Automações" passa a descrever quatro abas, com a "Atendimento"; a seção "WhatsApp" ganha o painel Atendimento, os selos, a proposta e "Pausar todos os atendimentos", com os nomes exatos dos botões da tela; as três menções à "confirmação do macOS" (linhas ~79, ~101 e ~261) saem; a seção "Privacidade" deixa de afirmar que nenhuma IA envia mensagem e passa a listar as duas exceções (email dos agendamentos e atendimento do WhatsApp em modo "Responder sozinho", só nas conversas marcadas). Os marcadores `<!-- tela: … -->` continuam como estão.
- CA18. Texto dos documentos em pt-BR com acentuação, sem "backend", "IPC", "stub" nem nomes de arquivo de código; nenhuma promessa que o app não cumpre.

## Invariantes
- Todos os checks e prints existentes do smoke continuam passando, sem mudança de nome.
- `test/assistant.test.ts` (que confere o guia) e o restante da suíte passam.
- O atendimento fora do smoke não muda de comportamento. Nada novo é gravado em `apps/desktop/out/` além do que o smoke já gera.
- O smoke nunca fala com o WhatsApp de verdade nem com o `claude` de verdade.

## Fora de escopo
- Corrigir defeitos das telas que os checks revelarem: pare, descreva o defeito com o check que falhou e relate (a correção é decidida por quem coordena).
- Teste navegado e apresentação do cliente; arquivamento da spec; release.

## Gates
`SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, da raiz (cerca de 20 minutos; exige a tela do Mac acesa e
desbloqueada). Se parar por tela bloqueada, relate sem contornar.

## Relatório final
Arquivos alterados; resultado de cada passo dos gates com contagens (testes, PNGs); lista dos checks novos com
o resultado; atributos `data-*` acrescentados no renderer, se houver; defeitos encontrados nas telas;
critérios não cumpridos ou adaptados. Não commitar.
