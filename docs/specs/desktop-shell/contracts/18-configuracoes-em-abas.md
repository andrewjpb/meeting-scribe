# Contrato 18 — Configurações em abas, com visual mais organizado
Feature: desktop-shell  ·  Wave: 16  ·  Depende de: 17 (mexe no bloco "Claude" e em `SettingsScreen.tsx`)

## Pré-condições
- Contrato 17 aceito; `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` verde.
- Pedido do Andrew (16/11/2026): "melhore a parte de configuração, está feio, coloque por tabs".
- Hoje `features/settings/SettingsScreen.tsx` é uma página longa com as seções, nesta ordem: Marca, Transcrição, Áudio, Arquivos da reunião, Idiomas, Modelo de tradução, Claude CLI (17: "Claude"), Aparência e Atualizações. O bloco de permissões fica na barra lateral. Já existe um componente de abas (`design/Tabs.tsx`, contrato 08).

## Superfície
- `features/settings/` (tela, abas, seções), `design/` (ajustes de `Section`/`SettingRow` se preciso), `shared/routes.ts` (aba na URL).
- `src/main/smoke.ts` (os checks e prints de Configurações passam a navegar por aba).

## Critérios de aceite
- CA1 — **abas** (componente `Tabs` do 08, horizontal, abaixo do título "Configurações", fixas no topo ao rolar), nesta ordem e com este conteúdo:
  1. **Geral** — Marca (nome, subtítulo, logo), Aparência (tema), Atualizações.
  2. **Gravação** — Áudio (microfone, cancelamento de eco), Transcrição (remover eco, identificar quem fala), Idiomas (falado; traduzir ao vivo; traduzir para).
  3. **Claude** — Conexão com o Claude (17), caminho do `claude`, modelo da tradução (motor AssemblyAI/Claude e o seletor de modelo), modelo do chat, "Resumir ao encerrar".
  4. **Arquivos** — Arquivos da reunião (salvar na pasta, pasta).
  5. **Contas** — reservado para os contratos 11/12 (Google, Microsoft, Agenda). Enquanto não existirem, a aba mostra o estado vazio "Em breve: Google Drive e agendas Google e Microsoft." (sem botões).
  6. **Sobre** — versão, Electron/Chrome (`scribe:app-info`), licença MIT com link para o repositório (abre no navegador, `https://` conferido no main), "Procurar atualização" (atalho para o bloco de Atualizações).
- CA2 — a aba aberta fica na URL (`/configuracoes/:aba`, padrão `geral`) e é lembrada ao voltar para Configurações na mesma sessão. Links antigos que levavam a um bloco (ex.: "Abrir Configurações" do chat e do aviso de atualização) passam a abrir a aba certa e rolar até o bloco (`claude`, `geral#atualizacoes`). Teclado: setas trocam de aba (padrão do `Tabs`), ⌘1…⌘6 abrem a aba N enquanto Configurações está ativa.
- CA3 — **visual**: largura de leitura (máx. ~760 px) centralizada; cada seção como um grupo com título pequeno em caixa-alta (estilo `caps` do design), descrição curta opcional e as linhas (`SettingRow`) separadas por borda fina de 1 px dentro de um contêiner com borda de 1 px e raio de 6 px (sem sombra); rótulo à esquerda e controle à direita alinhados numa grade estável (a coluna dos controles começa sempre na mesma posição — corrige o desalinhamento visto no contrato 09); espaçamento vertical consistente pelos tokens. Nada de pílula, sombra ou raio > 6 px; cores só por tokens.
- CA4 — **busca nas configurações**: campo "Buscar configuração" no topo (⌘F com Configurações ativa); digitar filtra as linhas de **todas** as abas pelo nome e descrição (sem acento/maiúscula) e mostra o resultado agrupado por aba ("Claude › Modelo do chat"); clicar leva à aba e destaca a linha por 2 s (só borda/ fundo por token; sem animação com `prefers-reduced-motion`). Esc limpa.
- CA5 — comportamento de cada controle **não muda** (mesmos canais, mesmos valores, mesmos testes do 01–17). Só a organização e o visual.
- CA6 — **smoke**: os checks de Configurações existentes passam navegando pelas abas; novos prints `configuracoes-geral-{light,dark}`, `configuracoes-gravacao-light`, `configuracoes-claude-light`, `configuracoes-arquivos-light`, `configuracoes-contas-light`, `configuracoes-sobre-light`, `configuracoes-busca-light`; mede o alinhamento da coluna de controles (mesmo `x` em todas as linhas de uma aba, tolerância 1 px) e a largura máxima.

## Invariantes
- Contratos 01 a 17 continuam passando. `prova/` e `docs/` não mudam.

## Fora de escopo
- Novas configurações, importar/exportar configurações, perfis.

## Gates
- `SMOKE_NO_SANDBOX=1 bash apps/desktop/scripts/gates.sh` e `bash apps/desktop/scripts/pack.sh`.

## Telas de impacto no usuário
- Configurações: seis abas (Geral, Gravação, Claude, Arquivos, Contas, Sobre), busca, visual em grupos alinhados.

## Notas do coordenador
- Nada de commit.
