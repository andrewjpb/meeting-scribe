---
feature: notificacoes-triagem-correcoes
contrato: 171
status: concluido
data: 2026-11-24
semana: 2026-W48
base: branch das correções da triagem (worktree meeting-scribe-triagem-correcoes) + diff do contrato 171
rodada: smoke de 24/11/2026 06:20–06:34 (apps/desktop/out/smoke/)
---

# Auditoria dos prints do smoke (notificacoes-triagem-correcoes, contrato 171)

Prints da rodada verde de 24/11/2026 (`apps/desktop/out/smoke/` do worktree; `report.json` com `generatedAt` 2026-11-24T09:34:15Z, 317 PNGs de 2240×1480). Conferidos os 20 prints da tabela: os que a spec (C1–C11) manda auditar e os de regressão do WhatsApp com a barra da etiqueta. Cada print foi aberto inteiro e comparado com os artboards de `docs/specs/_archive/notificacoes-triagem/mockups/png/`, com `docs/specs/desktop-shell/design.md` e com o resultado da primeira auditoria (`docs/specs/_archive/notificacoes-triagem/auditoria-prints.md`). Onde havia dúvida, o trecho foi recortado em resolução cheia (rótulo "Frequência" sob as abas e a barra da etiqueta no claro).

## O que procurar em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", `chatId`, nome de cartão técnico), cor fora dos tokens, contraste ruim no escuro (texto sobre `--accent` em `--on-accent`), altura fora de 44 / 32 / 28 / 20, raio acima de 6, sombra, pílula. Específico do contrato 171: C1 (vazio com tarefa pausada, botão "Abrir Automações" ou "Criar agente de triagem"), C7 (aviso de recusa inteiro, até 2 linhas, sem empurrar a conversa além do aceitável), C8 (sem Saída, post-it e "Pode enviar email" no gatilho WhatsApp; hint novo; aviso visível), C5 ("Marcar como lida" no hover/foco), C4/C9/C3 (detalhe da execução da triagem). No `report.json`: `failures` e `consoleErrors` vazios e `detail` dos checks `triagem.*` só com números e booleanos.

## Resumo

- **20 prints:** 17 `ok`, 3 `ajustar` (nenhum bloqueador; 2 achados menores de enquadramento). O que o contrato mudou e aparece em print está conforme: hint novo "Roda em cada conversa que recebe mensagem, 30 s depois da última. Grupos ficam de fora." nos dois temas, sem Saída, sem "Reunião do post-it" e sem "Pode enviar email", com o aviso de R15 inteiro em duas linhas, "Incluir grupos", "Ligada" e "Salvar agendamento" no quadro (o M3 da primeira auditoria fechou); "Marcar como lida" visível na linha em hover nos dois temas; cabeçalho do detalhe da execução com o nome do agente ("Agente do smoke") no lugar de "Claude" fixo (C9); barra da etiqueta com 44 (recorte: ~88 px no print 2×), "Urgente" de 32, segmentado de 28, chips de 20, "Triar agora" inteiro, com e sem Detalhes/Atendimento aberto. Nenhuma cor fora da paleta, sombra, pílula, id ou JSON na interface; no escuro, "Urgente" (chip e botão) e "Criar agente de triagem" com texto `--on-accent` legível.
- **Cobertura (não é defeito, mas deixa itens do contrato só no check):** nenhum print mostra o vazio com a tarefa **pausada** ("Abrir Automações", C1), o **aviso de recusa** na barra (C7, segunda linha e altura total), o **detalhe de uma execução da triagem** (C4 sem "Rodar de novo", C9 "Triagem do WhatsApp", C3 "· Triar agora") nem a lista de **Agendamentos com a tarefa de triagem** (C4 sem "Rodar agora"); o foco por teclado do C5 também só é provado no check. Os checks cobrem os quatro: `pausado` (`vazioSemAgente`, `semCriar`, `rotaAgendamentos`, `semRodarAgora: true`), `manualGrupo` (`avisoNaBarra`, `avisoInteiro`, `sufixoTriarAgora: true`), `manual` (`automaticasSemSufixo: true`) e `notificacoesEmail` (`focoTeclado: true`). Vale conferir esses quatro na tela no teste navegado da 0.26.1.
- **`report.json`:** `failures: []`, `consoleErrors: []`, `cspViolations: []`, `probeErrors: []`. Os 13 checks `triagem.*` (`semAgente`, `pausado`, `unicidade`, `triagem`, `notificacoes`, `manual`, `respondeu`, `assistente`, `desligado`, `manualGrupo`, `estadoFinal`, `privacidade`, `notificacoesEmail`) estão `ok` e os `detail` só têm números e booleanos (`injetadasEmMs: 807`, `execucoes: 2`, `linhasDoLog: 6`, `detailLimpo: true`, `logLimpo: true`…); nenhum nome de contato, texto de mensagem nem motivo. Em `notificacoes`, `linhasEmail: 0` e `marcarComoLidaExercitado: false` são de propósito (o e-mail e o "Marcar como lida" são exercitados em `notificacoesEmail`: `hoverClaro`, `hoverEscuro`, `focoTeclado`, `badgeBaixou1`, `devolvidoANaoLido` todos `true`).

### Bloqueador

Nenhum.

### Menor (enquadramento)

- **M1. `automacoes-tarefa-whatsapp-*`: a rolagem passa uns 8 px do ponto.** O rótulo "Frequência" fica com o topo cortado pela linha das abas (recorte em resolução cheia: o fio de 1 px e o sublinhado de "Agendamentos" passam por cima das letras), e "Salvar agendamento"/"Cancelar" encostam no pé do quadro. O conteúdo do C8 está todo visível; é só a captura. Componente: `src/main/smoke.ts` (rolar até o bloco da Frequência com uma margem de ~16 px, não até o rótulo colado).
- **M2. Run da triagem continua na última linha de `execucoes-light`, cortada no pé** (é o M6 da primeira auditoria, que não era deste contrato). "Hoje 06:25 · Triagem do WhatsApp · Concluída · 0 s · menos de US$ 0,01 · Haiku" aparece pela metade abaixo de dez runs do cenário, e a segunda run (a manual, com "· Triar agora") fica fora do quadro. Componente: `src/main/smoke.ts` (filtrar por "Triagem do WhatsApp" antes da captura; de quebra, uma captura do detalhe dessa run cobriria C3, C4 e C9 da lacuna acima).

### Observações (não viram pendência)

- **Herdados e sem mudança:** linha de conversa com chips ~4 px mais alta que as sem chip (M2 antigo); barra de rolagem do sistema visível nas capturas roladas (N1 antigo); "Pausar todos os agendamentos" abaixo da descrição da página.
- **Dados do cenário:** avatares sem iniciais, telefone sem formatação, "<b>Não</b>" (teste de escape), "Nova versão 0.27.0" na barra lateral, runs "Perdida/Falha/Lenta", "Agente do smoke".

## Por print

| print | referência | veredito | o que o print mostra |
|---|---|---|---|
| `whatsapp-triagem-vazio-light.png` | `04-whatsapp-urgentes-vazia-claro` | ok | C1, ramo sem tarefa: aba Urgentes ativa, "Nenhum agente de triagem ativo. Um agente das Automações etiqueta cada conversa que recebe mensagem." em 12 `--text-muted`, botão primário "Criar agente de triagem" com `Plus`, "Escolha uma conversa." à direita. O ramo pausado ("Abrir Automações") não tem print (só o check `pausado`). |
| `whatsapp-triagem-vazio-dark.png` | `04-whatsapp-urgentes-vazia-escuro` | ok | O mesmo; botão em `--accent` com texto `--on-accent`, aba Urgentes ativa em branco. |
| `whatsapp-triagem-light.png` | `03-whatsapp-abas-claro` | ok | Abas 3 + 2 de 28 com "Não lidas (1)" e "Urgentes (1)"; Ana Souza selecionada com "Urgente" em `--accent` e "Pessoal" com fio `--line` (M1 antigo segue fechado), prévia "Preciso do orça…" com reticências. Barra da etiqueta de 44: "Etiqueta", Pessoal ativo · Profissional · Nenhum de 28, "Urgente" de 32 ligado, "Triar agora" inteiro à direita. Sem aviso de recusa neste estado (C7 sem print). |
| `whatsapp-triagem-dark.png` | `03-whatsapp-abas-escuro` | ok | O mesmo no escuro; "Pessoal" ativo em branco, "Urgente" com texto `--on-accent`, chip "Pessoal" com fio claro visível na linha selecionada. |
| `whatsapp-light.png` | `03-whatsapp-abas-claro` | ok | Com Detalhes aberto na coluna estreita: Nenhum ativo, "Urgente" desligado com contorno, "Triar agora" inteiro; a barra não empurra o painel. |
| `whatsapp-dark.png` | `03-whatsapp-abas-escuro` | ok | O mesmo no escuro; "Nenhum" em branco legível. |
| `whatsapp-detalhes-light.png` | — | ok | Barra acima das mensagens; "+ Contato", "+ Tarefa", Resumo, Humor intactos. |
| `whatsapp-atendimento-selo-light.png` | — | ok | Abas sem contagem quando zero; "1 atendida · Pausar todos os atendimentos" abaixo das abas; chip "Recados" na prévia sem empurrar a hora; selo "Recados · atendendo" convive com a barra. |
| `whatsapp-atendimento-painel-dark.png` | — | ok | Barra da etiqueta + cabeçalho com selo + painel Atendimento; nada cortado, contraste ok. |
| `automacoes-tarefa-whatsapp-light.png` | `05-automacoes-tarefa-whatsapp-claro` | ajustar | **C8 conforme:** gatilho "Quando chega mensagem do WhatsApp", Esperar 30 s, "Incluir grupos" desligado, hint novo inteiro, aviso de R15 em 2 linhas com a barra `--accent`, Fuso, Tempo máximo, Avisos, Ligada, Salvar; sem Saída, post-it e "Pode enviar email" (`semSaida`, `semEmail: true` no check). **M1:** rótulo "Frequência" cortado pelas abas; Salvar encostado no pé. |
| `automacoes-tarefa-whatsapp-dark.png` | `05-automacoes-tarefa-whatsapp-escuro` | ajustar | O mesmo; aviso em `--bg-sunken` legível, Switch "Ligada" em `--accent`. M1 igual ao claro. |
| `automacoes-agendamentos-light.png` | — | ok | Sem a tarefa de triagem nesta fase (só "Resumo diário do smoke" e "Pendências da reunião", com "Rodar agora" como deve ser). A ausência de "Rodar agora" na triagem (C4) não tem print; check `pausado.semRodarAgora: true`. |
| `notificacoes-light.png` | `01-notificacoes-claro` | ok | Duas linhas do WhatsApp (Ana Souza com chip "Urgente", Bruno Lima), origem com `Smartphone` em `--text-faint`, hora e "3 não lidas"/"1 não lida" em `--accent`, badge "4"; segmentado de 28. |
| `notificacoes-dark.png` | `01-notificacoes-escuro` | ok | O mesmo no escuro; chip com texto `--on-accent`, iniciais legíveis. |
| `notificacoes-email-light.png` | `01-notificacoes-claro` | ok | C5: "5 por ler: 1 mensagem no WhatsApp e 4 e-mails."; quatro linhas de e-mail com `Mail` 28, "assunto · conta"; primeira linha em `--bg-sunken` com "Marcar como lida" (envelope aberto) à esquerda da hora. O print é do hover; o foco por teclado só no check (`focoTeclado: true`). |
| `notificacoes-email-dark.png` | `01-notificacoes-escuro` | ok | O mesmo no escuro; "Marcar como lida" em `--text` legível sobre a linha destacada. |
| `execucoes-light.png` | `06-automacoes-execucoes-claro` | ajustar | **M2:** a run da triagem é a última linha, cortada; a manual fica fora. Colunas, "13 execuções", "menos de US$ 0,01" e Haiku conformes; nenhum texto de mensagem na linha. |
| `execucao-detalhe-light.png` | `06b-automacoes-execucao-detalhe-claro` | ok | Detalhe de "Resumo diário do smoke" (não é run da triagem): cabeçalho da resposta "Agente do smoke 06:25" no lugar de "Claude" (C9); "Rodar de novo" presente, correto para `trigger` não-WhatsApp. C3, C4 e C9 com "Triagem do WhatsApp" sem print. |
| `agentes-light.png` | — | ok | Sem regressão: "Triagem do WhatsApp" com sino sobre `--note-orange`, descrição, "Haiku · Nenhuma reunião · Nenhum agendamento", grade 2 × 2 alinhada. C11 (texto das instruções) não aparece em tela. |
| `agentes-dark.png` | — | ok | O mesmo no escuro; "Agente do smoke" na terceira linha (cenário). |
| demais `whatsapp-*` (anexo, mídia, pareamento, risco, rascunho, interações, detalhes-contato/tarefa, atendimento-painel-light/rascunho/risco) | — | não abertos | Fora do que o contrato 171 toca; a regressão das abas, chips e barra foi conferida nos 7 `whatsapp-*` acima. |

**Ficou para depois:** M1 e M2 (enquadramento no `smoke.ts`) e, se quiser fechar a cobertura por print, quatro capturas novas: vazio pausado, barra com aviso de recusa (com Detalhes aberto), Agendamentos com a tarefa de triagem e detalhe de uma run manual da triagem.
