# Spec — notificacoes-triagem-correcoes (0.25.1)

Feature: correções dos achados do teste navegado da 0.24.0 (centro de Notificações e triagem do WhatsApp por agente).
Data: 2026-11-23 · Base: `8b55751` (main, versão 0.25.0: 0.24.0 + Painel de e-mail) · Contrato: 171 · Origem: relatório interno em `~/Documents/LAP/Entregas/meeting-scribe/2026-W48-notificacoes-triagem/relatorio-teste.pdf` · Spec de origem: `docs/specs/_archive/notificacoes-triagem/spec.md` (R1–R28, vale como referência de comportamento).

## Problema e objetivo
O teste navegado de 23/11/2026 (20:40–21:10, app instalado, contas reais) encontrou 1 defeito contra a spec (R12), 5 desvios de padrão e 4 melhorias pequenas, todos com causa localizada no código. O objetivo desta spec é fechar esses pontos numa versão 0.25.1 sem mudar o desenho das telas nem as regras de negócio N1–N8 da spec de origem.

## Requisitos

### A. Defeito (R12)
- C1. QUANDO a tarefa `whatsapp-message` existe mas não está ativa (`enabled=false`, `autoPaused` ou agendamentos pausados — `triagemSituacao` devolve `motivo:'pausado'`), as abas Urgentes/Pessoal/Profissional vazias DEVEM mostrar o estado "Nenhum agente de triagem ativo. Um agente das Automações etiqueta cada conversa que recebe mensagem." com um botão. SE `status.tarefaId` existe, o botão DEVE ser "Abrir Automações" e levar a Automações › Agendamentos (não criar uma segunda tarefa); SE não existe tarefa, continua "Criar agente de triagem" (R12). `data-triagem-vazio="sem-agente"` nos dois casos, com `data-triagem-vazio-acao="abrir"|"criar"`.

### B. Desvios de padrão
- C2. "Triar agora" (`runNow`) DEVE respeitar `schedule.grupos`: para grupo com `grupos=false` devolve `{ok:false, error:'grupos'}` e a barra mostra "Grupos estão fora da triagem. Ligue “Incluir grupos” na tarefa." (`TriagemRunError` ganha `'grupos'`; `TRIAGEM_RUN_ERRORS` ganha o texto).
- C3. A execução de uma triagem manual DEVE ser distinguível: `prompt` = "Triagem da conversa <nome> · N mensagens novas · Triar agora" quando `manual`; o automático fica como está. `trigger` continua `'whatsapp'` (o teto diário conta pelos dois).
- C4. "Rodar agora" (lista de Agendamentos) e "Rodar de novo" (detalhe da execução) NÃO DEVEM aparecer para tarefa `whatsapp-message` / execução com `trigger:'whatsapp'`; e `startTask` DEVE recusar esse kind com `{ok:false, error:'invalid'}` (defesa no main, cobre `rerun` e IPC direto).
- C5. "Marcar como lida" em Notificações DEVE ficar visível quando a linha recebe foco de teclado (`group-focus-within:opacity-100`, como `ChatHistory.tsx:209` e os demais "ghost ao hover" do app), além do hover e do foco do próprio botão.
- C6. O `motivo` da triagem DEVE ser cortado na última palavra inteira com "…" quando passar de 160 caracteres (`cortarMotivo` em `shared/triagem.ts`, usado em `classify.ts` e em `aplicarAgente`), e o system prompt DEVE pedir ao modelo "em até 120 caracteres". O resultado continua ≤160 e válido no `etiquetaSchema`.
- C7. O aviso de recusa na barra da etiqueta ("A triagem está desligada em Configurações.", "Grupos estão fora…", etc.) NÃO DEVE ser truncado: a barra passa a `min-h-11` com o texto em até 2 linhas (`line-clamp-2`), mantendo os controles alinhados à esquerda e o aviso + "Triar agora" à direita.

### C. Melhorias
- C8. Formulário da tarefa com gatilho WhatsApp: o hint da Frequência DEVE dizer "Roda em cada conversa que recebe mensagem, N s depois da última. Grupos ficam de fora." (ou "…, inclusive grupos."); o select "Saída", a "Reunião do post-it" e o bloco "Pode enviar email" NÃO DEVEM aparecer nesse gatilho, e ao trocar para ele o formulário zera `output` e desliga `emailDraft`.
- C9. No detalhe da execução, o cabeçalho da resposta DEVE mostrar o nome do agente (`run.agentName`, ex.: "Triagem do WhatsApp") em vez de "Claude" fixo; o Assistente continua "Claude".
- C10. "Triar agora" DEVE manter o estado "Triando…" até a triagem terminar: evento novo `scribe:triagem-done {chatId, ok}` emitido no fim de `triar` (sucesso, falha ou timeout); o renderer solta `running` nesse evento ou após 35 s.
- C11. Instruções do agente modelo "Triagem do WhatsApp" (`EXAMPLE_AGENTS`) DEVEM dizer explicitamente: contato do funil pende para profissional mesmo em conversa informal; conversa só com anexos, robôs de saldo/notificação ou sem pedido explícito não é urgente; urgente exige pedido com prazo ou cobrança de resposta. Só o texto do modelo; quem já tem o agente criado não é alterado.

## Regras de negócio
- Valem N1–N8 da spec de origem. Nada aqui cria caminho de envio, não muda o teto diário nem o debounce.
- Mensagem de recusa nunca contém texto de mensagem.

## Telas de impacto no usuário
1. WhatsApp › abas (estado vazio com tarefa pausada: texto + botão "Abrir Automações"). 2. WhatsApp › barra da etiqueta (aviso em até 2 linhas; "Triando…" durável; recusa para grupo). 3. Notificações (botão visível no foco). 4. Automações › Agendamentos (sem "Rodar agora" na tarefa de triagem; formulário sem Saída/e-mail nesse gatilho; hint novo). 5. Automações › Execuções (sem "Rodar de novo"; título com o nome do agente; prompt "· Triar agora" nas manuais). Nenhuma tela nova; sem mockup novo (mudanças de texto/visibilidade dentro das telas já aprovadas).

## Fora de escopo
- Custo do Assistente com todas as fontes (observação 12 do relatório).
- Prova "responder tira o Urgente" no app (coberta pelo smoke `triagem.respondeu`).
- Tema escuro e hover (o smoke já captura light/dark).
- Pendência das 500 runs × 300 triagens/dia.

## Verificação end-to-end
1. Smoke: novo check `triagem.pausado` (tarefa `enabled=false` → `[data-triagem-vazio="sem-agente"]` com `data-triagem-vazio-acao="abrir"`; clique leva a Automações); check `triagem.manualGrupo` (`runNow` num grupo com `grupos=false` → `{ok:false,error:'grupos'}`, nenhuma run); `triagem.manual` passa a conferir `prompt` terminando em "· Triar agora"; `notificacoes`: foco por teclado na linha de e-mail deixa `[data-notificacao-lida]` com opacidade 1.
2. Testes unitários: `cortarMotivo` (corte em palavra, "…", ≤160), `startTask` recusa `whatsapp-message`, `runNow` recusa grupo, prompt manual.
3. Gate completo verde; auditoria dos prints `whatsapp-triagem-vazio-*`, `automacoes-tarefa-whatsapp-*` (sem Saída/e-mail) e `notificacoes-*`.
4. Teste navegado curto na 0.25.1 instalada (sessão nova): os 9 pontos acima mais o caminho "Abrir Automações" do estado pausado.
