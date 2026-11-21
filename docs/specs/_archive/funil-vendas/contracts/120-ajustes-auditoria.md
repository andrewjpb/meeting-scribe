# Contrato 120 — Ajustes visuais apontados pela auditoria dos prints
Feature: funil-vendas  ·  Wave: 9 (correção pós-fechamento)  ·  Depende de: 118 (`auditoria-prints.md`, commit `e112f37`)

## Pré-condições
- `main` em `e112f37` ou depois; `pnpm gates` verde (237 prints).
- Achados em `docs/specs/funil-vendas/auditoria-prints.md`: B1 (bloqueador) e M1–M4 (menores). Nenhum deles muda regra de negócio.
- Constituição: `CLAUDE.md` do repo e `docs/specs/desktop-shell/design.md` (só tokens de `tokens.css`, raio ≤ 6 px, sem sombra, sem pílula, controles 32 px).

## Superfície
- `apps/desktop/src/renderer/src/features/funil/OportunidadeScreen.tsx` (cabeçalho: título + Select de etapa, ~linhas 478–488).
- `apps/desktop/src/renderer/src/features/funil/OportunidadesScreen.tsx` (busca ~486; linha de etapa no "Editar etapas" ~297–305).
- `apps/desktop/src/renderer/src/features/funil/ImportarPainel.tsx` (Select de coluna, ~129–133).
- `apps/desktop/src/renderer/src/features/email/ReadingPane.tsx` (remetente + `ContactLink`, ~259–268).
- Se a causa for do componente compartilhado (`design/EditableTitle.tsx`, `design/ActionButton.tsx`/`Field.tsx`), corrigir lá **só** se os outros usos ficarem iguais (ver Invariantes).
- `apps/desktop/src/main/smoke.ts`: acrescentar as asserções dos CA abaixo dentro dos blocos do funil/email já existentes (sem print novo; `expectedShots` não muda).

## Critérios de aceite (Dado/Quando/Então)
- **CA1 (B1)** Dado o detalhe da oportunidade "Loja virtual" na janela de 1120 px do smoke, quando a tela abre, então o título aparece inteiro ao lado do Select de etapa (sem reticências) nos prints `funil-oportunidade-light/dark`; asserção no smoke: no elemento do título (o botão de `EditableTitle` dentro de `h1`), `scrollWidth <= clientWidth` e `textContent === 'Loja virtual'`. Títulos maiores que a largura disponível continuam truncando com reticências (não quebrar em duas linhas).
- **CA2 (M1)** Dado o kanban, então o placeholder "Buscar oportunidades" aparece inteiro no campo de busca (prints `funil-oportunidades-*`); asserção: no `input` da busca, `scrollWidth <= clientWidth` com o placeholder visível (campo vazio). O cabeçalho continua numa só linha em 1120 px.
- **CA3 (M2)** Dado a prévia da importação (`funil-contatos-importar-*`), então o texto de cada Select de coluna aparece inteiro ("Empresa", "E-mail", "Telefone", "Nome", "Cargo", "Ignorar"); asserção: para cada `[data-funil-import-coluna] select`, `scrollWidth <= clientWidth`.
- **CA4 (M3)** Dado "Editar etapas", então o botão "×" das etapas que **não** podem ser apagadas continua existindo e `disabled` (o smoke já exige isso em `withCards`/`newEmpty`), mas visivelmente desabilitado nos dois temas: mesma aparência de desabilitado dos demais `ActionButton` (opacidade reduzida e `cursor` padrão), sem ficar igual ao habilitado no escuro. Asserção: `getComputedStyle(botão).opacity < 1` para o desabilitado e `=== '1'` para o habilitado da etapa nova vazia.
- **CA5 (M4)** Dado a leitura de um e-mail cujo remetente não é contato (`email-leitura-contato-*`), então o "+ Contato" fica **na mesma linha** do nome do remetente (R36), e o endereço, se faltar espaço, é o que encolhe (reticências). Asserção: `getBoundingClientRect().top` do `[data-email-from]` e do botão do `ContactLink` diferem em menos de 4 px.
- **CA6** `pnpm gates` (da raiz) verde: typecheck, lint, vitest, build, smoke com 237 prints e `failures: []`, cores, formas, pytest. Tela do Mac acesa (`caffeinate -d -i -t 3600` já está rodando).

## Invariantes
- `EditableTitle` nos outros usos (`MeetingDetailScreen`, `ChatConversation`, `LiveScreen`, `ContatoFicha`, `EmpresasScreen`) mantém o mesmo tamanho e comportamento; prints `detalhe-*`, `assistente-*`, `funil-contatos-*`, `funil-empresas-*` sem mudança além da pretendida.
- Nenhum canal IPC, store, schema ou regra de negócio muda. Nenhum print novo (`expectedShots` igual).
- Nenhum literal de cor fora de `tokens.css`; raio ≤ 6 px; sem sombra; sem pílula.
- O smoke continua exigindo o botão "×" desabilitado nas etapas com cartões e nas finais.

## Fora de escopo desta tarefa
- Os demais achados da auditoria classificados como observação (placeholder "dd/mm/aaaa", `<select>` nativo, citações em texto comum).
- Enquadramento dos prints (o que não cabe na janela de 1120×740 não é defeito).
- Versão, empacotamento e instalação (o coordenador faz depois).

## Gates
- `pnpm gates` da raiz do repositório, verde por inteiro (CA6).
- Testes unitários novos: não exigidos (são ajustes de layout cobertos pelo smoke); se mexer em lógica de `EditableTitle` ou `ActionButton`, adicionar o caso no teste existente do componente.
