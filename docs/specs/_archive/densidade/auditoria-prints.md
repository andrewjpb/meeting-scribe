---
feature: densidade
contrato: 83
data: 2026-11-20
semana: 2026-W47
---

# Auditoria dos prints do smoke (densidade)

Os 175 prints de `apps/desktop/out/smoke/` gravados pelo smoke de 20/11/2026 (gates verdes no começo do contrato 83, `expectedShots` inalterado), claro e escuro. Revisados em folhas de contato de 2×2 (cada print a ~1000 px de largura) procurando: corte de texto, sobreposição, espaço morto, desalinhamento de fio entre colunas, rótulo em caixa alta sobrando, controle de 40 sobrando e texto técnico na interface.

Resumo: nenhum controle de 40, nenhum rótulo de seção em caixa alta (a caixa alta que aparece é só a da fita, "VOCÊ" / "PARTICIPANTES" / "PARTICIPANTE A", e "LAP SOFTWARE"), nenhum texto cortado fora de truncamento com reticências. Uma correção de uma linha feita aqui (faixa da agenda) e uma pendência.

## Pendências

- **P1 (fora do escopo, já planejada):** o Assistente ainda mostra o cabeçalho de página "Assistente / Pergunte ou peça qualquer coisa…" (prints `assistente-*`, `perguntar-*`, `sidebar-assistente-*`). Sai com o contrato 78 na junção da branch `assistente-agenda`; os artboards já estão sem ele.
- **P2:** tabela de Tarefas agendadas (`tarefas-light.png`) apertada na janela de 1120: cabeçalho "Última execução" em duas linhas, nome da tarefa quebrando e as ações (Rodar agora, Editar, Duplicar, Excluir) em duas linhas por tarefa. Precisa de decisão de layout (ações num menu "…" ou coluna mais larga), não é de uma linha.

## Por print

| Print | Laudo |
|---|---|
| `agente-editar-light.png` | ok |
| `agentes-dark.png` | ok |
| `agentes-light.png` | ok |
| `assistente-contexto-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-contexto-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-lote-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-lote-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-lote-parcial-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-lote-parcial-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-email-rascunho-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-internet-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-lembrete-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `assistente-whatsapp-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `automacoes-internet-light.png` | ok |
| `aviso-reuniao-light.png` | ok |
| `barra-marca-propria-light.png` | ok |
| `bloqueado-dark.png` | ok |
| `bloqueado-gravando-light.png` | ok |
| `bloqueado-light.png` | ok |
| `conexoes-adicionar-light.png` | ok |
| `conexoes-conectores-dark.png` | ok |
| `conexoes-conectores-light.png` | ok |
| `configuracoes-agenda-light.png` | ok |
| `configuracoes-arquivos-dark.png` | ok |
| `configuracoes-arquivos-light.png` | ok |
| `configuracoes-atualizacoes-light.png` | ok |
| `configuracoes-bloqueio-light.png` | ok |
| `configuracoes-busca-email-dark.png` | ok |
| `configuracoes-busca-email-light.png` | ok |
| `configuracoes-busca-light.png` | ok |
| `configuracoes-claude-dark.png` | ok |
| `configuracoes-claude-light.png` | ok |
| `configuracoes-conexoes-dark.png` | ok |
| `configuracoes-conexoes-light.png` | ok |
| `configuracoes-contas-dark.png` | ok |
| `configuracoes-contas-light.png` | ok |
| `configuracoes-contas-logado-dark.png` | ok |
| `configuracoes-contas-logado-light.png` | ok |
| `configuracoes-email-dark.png` | ok |
| `configuracoes-email-light.png` | ok |
| `configuracoes-email-pop3-dark.png` | ok |
| `configuracoes-email-pop3-light.png` | ok |
| `configuracoes-email-regra-convite-dark.png` | ok |
| `configuracoes-email-regra-convite-light.png` | ok |
| `configuracoes-email-regra-dark.png` | ok |
| `configuracoes-email-regra-light.png` | ok |
| `configuracoes-geral-dark.png` | ok |
| `configuracoes-geral-light.png` | ok |
| `configuracoes-gravacao-dark.png` | ok |
| `configuracoes-gravacao-light.png` | ok |
| `configuracoes-plugins-light.png` | ok; "Salvo em /private/var/…" é a pasta temporária do smoke. |
| `configuracoes-seletor-dark.png` | ok |
| `configuracoes-seletor-light.png` | ok |
| `configuracoes-sobre-light.png` | ok |
| `configuracoes-whatsapp-light.png` | ok |
| `detalhe-anotacoes-dark.png` | ok |
| `detalhe-anotacoes-light.png` | ok |
| `detalhe-arquivos-light.png` | ok |
| `detalhe-audio-light.png` | ok |
| `detalhe-dark.png` | ok |
| `detalhe-drive-light.png` | ok |
| `detalhe-light.png` | ok |
| `detalhe-perguntas-abertas-light.png` | ok |
| `detalhe-resumo-dark.png` | ok |
| `detalhe-resumo-light.png` | ok |
| `email-composer-assinatura-dark.png` | ok |
| `email-composer-assinatura-light.png` | ok |
| `email-composer-dark.png` | ok |
| `email-composer-light.png` | ok |
| `email-convite-atualizado-dark.png` | ok |
| `email-convite-atualizado-light.png` | ok |
| `email-convite-cancelado-dark.png` | ok |
| `email-convite-cancelado-light.png` | ok |
| `email-convite-configuracoes-agendas-dark.png` | ok |
| `email-convite-configuracoes-agendas-light.png` | ok |
| `email-convite-configuracoes-dark.png` | ok |
| `email-convite-configuracoes-light.png` | ok |
| `email-convite-configuracoes-sem-acesso-dark.png` | ok |
| `email-convite-configuracoes-sem-acesso-light.png` | ok |
| `email-convite-enviando-dark.png` | ok |
| `email-convite-enviando-light.png` | ok |
| `email-convite-gmail-dark.png` | ok |
| `email-convite-gmail-light.png` | ok |
| `email-convite-ja-na-agenda-dark.png` | ok |
| `email-convite-ja-na-agenda-light.png` | ok |
| `email-convite-juntado-dark.png` | ok |
| `email-convite-juntado-light.png` | ok |
| `email-convite-lista-dark.png` | ok |
| `email-convite-lista-light.png` | ok |
| `email-convite-na-agenda-dark.png` | ok |
| `email-convite-na-agenda-light.png` | ok |
| `email-convite-nao-e-para-voce-dark.png` | ok |
| `email-convite-nao-e-para-voce-light.png` | ok |
| `email-convite-nao-encontrado-dark.png` | ok |
| `email-convite-nao-encontrado-light.png` | ok |
| `email-convite-novo-dark.png` | ok |
| `email-convite-novo-light.png` | ok |
| `email-convite-repeticao-dark.png` | ok |
| `email-convite-repeticao-light.png` | ok |
| `email-convite-resposta-recebida-dark.png` | ok |
| `email-convite-resposta-recebida-light.png` | ok |
| `email-convite-sem-acesso-dark.png` | ok |
| `email-convite-sem-acesso-light.png` | ok |
| `email-convite-sugestao-dark.png` | ok |
| `email-convite-sugestao-light.png` | ok |
| `email-dark.png` | ok |
| `email-leitura-dark.png` | ok |
| `email-leitura-light.png` | ok |
| `email-light.png` | ok |
| `email-mais-dark.png` | ok |
| `email-mais-light.png` | ok |
| `email-menu-mensagem-dark.png` | ok |
| `email-menu-mensagem-light.png` | ok |
| `email-menu-pasta-dark.png` | ok |
| `email-menu-pasta-light.png` | ok |
| `email-mover-dark.png` | ok |
| `email-mover-light.png` | ok |
| `email-organizando-dark.png` | ok |
| `email-organizando-light.png` | ok |
| `email-organizando-parado-dark.png` | ok |
| `email-organizando-parado-light.png` | ok |
| `email-pastas-dark.png` | ok; idem. |
| `email-pastas-light.png` | ok; o rótulo "Mover 3 mensagens para ABF" sobre a lista é a imagem do arrasto, de propósito. |
| `execucao-detalhe-light.png` | ok |
| `execucao-emails-light.png` | ok |
| `execucoes-light.png` | ok (tabela densa `py-1.5`, 10 linhas cabem sem rolar). |
| `gravacao-analise-dark.png` | ok |
| `gravacao-analise-light.png` | ok |
| `gravacao-anotacoes-dark.png` | ok |
| `gravacao-anotacoes-light.png` | ok |
| `gravacao-ao-vivo-dark.png` | ok |
| `gravacao-ao-vivo-light.png` | ok |
| `gravacao-aviso-dark.png` | ok |
| `gravacao-aviso-light.png` | ok |
| `gravacao-dark.png` | ok |
| `gravacao-eco-light.png` | ok |
| `gravacao-faixa-agenda-light.png` | **corrigido**: a faixa da agenda ficava a 40 da borda (`px-10`) e o título da página a 32; `CalendarBanner.tsx` passou a `px-8`. |
| `gravacao-light.png` | ok |
| `perguntar-acp-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `perguntar-aprovacao-mcp-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `perguntar-contexto-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `perguntar-v2-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `perguntar-v2-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `perguntar-vazio-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `reunioes-busca-light.png` | ok |
| `reunioes-com-dados-dark.png` | ok |
| `reunioes-com-dados-light.png` | ok |
| `reunioes-dark.png` | ok |
| `reunioes-light.png` | ok |
| `reunioes-lista-dark.png` | ok |
| `reunioes-lista-light.png` | ok |
| `reunioes-proximas-light.png` | ok |
| `sidebar-assistente-dark.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `sidebar-assistente-light.png` | ok na densidade; ainda com o cabeçalho "Assistente / Pergunte…", que sai com o contrato 78 (branch `assistente-agenda`), fora deste contrato. |
| `sidebar-configuracoes-dark.png` | ok |
| `sidebar-configuracoes-light.png` | ok; os caminhos absolutos no bloco "Ver detalhes" do MCP são o dado que a pessoa pediu para ver (não é texto técnico de interface). |
| `sidebar-email-dark.png` | ok |
| `sidebar-email-light.png` | ok |
| `sidebar-raiz-dark.png` | ok |
| `sidebar-raiz-light.png` | ok |
| `tarefa-editar-light.png` | ok |
| `tarefa-email-light.png` | ok |
| `tarefas-light.png` | **pendência P2**: na tabela de tarefas a 896 px úteis, "Última execução" quebra em duas linhas no cabeçalho, o nome da tarefa quebra e as quatro ações caem em duas linhas por tarefa (linha de 56 em vez de 28–32). |
| `whatsapp-anexo-light.png` | ok |
| `whatsapp-dark.png` | ok |
| `whatsapp-detalhes-light.png` | ok; o balão do topo cortado sob o cabeçalho é rolagem, não corte de layout. |
| `whatsapp-interacoes-light.png` | ok; idem (balão do pé cortado pela rolagem). |
| `whatsapp-light.png` | ok; avatares em bloco azul liso são a foto de teste do smoke. |
| `whatsapp-midia-light.png` | ok |
| `whatsapp-pareamento-light.png` | ok |
| `whatsapp-rascunho-light.png` | ok. |
| `whatsapp-risco-light.png` | ok |
