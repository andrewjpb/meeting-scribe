# Contrato 118: Fechamento do funil (docs, telas, auditoria dos prints e arquivamento)

Feature `funil-vendas` · Wave 8 · Depende de: 107 a 119 commitados · Spec `../spec.md` (R19 versão final; CA17; "Prints exigidos"; "Verificação end-to-end") · Plan `../plan.md` (D11, "Fechamento") · Mockup `../mockups/Funil.dc.html` (os 16 artboards, como fonte para `docs/telas`). **Você não commita.** Worktree `/Users/andrew/Documents/GitHub/meeting-scribe-funil-vendas` (branch `funil-vendas`, base dd106ce). Único contrato da wave 8. A publicação nos artefatos do claude.ai é do coordenador; você deixa os arquivos-fonte prontos no repositório.

## Pré-condições
- Leia a spec inteira, o plan e os relatórios dos contratos 107 a 119 (o coordenador passa os caminhos ou cola os trechos de "diferenças em relação ao contrato").
- No repositório: `README.md` (raiz), `resources/assistente/guia-do-app.md` (seção `funil` dos contratos 112 e 117), `docs/telas/README.md`, `docs/telas/artboards/` (51 `.dc.html`) e `docs/telas/artboards/canvas.json` (`boards`, `order`), `docs/specs/desktop-shell/design.md`, o contrato 83 (`docs/specs/_archive/densidade/contracts/83-artefatos-e-fechamento.md`) e o 77 (`docs/specs/_archive/redes-instagram/contracts/77-fechamento.md`) como modelo de fechamento.
- Rode `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` uma vez no início para ter os prints frescos em `apps/desktop/out/smoke/`.

## Superfície

### Auditoria dos prints (CA17)
- Confira que existem os 13 prints de "Prints exigidos" nos dois temas (26 arquivos): `funil-oportunidades`, `funil-oportunidades-nova`, `funil-oportunidades-editar-etapas`, `funil-oportunidade`, `funil-contatos`, `funil-contatos-sugestoes`, `funil-contatos-importar`, `funil-contatos-novo`, `funil-empresas`, `detalhe-resumo-oportunidade`, `email-leitura-contato`, `whatsapp-detalhes-contato`, `assistente-funil`.
- Abra cada um (claro e escuro) e compare com o artboard correspondente (`../mockups/png/`); registre em `docs/specs/funil-vendas/auditoria-prints.md` uma linha por print: "ok" ou o achado (corte, sobreposição, espaço morto, desalinhamento, texto técnico, cor fora do token, contraste ruim no escuro). Confira também `configuracoes-geral` (Section Funil) e os prints da barra lateral com o item Funil.
- Correção de uma linha em `features/funil/**`, nos componentes que o funil tocou ou em `smoke.ts` é sua; o resto vira pendência no relatório. `expectedShots` termina em `SCREENS.length * THEMES.length + 205` (13 prints da spec × 2 temas); se a auditoria mudar algum print, o número não muda.

### Docs permanentes (anti-drift)
- `README.md`: seção curta "Funil de vendas" (o que é, Contatos, Empresas, Oportunidades, importação CSV e vCard, detecção depois do resumo sempre com confirmação, fonte do Assistente, alerta diário, onde ficam os dados: `funil.json` no userData, só neste Mac); se o README lista telas ou prints, acrescente as do funil com os prints do smoke.
- `resources/assistente/guia-do-app.md`: revise a seção `funil` inteira contra o que foi entregue (três telas, arrastar e motivo da perda, editar etapas, sugestões, importar, "+ Contato" no Resumo, Email e WhatsApp, cartão "Oportunidade detectada", "Detectar oportunidade", a configuração em Geral, alerta diário, os quatro cartões do Assistente, "Pode ler o funil" das Automações); o teste do guia continua verde.
- `docs/specs/desktop-shell/design.md`: registre os padrões novos que o funil criou (kanban com coluna mínima de 170 px e faixas recolhidas de 32 px; área tracejada de coluna vazia; chips retangulares de raio 4 com `--hl` para "ainda não criado"; cartão editável no lugar, sem modal), com a data 2026-11-20 ou a data real do fechamento.
- `docs/telas/`: um artboard `.dc.html` por tela nova ou mudada, a partir do mockup aprovado e corrigido pelo print real (Oportunidades, Oportunidade, Contatos, Contatos › Sugestões, Contatos › Importar, Empresas, Reunião › Resumo com cartão, barra raiz e nível Funil), no padrão dos existentes, **já com as duas correções que a spec manda**: no `04-oportunidade-detalhe`, o Valor por `formatarBRL` ("R$ 186.000", sem centavos zerados); no `09-reuniao-resumo-oportunidade`, o bloco Participantes **abaixo** das tarefas e o cartão acima delas. Corrija também os dois artboards em `docs/specs/funil-vendas/mockups/Funil.dc.html` e regere os PNGs deles em `mockups/png/`. `canvas.json` (`boards`, `order`, o Funil depois do Email) e `docs/telas/README.md` (lista e contagem).

### Preparação do arquivamento (o `git mv` é depois do teste navegado)
- **Não mova a spec.** O arquivamento acontece no Fechamento do plan, pelo coordenador, **depois** do teste navegado em sessão nova.
- Deixe prontos: `docs/specs/funil-vendas/notas-release.md` (destaques em pt-BR para as notas da versão, sem termo técnico) e, no fim do `plan.md`, a seção "Pendências" com o que a auditoria deixou.
- O prompt do teste navegado (no relatório), seguindo "Verificação end-to-end" da spec.

## Critérios de aceite
- **CA1** (CA17 da spec) Dado o worktree no fim, quando `SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates`, então tudo verde (typecheck, lint, vitest, build, smoke, cores, shapes, pytest) e o smoke gera exatamente `SCREENS.length * THEMES.length + 205` PNGs, incluindo os 26 da lista.
- **CA2** `auditoria-prints.md` tem uma linha para cada um dos 26 prints do funil e para `configuracoes-geral` claro e escuro.
- **CA3** `README.md` tem a seção "Funil de vendas" e cita `funil.json`; o guia tem `<!-- tela: funil -->` e menciona as três telas, a importação e os cartões (R19).
- **CA4** `docs/telas/artboards/canvas.json` lista os artboards novos em `boards` e `order`, e cada arquivo listado existe.
- **CA5** `docs/specs/funil-vendas/` **continua** no lugar (o arquivamento é posterior ao teste navegado), com `auditoria-prints.md`, `notas-release.md` e a seção "Pendências" no fim do `plan.md`; os artboards `04` e `09` do mockup e de `docs/telas` têm as duas correções (Valor sem centavos zerados; Participantes abaixo das tarefas).

## Invariantes
- Nenhuma regra de negócio muda nesta tarefa; nenhum canal, tipo ou store muda.
- O número de prints não muda em relação ao 117.
- Nenhum literal de cor fora de `tokens.css` nos componentes (artboards de `docs/telas` seguem o padrão dos existentes).

## Fora de escopo desta tarefa
Publicar os artefatos no claude.ai (coordenador); mover a spec para `_archive` (coordenador, depois do teste navegado); release, tag e `.dmg` (o build local e o teste navegado são do fechamento do plan, em sessão nova); correções maiores que a auditoria achar (viram contrato próprio).

## Gates
`cd /Users/andrew/Documents/GitHub/meeting-scribe-funil-vendas/apps/desktop && SMOKE_NO_SANDBOX=1 caffeinate -dimsu pnpm gates` verde no início e no fim.

## Relatório final (formato)
Arquivos (resumo por grupo); gates (contagens, `expectedShots` final); pendências da auditoria (uma linha cada); o que o coordenador publica (caminhos em `docs/telas`) e em qual artefato; o prompt de teste navegado para a sessão nova, seguindo "Verificação end-to-end" da spec.
