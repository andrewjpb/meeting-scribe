# Contrato 169 — Pastas do Assistente: smoke `pastasChecks`, pasta sintética, telas no smoke, docs permanentes e auditoria de prints

Feature: pastas-assistente  ·  Wave: 4  ·  Depende de: 167, 168  ·  Gate humano: mockups aprovados em 23/11/2026

Constituição: `~/CLAUDE.md` e `docs/specs/desktop-shell/design.md`. Prevalecem sobre este contrato.

## Pré-condições
- Worktree `~/Documents/GitHub/meeting-scribe-pastas-assistente`, branch `pastas-assistente`, 165–168 commitados; gates rápidos verdes; tela do Mac desbloqueada para o smoke (~25 min); nada pesado rodando em paralelo.
- Nunca deixar nada além do próprio smoke em `apps/desktop/out/` (o `pack.sh` empacota `out/` inteiro). Cópias de prints para auditoria vão para o scratchpad.

## Contexto mínimo
Fechamento da feature: provar de ponta a ponta no smoke (agente falso) que a fonte Pastas, a ferramenta, a citação, o cartão com anexos e o Composer funcionam sem enviar nada e sem vazar conteúdo; fotografar as telas novas; atualizar os documentos permanentes. Moldes: `midiaChecks` (`main/smoke.ts:7713`, chamada `:17994`, nomes obrigatórios `:18184`, `expectedShots :18247`, exportação no `report.json :18318`), fixtures em `main/smoke-fixtures.ts`, agente falso `test/fixtures/fake-acp-agent.mjs` (scripts por palavra-chave), contrato `docs/specs/_archive/tarefas/contracts/129-fechamento.md` e `_archive/ia-midia/contracts/152-*.md` (na branch `claude/system-git-verification-1203c7`, se não estiver na main; senão usar o 151 em `docs/specs/ia-midia/contracts/`) para README/guia/design/telas.

## Superfície
- Alterar `main/smoke-fixtures.ts`: `chosenAssistantFolders` já existe (165); acrescentar `createSyntheticFolder(dir): Promise<string>` (ou em `main/smoke.ts`) que cria no userData temporário **`smoke-pastas/pasta-exemplo/`** (a costura `smokeRoot` do 165 libera só `userData/smoke-pastas` da etapa `sensivel`; `oculta` e `repetida` continuam valendo) com: `Contratos/contrato-exemplo.pdf` (PDF mínimo válido gerado em código, com o texto "CONTRATO EXEMPLO"), `Propostas/proposta-exemplo.docx` (zip mínimo `[Content_Types].xml` + `word/document.xml` com um parágrafo), `Planilhas/planilha-exemplo.xlsx` (zip mínimo com `sharedStrings.xml` e uma aba, como a fixture do teste do 166), `Notas/nota.txt`, `Apresentacoes/institucional.pptx` (zip vazio válido com `[Content_Types].xml`), `.oculto/segredo.txt`, `grande.bin` (21 MB esparso via `truncate`), `link-fora` (symlink para `/etc`). **Nenhum dado real.**
- Alterar `test/fixtures/fake-acp-agent.mjs`: scripts por palavra-chave da pergunta: `"resuma a proposta"` → bloco `lap-ferramenta` `ler_arquivo_pasta` com o id lido de `PASTAS.md` da linha `Propostas/proposta-exemplo.docx` (o agente falso lê o `.md` da pasta como já faz para outras fontes), depois resposta com a citação `[Pasta · pasta-exemplo/Propostas/proposta-exemplo.docx](pasta:<id>)`; `"responda ao michel com os documentos"` → bloco `lap-acao` `email-resposta` com `anexos` = ids do pdf e do docx (`pedido` "contrato assinado"/"proposta comercial") e `faltando: ["comprovante de inscrição estadual"]`; `"crie uma pasta"` depois de leitura → pede `criar_pasta` (para o check de recusa). O e-mail do Michel entra nas fixtures de e-mail do smoke (conta falsa já existente): assunto "Documentos para o contrato", corpo pedindo os três itens.
- Alterar `main/smoke.ts`:
  - `pastasChecks: Record<string, Check>` com: `configuracoes` (fixture `chosenAssistantFolders = [home, join(userData,'smoke-pastas','pasta-exemplo'), join(userData,'smoke-pastas','pasta-exemplo','Contratos')]` → `added:1`, `refused:2` (`sensivel`, `repetida`), linha `data-assistant-folder-id` visível, aviso `data-assistant-folder-refused` visível; depois `remove` e `add` de novo só com a pasta), `indice` (conversa nova, fonte ligada, pergunta neutra → `PASTAS.md` existe, 0600, `linhas` = 5 entradas [pdf, docx, xlsx, txt, pptx], `ocultoListado:false`, `grandeListado:false`, `linkListado:false`, `pptxLegivel:false`), `leitura` ("resuma a proposta" → 1 arquivo `Midia - Pasta - *.md` 0600, passo "Lendo um arquivo da pasta" visível, `conteudoNoLabel:false`), `abrir` (clique no botão da citação → `openedFiles` com 1 `reveal` cujo caminho está dentro de `pasta-exemplo`), `acaoRecusada` ("crie uma pasta" no mesmo turno depois da leitura → `MEDIA_ACTION_REFUSAL`, pastas de e-mail iguais antes/depois), `cartaoAnexos` (e-mail do Michel aberto no Assistente + "responda ao michel com os documentos" → cartão `data-chat-action-kind="email-resposta"` com `data-email-reply-attachments="2"`, `data-email-reply-missing="1"`, sem botão Enviar, total visível; clique em Abrir no Composer → rota do Email com Composer aberto, 2 chips de anexo, `emailSendCalls:0`; estado do cartão `opened`), `desligado` (fonte desligada → `PASTAS.md` ausente, `Midia - Pasta - *` ausentes; religar → volta), `estadoFinal` (settings com 1 pasta; nenhum arquivo de `out/smoke` com nome real).
  - `detail` de cada check: só números, booleanos e textos fixos (ex.: `{added, refused, linhas, ocultoListado, grandeListado, chips, emailSendCalls}`); nunca nome de arquivo nem conteúdo. Nomes obrigatórios na lista de "não executado"; chamada antes do bloqueio como `midiaChecks`; exportação no `report.json`.
  - `SCREENS`: `configuracoes-claude-pastas` (aba Claude rolada até a seção, 1 pasta), `configuracoes-claude-pastas-recusa` (aviso visível), `assistente-contexto-pastas` (linha ligada), `assistente-contexto-pastas-vazia`, `assistente-resposta-pasta` (passo + citação), `assistente-cartao-anexos`, `assistente-cartao-aberto`, `email-composer-anexos` — cada uma nos dois temas; `expectedShots` ajustado com comentário "contrato 169: +8 telas".
- Docs permanentes:
  - `README.md`: seção "Pastas do Assistente" (o que é, só leitura, pastas recusadas, limites, como o e-mail com anexos funciona, "nada sai sem o seu clique no Composer", onde ficam as cópias e quando somem).
  - `apps/desktop/resources/assistente/guia-do-app.md`: bloco da fonte Pastas na seção do Assistente, a ferramenta `ler_arquivo_pasta`, a citação com Abrir, o cartão com anexos, a seção nas Configurações (`<!-- tela: configuracoes -->` ou o bloco correspondente); o teste `assistant.test.ts:817` continua verde.
  - `docs/specs/desktop-shell/design.md`: cartão `email-resposta` com anexos (seção Anexos, "Não encontrado", total, botões), botão de citação de pasta, linha de pasta nas Configurações.
  - `docs/telas/`: artboards novos a partir de `mockups/PastasAssistente.html` (um `.dc.html` por tela, nomeados como os vizinhos) e `artboards/canvas.json` (`boards` + `order`); `docs/telas/README.md` com as telas.
  - `docs/specs/pastas-assistente/auditoria-prints.md`: tabela tela × tema × ok/ajuste, comparando o PNG real do smoke com o mockup (os PNGs do smoke ficam em `out/smoke/`; copiar os 16 para o scratchpad para comparar; nada para dentro do repo além do que já é padrão).
  - `docs/specs/pastas-assistente/notas-release.md`: texto curto para a release (o que o usuário ganha, limites, privacidade).
  - `docs/specs/pastas-assistente/plan.md`: seção "Pendências" preenchida (o que ficou fora: contagem por pasta, PowerPoint, limite por conta, linhas do Composer do desenho, citações de Email/WhatsApp ainda não clicáveis, tema escuro só no smoke).

## Critérios de aceite
- CA1: `pnpm gates` da raiz do worktree **verde** (typecheck, lint, testes, build, smoke, pytest se houver), com `pastasChecks` todos `ok` e `expectedShots` batendo.
- CA2: `report.json` do smoke tem o grupo `pastas` com os 9 checks; nenhum `detail` contém string que não seja de uma lista fixa (teste existente de "detail só números/booleanos", ou grep no `report.json` por `pasta-exemplo`, `proposta-exemplo`, `Michel` → 0 ocorrências fora dos nomes dos checks).
- CA3: Na pasta sintética, nada é criado, alterado ou apagado pelo app durante o smoke (hash recursivo antes e depois igual; o check `estadoFinal` registra `pastaIntacta:true`).
- CA4: Os 16 PNGs novos existem em `out/smoke/`, sem corte ou sobreposição (auditoria), e batem com os mockups aprovados nos pontos: seção de pastas depois de "Chat e resumo"; linha Pastas no Contexto; cartão sem Enviar, com total; Composer com 2 anexos.
- CA5: README, guia, design.md e docs/telas atualizados; `grep -n "Pastas" README.md apps/desktop/resources/assistente/guia-do-app.md docs/specs/desktop-shell/design.md docs/telas/README.md` encontra as seções; `canvas.json` válido (JSON) com os boards novos em `order`.
- CA6: `auditoria-prints.md`, `notas-release.md` e "Pendências" do plan preenchidos.
- CA7: `apps/desktop/out/` contém só `main`, `preload`, `renderer`, `smoke` depois do gate.

## Invariantes
- Nenhuma fixture com dado real; nenhum caminho da máquina do Andrew em arquivo commitado (grep por `/Users/andrew` no diff → 0, exceto este contrato e o plan).
- Nenhuma chamada a `emailSend`/SMTP em todo o smoke desta feature (`emailSendCalls:0`).
- Código de produto não muda neste contrato além do estritamente necessário para `data-*` que faltar (dizer no relatório qual).

## Fora de escopo desta tarefa
- Tema escuro nos mockups; apresentação do cliente (perguntar ao Andrew depois); versão/release (coordenador, `release.sh`); arquivamento da spec (coordenador); merge na main (coordenador).

## Gates
- `pnpm gates` da raiz do worktree, tela desbloqueada. Se falhar por captura (`display surface not available`), conferir `CGSSessionScreenIsLocked` antes de assumir bug.

## Relatório esperado do implementador
≤ 40 linhas: contagem de testes e PNGs, resultado de cada `pastasChecks` (só nomes e ok/falha), arquivos alterados, resultado da auditoria (quantas telas ok, quais ajustes), o que mudou em código de produto, dúvidas resolvidas sozinho.
