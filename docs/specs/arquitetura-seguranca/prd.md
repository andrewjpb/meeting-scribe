# PRD — Arquitetura e segurança do LAP Reuniões

Status: rascunho (20/11/2026, semana 2026-W47) · Dono: Andrew · Spec: `spec.md` · Plan: `plan.md` ·
Contratos: `contracts/84` a `106`

## Por que isto existe

O LAP Reuniões guarda o que há de mais sensível no trabalho de quem usa: gravações e transcrições
de reuniões, o email inteiro, conversas do WhatsApp, convites e as conversas com o Assistente.
Tudo fica no Mac da pessoa, o que é bom. Mas duas auditorias de 20/11/2026 mostraram que o app
vale 7 de 10 em arquitetura: é bem isolado por fora e frágil em três pontos por dentro.

1. **Um email pode virar um programa rodando no Mac.** O HTML do email é desenhado dentro da janela
   principal, e dois comandos internos executam programas sem pedir clique. Se o filtro de HTML
   falhar uma vez, o caminho está aberto.
2. **O macOS não protege o app, e a atualização confia em quem entrega.** O app sai sem assinatura
   de desenvolvedor, sem notarização e sem as travas do Electron. A atualização confere um hash que
   vem do mesmo lugar do arquivo.
3. **Ninguém, nem o usuário nem quem desenvolve, enxerga onde os dados estão.** São cerca de 19
   arquivos de dados, cada um gravado por um código próprio. Alguns descartam arquivo corrompido em
   silêncio. Não há backup. Não há tela que mostre o que está guardado nem se um serviço caiu.

## Para quem

- **Quem usa o app** (hoje o Andrew; depois, clientes da LAP): quer confiar que abrir um email não
  compromete o Mac, que a atualização é legítima e que os dados não somem.
- **Quem desenvolve** (Andrew e as sessões de IA): precisa de um só jeito de gravar dado, para
  mudar o app sem medo e, um dia, trocar o armazenamento sem reescrever os serviços.
- **Quem avalia o produto** (cliente corporativo, TI): pergunta "onde ficam os dados?", "é
  assinado?", "tem backup?". Hoje as respostas são fracas.

## Objetivos

| # | Objetivo | Como se mede |
|---|---|---|
| O1 | Nenhum conteúdo de fora (email, anexo, página, extensão) consegue executar código | os 6 testes de ataque da verificação end-to-end da spec recusam |
| O2 | O app instala e atualiza com garantia de origem | `spctl` aceita o app; atualização adulterada é recusada |
| O3 | Um só caminho para gravar dado | regra de lint reprova `fs` fora da camada; zero cópias de escrita atômica |
| O4 | Dado nunca some em silêncio | arquivo inválido vai para quarentena e aparece na tela |
| O5 | O usuário vê e controla | tela Sistema com dados, serviços e backup |
| O6 | Trocar de banco vira trabalho por store, não reescrita | nenhum serviço conhece caminho de arquivo |

## O que o usuário ganha (por entrega)

| Onda | Entrega | O que a pessoa percebe |
|---|---|---|
| 1 — Ataques reais | contratos 84, 85, 86, 88 (e 87 na sequência) | nada muda na aparência; o email passa a abrir numa moldura isolada; a extensão do navegador pede um pareamento, uma vez |
| 2 — IPC e distribuição | 89, 90, 91, 92 | some o aviso de "desenvolvedor não identificado" ao instalar; atualização falsa é barrada com mensagem clara |
| 3 — Armazenamento | 93 a 103 | app mais rápido com muitas reuniões e conversas; nada se perde se um arquivo corromper |
| 4 — Controle | 104, 105, 106 | tela **Configurações › Sistema**: o que está guardado, quanto ocupa, estado de cada serviço, exportar e restaurar backup |

Cada onda pode virar uma versão. A onda 1 é a que mais reduz risco e a mais barata.

## Telas de impacto no usuário

1. **Configurações › Sistema** (nova): dados, serviços, backup. Precisa de mockup aprovado.
2. **Leitura de email**: corpo em moldura isolada. Precisa de mockup aprovado (altura, foco, seleção).
3. **Configurações › Claude** e **› Conexões**: escolha do programa `claude` pelo diálogo de arquivo.
4. **Extensão do navegador**: pareamento único.
5. **Atualização**: mensagem quando a verificação falha.
6. **Instalação**: sem o aviso do macOS (depende da conta Apple Developer).

Depois da implementação dá para gerar a apresentação com prints reais; perguntar antes de gerar.

## Fora do produto, por enquanto

- Banco de dados (SQLite, Postgres) ou servidor próprio. Fica só a porta aberta.
- Cifrar os dados em disco com a senha do bloqueio.
- Sincronizar dados entre Macs.
- Mudar o que o Assistente pode fazer no email.

## Decisões que são do Andrew

| # | Decisão | Impacto se não decidir |
|---|---|---|
| D1 | Abrir conta Apple Developer (US$ 99/ano) e gerar o certificado "Developer ID Application" da LAP | contratos 91 e 92 caem para a variante fraca (só travas do Electron + assinatura própria) |
| D2 | Ordem das ondas (recomendado: 1 → 2 → 3 → 4) | — |
| D3 | Aceitar o pareamento único da extensão do navegador | contrato 86 fica só com a parte do servidor do Meet |

## Riscos de produto

- **A moldura do email pode piorar a leitura** (altura, rolagem, copiar texto). Mitigação: mockup e
  passo de smoke dedicados antes de publicar.
- **As proteções do macOS podem quebrar a gravação de áudio ou o Assistente.** Mitigação: testar no
  app empacotado antes de publicar a versão; ajuste de permissões previsto no contrato 91.
- **A onda 3 é longa e mexe em arquivos que outras frentes também mexem.** Mitigação: começa por um
  arquivo novo (contrato 93) e migra um grupo por vez, cada um com os testes atuais intactos.

## Como saber que deu certo

A verificação end-to-end da spec (11 passos) passa inteira, os gates ficam verdes, e uma instalação
por cima da pasta de dados da versão 0.18.0 abre com tudo no lugar, sem passo manual.
