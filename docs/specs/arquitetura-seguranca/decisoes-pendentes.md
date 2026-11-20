# Decisões pendentes do Andrew — arquitetura-seguranca

Levantadas ao escrever os contratos (20/11/2026). Cada uma trava o contrato indicado; o detalhe está
na seção "Dúvidas para o coordenador" do próprio contrato.

## Bloqueiam o começo

| # | Decisão | Contratos | Recomendação |
|---|---|---|---|
| D1 | Abrir conta Apple Developer (US$ 99/ano) e gerar o Developer ID da LAP | 91, 92 | Abrir. Sem ela não há hardened runtime nem notarização |
| D2 | Ordem das ondas | todos | 1 → 2 → 3 → 4 |
| D3 | Pareamento único da extensão do navegador **e** reinstalação única da extensão do Meet (chave fixa no manifest) | 86 | Aceitar; pareamento por arquivo `pareamento.json` gravado no "Salvar plugin…" |
| M1 | Mockup da leitura de email em moldura isolada | 84 | Desenhar e aprovar antes do 84 |
| M2 | Mockup de Configurações › Sistema | 105, 106 (CA8) | Desenhar e aprovar antes do 105 |

## Decisões técnicas com efeito para o usuário

| # | Decisão | Contrato | Recomendação |
|---|---|---|---|
| D4 | Aceitar o `claude` instalado com `sudo npm -g` (dono `root`) | 85 | Aceitar dono = usuário **ou** root, nunca gravável por outros |
| D5 | Botão "Escolher…" do caminho do `claude` é tela nova: exige mockup? | 85 | Dispensar (um botão no padrão existente) |
| D6 | Confirmação de link passa da tela para diálogo nativo do macOS | 87 | Aceitar |
| D7 | Gates passam a precisar de rede (`pnpm audit`) | 88 | Aceitar, com modo offline que só avisa |
| D8 | Primeira versão com Developer ID pede de novo Chaveiro, microfone, áudio do sistema e Calendário | 91 | Aceitar e avisar nas notas da versão |
| D9 | Sem Developer ID, a atualização confere o `.dmg` inteiro, não o app de dentro | 92 | Só vale se D1 = não |
| D10 | Depois do contrato 101, a 0.18.0 não lê mais três arquivos do WhatsApp (sem voltar de versão) | 101 | Aceitar |
| D11 | Caches (corpos e pastas do email, cache da agenda) são descartados com registro, não vão para quarentena | 101 | Aceitar: o sync refaz |
| D12 | Aba Sistema depois de Sobre, sem atalho (⌘9 continua Sobre) | 105 | Aceitar |
| D13 | Backup `.zip` sem cifra, sem `lock.json`, sem senhas; a tela avisa | 106 | Aceitar |
| D14 | Dependência nova `fflate` (MIT) para o zip | 106 | Aceitar |
| D15 | Drive: carga assíncrona com uma linha a mais num teste existente (exceção à N3) | 96 | Opção A do contrato |
| D16 | `index.ts` em 700 linhas criando `src/main/shell/`, ou ~1.050 sem a pasta nova | 102 | 700, com a pasta |
| D17 | Excluir a folha de estilo da moldura do email do gate de cor literal, com teste que confere as cores contra `tokens.css` | 84 | Aceitar |
