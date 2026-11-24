---
feature: pastas-assistente
contrato: 169
status: concluido
data: 2026-11-23
semana: 2026-W48
base: pastas-assistente 1959987 + diff do contrato 169
---

# Auditoria dos prints do smoke (pastas-assistente)

Prints das 8 telas novas nos dois temas (16 PNGs de 2240×1480, `out/smoke/`, copiados para o scratchpad da sessão para a
comparação), da rodada do smoke de 23/11/2026. Cada print foi aberto inteiro e comparado com o quadro correspondente de
`mockups/png/` e com `docs/specs/desktop-shell/design.md` (seção "Pastas do Assistente"). Os mockups são só claros: o
escuro foi conferido contra o claro (mesmo estado, tokens do escuro).

## O que procurar em todos

Corte, sobreposição, texto técnico (id, JSON, `pasta:`, "undefined", nome técnico do cartão), cor fora dos tokens,
contraste no escuro, nome cortado sem reticências, sombra, pílula, raio acima de 6. No `report.json`: os `detail` de
`pastas.*` só com números e booleanos; nenhum nome da pasta sintética nem do email do Michel em lugar nenhum do relatório.

## Resultado

| Tela | Mockup | Claro | Escuro | Observação |
|---|---|---|---|---|
| `configuracoes-claude-pastas` | 01 | ok | ok | Seção logo depois de "Chat e resumo" (o fim dela no topo do quadro, como no mockup); linha com ícone de 32, nome, caminho cortado com reticências e Remover; "Adicionar pasta…" com a dica. O caminho é o do userData temporário do smoke (`/private/var/…`), por isso sem `~`. |
| `configuracoes-claude-pastas-recusa` | 02 | ok | ok | Dois avisos (`Note` com o triângulo), "Pasta pessoal, Library ou do sistema…" e "Essa pasta já está na lista…", abaixo da seção, sem cobrir "Automações". |
| `assistente-contexto-pastas` | 03a | ok | ok | Linha Pastas logo depois do Email, ligada, com a descrição. A resposta da conversa é a pergunta neutra do smoke ("Nas pastas há 5 arquivo(s) listado(s)."), não a das citações do mockup. Sem o realce de fundo da linha (o realce do mockup marcava o que era novo). |
| `assistente-contexto-pastas-vazia` | 03b | ok | ok | "Nenhuma pasta escolhida · Configurações" com o link sublinhado em `--accent` e o interruptor desabilitado. |
| `assistente-resposta-pasta` | 04 | ajuste (feito) | ajuste (feito) | Na primeira rodada o print parava nos passos abertos e a citação ficava abaixo da dobra; na segunda, o `scrollIntoView` rolou também a raiz da janela (a tela subiu e sobrou uma faixa vazia embaixo). O smoke agora rola só a coluna da conversa até a citação (`centerIn`), e o print final mostra os passos e a citação com o ícone de pasta, sem deslocamento. Os passos mostram "Lendo um arquivo da pasta: «proposta-exemplo.docx» (1 KB)"; o raciocínio do agente falso ("A pessoa perguntou… sem HTML") é texto do agente falso de sempre, não da tela. |
| `assistente-cartao-anexos` | 05 | ok | ok | Seção Anexos com "pedido → pasta/caminho · tamanho", "Não encontrado: comprovante de inscrição estadual" com o triângulo em `--rec`, "Total: 2 KB de 20 MB", Abrir no Composer (primário), Abrir o email, Descartar, sem Enviar, e a nota "Nada sai daqui…". A primeira linha corta o tamanho ("591 byt…") com reticências porque o caminho sintético é longo: comportamento do desenho (uma linha com reticências), não sobreposição. |
| `email-composer-anexos` | 06 | ok | ok | Composer "Responder" com Para, Assunto "Re: Documentos para o contrato", o texto do cartão com a assinatura da conta e os 2 chips de anexo (nome, tamanho, ×) e "2 KB" ao lado do clipe. Sem as linhas do desenho que o Composer de hoje não tem ("Em resposta a", "Anexos vindos da pasta …" e a citação do email original): ver Pendências do plan. |
| `assistente-cartao-aberto` | 07 | ok | ok | Cartão sem o campo de texto, com o texto proposto e "Aberto no Composer" com o ✓. |

**Resumo:** 16 PNGs, 14 ok e 2 com ajuste já feito no smoke (o enquadramento do `assistente-resposta-pasta` nos dois
temas). Nenhuma cor fora da paleta, nenhuma sombra, nenhuma pílula, nenhum id, `pasta:` ou JSON na interface.

**`report.json`, privacidade:** os `detail` de `pastas.configuracoes`, `indice`, `leitura`, `abrir`, `acaoRecusada`,
`cartaoAnexos`, `desligado` e `estadoFinal` só têm números e booleanos (e `tipos: "docx,pdf,pptx,txt,xlsx"`, as
extensões fixas da fixture). `pasta-exemplo`, `proposta-exemplo`, `contrato-exemplo` e `Michel`: 0 ocorrências no
relatório (o smoke reprova se aparecerem; o arquivo revelado em `openedFiles` sai como "(arquivo das pastas do Assistente)").
