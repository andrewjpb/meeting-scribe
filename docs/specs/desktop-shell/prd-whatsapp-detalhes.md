# PRD — WhatsApp em 3 colunas com Detalhes por IA
Feature: desktop-shell · Wave: 32 · Data: 18/11/2026 · Pedido do Andrew (18/11 15:30, com mockup messenger)

## Problema
A tela do WhatsApp é funcional mas crua: lista sem foto, balões simples e nenhuma visão da conversa como um
todo. O Andrew quer o estilo dos messengers modernos (foto, nome, balões bonitos) e, principalmente, um painel
de "Detalhes" que a IA preencha ao abrir a conversa: resumo, pontos importantes, humor da pessoa e gráficos.

## Solução
Três colunas no design da LAP (branco/azul, tokens): lista com **foto de perfil** (busca nova no WhatsApp, com
avatar de iniciais quando não houver), nome, prévia e hora; conversa com balões (as suas em azul `accent`);
painel direito **"Detalhes"** com: resumo + pontos importantes (IA), **humor** da pessoa (Satisfeito · Neutro ·
Insatisfeito com justificativa e linha do tempo), **pendências em aberto** (suas e deles) e **compromissos
citados** (IA), e **gráficos locais** (atividade por dia e equilíbrio de quem fala) desenhados em SVG leve.
A análise roda local (Claude), é cacheada por conversa e só refaz quando chegam mensagens novas.

## O que NÃO é
- A IA continua **nunca enviando mensagem** (envio só no clique + diálogo nativo, como hoje).
- Não baixa mídia (fotos/áudios das mensagens seguem como metadado).
- O humor é uma leitura aproximada do texto, apresentada como tal.

## Telas de impacto no usuário
- WhatsApp: lista com fotos, balões novos, painel Detalhes com resumo/pontos/humor/pendências/compromissos/
  gráficos e rodapé de custo (modelo · tempo · US$).
- Configurações › Claude: interruptor "Detalhes com IA no WhatsApp" (padrão ligado).

## Riscos
- Foto de perfil exige rota nova no bridge (neonize) — quando o WhatsApp não der a foto, cai nas iniciais.
- Custo: 1 chamada por conversa aberta quando há mensagem nova; mitigado pelo cache e pelo interruptor.
