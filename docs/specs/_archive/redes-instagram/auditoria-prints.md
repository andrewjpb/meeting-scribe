---
feature: redes-instagram
contrato: 77
data: 2026-11-20
semana: 2026-W47
---

# Auditoria dos prints do smoke (redes-instagram)

Os 30 prints de `apps/desktop/out/smoke/` da feature, claro e escuro, gravados pelo smoke de 20/11/2026 às 17:30 (gates verdes no começo do contrato 77, 211 PNGs, `expectedShots` inalterado): `redes-*` (20), `contas-instagram-*` (2), `contas-midia-s3-*` (2), `sidebar-redes-*` (2), `assistente-cartao-rascunho-*` (2) e `assistente-contexto-redes-*` (2). Os de tela cheia foram abertos um a um (2240×1480); os demais, em folhas de contato de 2×2 com cada print a 1000 px de largura. Procurei: corte de texto fora de truncamento com reticências, alinhamento, cor fora do tema, texto técnico na interface e densidade inconsistente com o resto do app (controles de 32/28, linhas de 44, cabeçalhos de painel de 44, títulos 20/15, `.label` 11 em caixa normal).

Resumo: nada quebrado. Nenhum texto cortado sem reticências, nenhuma cor fora dos tokens nos dois temas, nenhum controle de 40, nenhum rótulo em caixa alta. Nenhuma correção de uma linha coube aqui (os dois textos candidatos são conferidos pelo smoke ou estão descritos de propósito no código; ver P4 e P5). Seis pendências, nenhuma bloqueante.

## Pendências

- **P1 (CSP, já conhecida):** em Configurações › Contas, a conta conectada mostra o símbolo da LAP no lugar da foto do perfil (`contas-instagram-*`). A tela só aceita a foto como data URL e o main ainda não baixa a `profile_picture_url`. Precisa de um passo no main (baixar só da CDN da Meta, só JPEG, como as miniaturas dos comentários).
- **P2 (layout do editor):** no painel de 300 px, o rodapé do editor quebra em duas linhas: "Salvar rascunho" sozinho e, abaixo, "Agendar" e "Publicar agora" (`redes-editor-*`, `redes-editor-sem-s3-*`). Não corta nada, mas gasta 44 px de altura num painel que já rola. Opções: rótulo "Salvar" ou os três botões compactos de 28. Decisão de desenho, não de uma linha.
- **P3 (métricas, sugestão):** na tabela de Publicações, a coluna da legenda fica com ~190 px numa janela de 1120 e trunca quase todos os títulos ("Três dicas para pautas …"), enquanto as seis colunas de número têm 96 px cada para números de até 5 dígitos (`redes-metricas-*`). Colunas de 80 dariam ~100 px a mais para a legenda; precisa conferir se "Visualiz." com a seta de ordenação cabe. Também nos cartões: 11 números em grade de 5 deixam "Toques em links" sozinho na terceira linha.
- **P4 (texto, sugestão):** o contador do cartão "Rascunho para o Instagram" do Assistente é "218/2.200 · 2 # · 0 @" e o do editor é "152/2.200 · 2 hashtags · 1 @" (`assistente-cartao-rascunho-*` × `redes-editor-*`). A forma curta do cartão está documentada em `ActionCards.tsx`; unificar é decisão de texto.
- **P5 (texto, sugestão):** o problema de mídia no editor sai como "logo.png: Só JPEG é aceito para imagem" (maiúscula depois dos dois-pontos; `redes-editor-sem-s3-*`). A frase está em `main/redes/media-check.ts` e é conferida literalmente pelo smoke, então mexer nela é mexer no smoke junto.
- **P6 (dado do smoke, sugestão):** em Mensagens, quando o contato não tem nome, o cabeçalho da conversa repete o @ ("marina.alves" e, abaixo, "@marina.alves · Última mensagem…"; `redes-mensagens-*`). Com nome real o cabeçalho fica certo; dá para esconder o @ quando o nome é o próprio @.

Fora desta feature e já registrada: a tabela de Tarefas agendadas apertada na janela de 1120 (auditoria da densidade, P2).

## Por print

| Print | Laudo |
|---|---|
| `assistente-cartao-rascunho-dark.png` | ok; contador curto "2 # · 0 @" (P4). |
| `assistente-cartao-rascunho-light.png` | ok; contador curto "2 # · 0 @" (P4). Cartão com a legenda, "Sem mídia e sem data…", "Criar rascunho", "Editar", "Descartar" e a nota "Nada é publicado daqui". |
| `assistente-contexto-redes-dark.png` | ok; fonte Redes no painel Contexto com a descrição em 12. |
| `assistente-contexto-redes-light.png` | ok. |
| `contas-instagram-dark.png` | ok no tema; símbolo da LAP no lugar da foto (P1). |
| `contas-instagram-light.png` | ok; símbolo da LAP no lugar da foto (P1). Token, nota do pré-requisito, 4 passos, conta com "Conectada", "Renovar agora", "Remover" e a linha de 44 do intervalo de leitura. |
| `contas-midia-s3-dark.png` | ok. Os endereços `http://127.0.0.1:9/…` e a chave `AKSMOKEFALSA0000` são dados do smoke. |
| `contas-midia-s3-light.png` | ok; linhas de 44 com campos de 32, "Salvar", "Testar", "Remover" e a nota "Upload e leitura pública ok". |
| `redes-comentarios-dark.png` | ok. |
| `redes-comentarios-light.png` | ok; lista de 300 com linhas de 44, cabeçalho da publicação de 44, resposta aninhada, campo de resposta aberto, comentário oculto marcado. O texto `<script>…` do comentário oculto é o teste de injeção do smoke, mostrado como texto. |
| `redes-editor-dark.png` | ok no tema; rodapé em duas linhas (P2). |
| `redes-editor-light.png` | ok; painel de 300 com cabeçalho de 44, mídias de 96, legenda com contador; rodapé em duas linhas (P2). |
| `redes-editor-sem-s3-dark.png` | ok no tema; P2 e P5. |
| `redes-editor-sem-s3-light.png` | ok; nota "Imagens precisam do armazenamento…" com "Configurar armazenamento"; P2 e P5. |
| `redes-mensagens-dark.png` | ok; @ repetido no cabeçalho (P6). |
| `redes-mensagens-janela-dark.png` | ok. |
| `redes-mensagens-janela-light.png` | ok; nota "Fora da janela de 24 h: o Instagram pode recusar." acima do campo; P6. |
| `redes-mensagens-light.png` | ok; conversas de 280 com linhas de 44, balões em 14/22, contador de bytes; P6. |
| `redes-mensagens-sem-acesso-dark.png` | ok. |
| `redes-mensagens-sem-acesso-light.png` | ok; nota de 640 sem vermelho, "Como liberar" em 3 passos e "Tentar de novo". |
| `redes-metricas-dark.png` | ok no tema; P3. |
| `redes-metricas-light.png` | ok; cartões com `.label` 11 e número 20 peso 700, segmentado 7/28/90, nota de 48 h; P3. |
| `redes-publicacao-erro-dark.png` | ok. |
| `redes-publicacao-erro-light.png` | ok; linha com erro em três linhas, "Tentar de novo" e "Editar" no hover. |
| `redes-publicacoes-dark.png` | ok. |
| `redes-publicacoes-light.png` | ok; grupos com `.label` 11 e contagem, linhas de 44 com miniatura de 36, cota da Meta na linha de apoio. |
| `redes-vazio-dark.png` | ok. |
| `redes-vazio-light.png` | ok; "Nenhuma conta conectada" com a ilustração e "Conectar conta"; o nível Redes só com "Conectar conta…" no pé. |
| `sidebar-redes-dark.png` | ok. |
| `sidebar-redes-light.png` | ok; nível Redes com o @, quatro seções de 28 com recuo de 28 e "Conectar conta…" preso no pé; estado vazio de Comentários. |
