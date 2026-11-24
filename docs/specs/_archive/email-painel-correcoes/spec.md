---
feature: email-painel-correcoes
status: implementada-2026-11-24 (0.26.2, arquivada)
versao: 0.26.2
origem: teste navegado da 0.25.0 (relatorio-teste-email-painel-0.25.0.pdf, 23/11/2026)
---

# Spec — Correções do Painel de e-mail (teste navegado da 0.25.0)

## Problema e objetivo
O teste navegado da 0.25.0 nas contas reais (Zoho e Gmail) achou um defeito alto e um médio no Painel de e-mail. O Desfazer dos lotes do Painel falha em contas cuja Caixa de Entrada tem caminho diferente de `INBOX` na listagem (Zoho: "Caixa de entrada"), porque o lote grava a origem fixa `INBOX`. E a Caixa de Entrada não mostra a faixa "O Painel moveu N mensagens" depois de um mover pelo Painel, porque a faixa da pasta só nasce dos eventos do Assistente. Objetivo: Desfazer funcionando em toda conta, inclusive para os lotes já gravados pela 0.25.0, e a faixa aparecendo na pasta de origem como aparece para o Assistente.

## Requisitos
- R1 (revista após a revisão do 173). QUANDO o Painel move mensagens (Mover ou Mover todos), O SISTEMA DEVE continuar gravando `fromPath: 'INBOX'` e movendo a partir de `INBOX`: é o nome canônico do protocolo IMAP, válido em todo servidor, e é o único que o serviço de mover (`service.ts` `moveQueued`) reconhece como entrada para atualizar a lista local e marcar as voltas como "movidas de volta" em vez de e-mail novo. Nenhum caminho localizado ("Caixa de entrada") vai ao servidor nem ao serviço.
- R2. QUANDO o Desfazer encontra um item com `fromPath` `INBOX` (qualquer caixa) e a listagem não tem uma pasta com esse caminho exato, O SISTEMA DEVE considerar a origem existente se a listagem tiver uma pasta de entrada (`specialUse` de entrada) em vez de falhar com `origin-missing`, e seguir a volta usando `INBOX` como caminho (não o caminho da listagem). Cobre os lotes gravados pela 0.25.0 e os novos.
- R3. QUANDO um lote do Painel é criado, O SISTEMA DEVE fazer a faixa da pasta de origem aparecer na Caixa de Entrada com o título "O Painel moveu N mensagens" (singular "1 mensagem"), hora e Desfazer, pelo mesmo caminho que a faixa do Assistente usa (eventos de organização de hoje ou equivalente), sem duplicar faixa quando o Painel já mostra a sua.
- R4. O Desfazer pela faixa da Caixa de Entrada devolve as mensagens e a faixa diz "Desfeito", como no Assistente.
- R5. Nada muda no que é enviado ao modelo, nos canais IPC existentes, no design system nem nos textos aprovados do mockup.

## Regras de negócio
- N1. Nada é movido sem clique; o Desfazer continua um clique.
- N2. Nenhum e-mail, assunto, remetente ou endereço em log ou no `detail` do smoke (R36).

## Telas de impacto no usuário
- Caixa de Entrada: passa a mostrar a faixa "O Painel moveu N mensagens · hora · Desfazer" depois de um mover pelo Painel. Nenhuma tela nova.
- Painel: sem mudança visível; o Desfazer passa a funcionar nas contas Zoho.

## Fora de escopo
- F1. Achados baixos do teste: contas homônimas iguais no Painel; custo e rótulo do modelo após passada com 0 analisados; faixa de erro sticky; link da nota abrindo a aba no topo. Ficam registrados como pendências.
- F2. Qualquer mudança no Assistente, nas regras ou na organização a pedido.

## Verificação end-to-end
Numa conta cuja Caixa de Entrada tenha caminho diferente de `INBOX` (teste de unidade com listagem falsa e, no smoke, a pasta de entrada do servidor falso renomeada ou uma conta extra com `specialUse` de entrada em "Caixa de entrada"): Mover todos pelo Painel → o lote tem `fromPath` igual ao caminho real → Desfazer pelo Painel devolve tudo; abrir a Caixa de Entrada mostra "O Painel moveu N mensagens" com Desfazer. Um lote antigo com `fromPath: 'INBOX'` e listagem sem `INBOX` → Desfazer funciona.
