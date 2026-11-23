---
feature: inicio
contrato: 137
status: conferido
data: 2026-11-23
semana: 2026-W48
base: inicio db77a3b
---

# Auditoria dos prints do smoke (inicio)

Smoke completo rodado em 23/11/2026 (`report.json` com `generatedAt: 2026-11-23T11:01:11.351Z`),
dentro do `pnpm gates` inteiro: **264 PNGs**, `failures: []`. Pasta dos prints:
`apps/desktop/out/smoke/`. Os artboards de referência são os do mockup
`mockups/Inicio.dc.html` (`InicioDia`, `InicioGravando` e `InicioVazio`, em claro e escuro);
a seção Início das Configurações e a linha do Mac sem acesso não têm artboard próprio e foram
conferidas contra o plan (D13 e D5) e contra `docs/specs/desktop-shell/design.md`.

## O que foi procurado em todos

Corte, sobreposição, espaço morto, desalinhamento, texto técnico (id, JSON, "undefined", nome
de `data-*`), cor fora do token, contraste ruim no escuro, raio acima de 6, sombra, pílula.
Na agenda: a marca "agora" em `--accent`, evento atual destacado com "Transcrever", etiqueta da
fonte, nenhum link de chamada na tela, "Amanhã: …" no pé. Cartões sem conteúdo ausentes (não
vazios). No `report.json`: os `detail` dos checks novos só com números e booleanos (nenhum
título de evento, nome ou e-mail) — conferido, ok.

## Resumo

- **9 prints conferidos (8 novos + `bloqueado-dark`): todos bons.** Nenhum achado bloqueador;
  as notas N1–N3 previstas se confirmaram e entrou a N4 (dado de cenário, não defeito).

## Notas

- **N1. `bloqueado-dark` mudou de fundo — ok.** Com o Início como tela de abertura, a tela de
  bloqueio mostra o Início borrado ao fundo. Conferido: nada legível vaza pela camada.
- **N2. `inicio-vazio-*` com tarefas — ok.** O print sai com as tarefas semeadas pelo smoke no
  cartão Tarefas ("2 vencidas" + 1 de hoje), diferente da legenda do artboard 03 ("sem
  tarefas"). É dado do cenário: o que se conferiu ali foi "Sem eventos hoje", a ausência de
  Pendências e a faixa de amanhã — tudo certo.
- **N3. Frase do estado vazio dinâmica — ok.** No vazio comum: "O Calendário do Mac não tem
  nada marcado para hoje."; no sem-acesso: "Nenhuma agenda para ler hoje." (`inicioFormat.ts`),
  no lugar do texto fixo do mockup. Divergência de texto esperada e aceita.
- **N4. `inicio-gravando-*`: Última reunião mostra a própria gravação.** O cartão Última
  reunião exibe "Reunião de 23/11 07:36 · 0 s" — a gravação recém-iniciada pelo cenário já é a
  reunião mais recente. Dado do cenário de teste, não defeito de interface; o cartão renderiza
  certo.

## Por print

| print | artboard de referência | veredito | achado |
|---|---|---|---|
| `inicio-dia-light.png` | `01 · InicioDia` (claro) | ok | linha do tempo com "agora", evento atual com "Transcrever", etiqueta Mac, Tarefas (2 vencidas), Última reunião, "Amanhã" no pé |
| `inicio-dia-dark.png` | `01 · InicioDia` (escuro) | ok | contraste bom; mesmos elementos do claro |
| `inicio-gravando-light.png` | `02 · InicioGravando` (claro) | ok | faixa "Gravando agora" com link; evento com "Gravando desde …" e sem "Transcrever" |
| `inicio-gravando-dark.png` | `02 · InicioGravando` (escuro) | ok | N4 |
| `inicio-vazio-light.png` | `03 · InicioVazio` (claro) | ok | N2, N3 |
| `inicio-vazio-dark.png` | `03 · InicioVazio` (escuro) | ok | N2, N3 |
| `inicio-sem-acesso-mac-light.png` | sem artboard (PRD, regra do Mac sem acesso; plan D5) | ok | linha discreta "Calendário do Mac sem acesso — conceder" acima do "Amanhã" |
| `configuracoes-geral-inicio-light.png` | sem artboard (plan D13; seção Início entre Janela e Funil de vendas) | ok | Tela inicial segmentado (Início/Reuniões) + 5 interruptores, textos certos |
| `bloqueado-dark.png` (já existente; o fundo mudou) | — | ok | N1 |
