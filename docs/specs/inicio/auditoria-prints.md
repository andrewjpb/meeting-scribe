---
feature: inicio
contrato: 137
status: pendente
data: 2026-11-22
semana: 2026-W47
base: inicio f6f2e96
---

# Auditoria dos prints do smoke (inicio)

Esqueleto. O smoke com os prints novos (contratos 135 e 136) ainda não rodou nesta feature: a auditoria é completada quando ele rodar, com a pasta dos prints, o `generatedAt` do `report.json`, o número de PNGs e os `failures`. Os artboards de referência são os do mockup `mockups/Inicio.dc.html` (`InicioDia`, `InicioGravando` e `InicioVazio`, em claro e escuro); a seção Início das Configurações e a linha do Mac sem acesso não têm artboard próprio e são conferidas contra o plan (D13 e D5) e contra `docs/specs/desktop-shell/design.md`.

## O que procurar em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", nome de `data-*`), cor fora do token, contraste ruim no escuro, raio acima de 6, sombra, pílula. Na agenda: linha do tempo das 08:00 às 19:00 com a marca "agora" em `--accent`, evento atual com borda `--accent` e "Transcrever", o mesmo evento das duas fontes numa linha só com as duas etiquetas, nenhum link de chamada na tela, "Amanhã: N eventos" no pé. Cartões sem conteúdo ausentes (não vazios). No `report.json`: os `detail` dos checks novos só com números e booleanos (nenhum título de evento, nome ou e-mail).

## Resumo

- **8 prints novos:** pendente — smoke ainda não rodou.

## Notas conhecidas (antes do smoke)

- **N1. `bloqueado-dark` muda de fundo.** Com o Início como tela de abertura, a tela de bloqueio passa a mostrar o Início borrado ao fundo (a camada é translúcida), e não mais a lista de Reuniões. É esperado: conferir só que nada legível do Início vaza pela camada.
- **N2. `inicio-vazio-*` com tarefas.** O print sai com as tarefas semeadas pelo smoke no cartão Tarefas, diferente da legenda do artboard 03 ("sem tarefas (linha calma …)"). É dado do cenário, não da interface: o que se confere ali é "Sem eventos hoje", a ausência de Pendências e a faixa de amanhã.
- **N3. Frase do estado vazio.** A frase abaixo de "Sem eventos hoje" é dinâmica, conforme as fontes que a agenda leu (agendas conectadas e/ou Calendário do Mac, ou "Nenhuma agenda para ler hoje."; `inicioFormat.ts`), e não o texto fixo do mockup ("As agendas Google, Microsoft e o Calendário do Mac não têm nada marcado para hoje."). Divergência de texto esperada.

## Por print

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `inicio-dia-light.png` | `01 · InicioDia` (claro) | pendente — smoke ainda não rodou | |
| `inicio-dia-dark.png` | `01 · InicioDia` (escuro) | pendente — smoke ainda não rodou | |
| `inicio-gravando-light.png` | `02 · InicioGravando` (claro) | pendente — smoke ainda não rodou | |
| `inicio-gravando-dark.png` | `02 · InicioGravando` (escuro) | pendente — smoke ainda não rodou | |
| `inicio-vazio-light.png` | `03 · InicioVazio` (claro) | pendente — smoke ainda não rodou | N2, N3 |
| `inicio-vazio-dark.png` | `03 · InicioVazio` (escuro) | pendente — smoke ainda não rodou | N2, N3 |
| `inicio-sem-acesso-mac-light.png` | sem artboard (PRD, regra do Mac sem acesso; plan D5) | pendente — smoke ainda não rodou | |
| `configuracoes-geral-inicio-light.png` | sem artboard (plan D13; seção Início entre Janela e Funil de vendas) | pendente — smoke ainda não rodou | |
| `bloqueado-dark.png` (já existente; o fundo mudou) | — | pendente — smoke ainda não rodou | N1 |
