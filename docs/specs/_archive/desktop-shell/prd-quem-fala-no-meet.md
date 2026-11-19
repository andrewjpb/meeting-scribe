# PRD — Quem fala no Meet (extensão do Chrome + app)
Feature: desktop-shell · Wave: 27 · Data: 18/11/2026 · Pedido do Andrew (18/11/2026 09:29)

## Problema
O app grava o áudio do sistema e transcreve, mas a transcrição não diz **quem** falou cada trecho. O Claude Meetings (Anthropic, 11/2026) e concorrentes (Fireflies, Otter, Vexa) entram na reunião como bot e entregam a fala com o nome. O Andrew quer isso no LAP Reuniões, começando pelo Google Meet — sem bot: o app já está na máquina de quem participa.

## Solução
Uma extensão do Chrome (Manifest V3, sem build) rodando em `meet.google.com`:
- lê a lista de participantes e o indicador de "quem está falando agora" no DOM do Meet;
- manda para o app, por WebSocket em `127.0.0.1`, eventos `{ nome, falando: true|false, ts }` e a lista de participantes;
- **não** usa as legendas: a transcrição continua sendo a nossa, do áudio gravado.

O app guarda a linha do tempo de falas junto da gravação em andamento e, na transcrição, cruza por horário: cada trecho ganha o nome de quem falava naquele momento (ou "Ana + Bruno" quando duas pessoas falam juntas).

## O que NÃO é
- Não é bot: nada entra na reunião; nenhum participante novo aparece.
- Não envia nada para fora: extensão → app é só localhost; o app não responde comandos à extensão.
- Não usa legendas do Meet nem áudio da aba; o áudio continua vindo da captura do sistema.
- Zoom/Teams ficam para depois.

## Telas de impacto no usuário
- Gravação em andamento: uma linha "Meet conectado · N participantes" quando a extensão está ligada.
- Transcrição/Resumo: os trechos ganham o nome de quem falou.
- A extensão em si (fora do app): instalada à mão no Chrome (carregar sem compactar), sem tela própria além do ícone.

## Riscos
- O DOM do Meet muda sem aviso → a extensão quebra e o app só perde os nomes (a gravação não é afetada). Mesmo risco dos concorrentes.
- Duas pessoas falando juntas → atribuição dupla, marcada como tal.
- Segurança: a porta local só aceita origem `chrome-extension://` e trata todo dado recebido como dado (zod, limites de tamanho), nunca como instrução.
