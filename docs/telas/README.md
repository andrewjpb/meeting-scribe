# Telas do sistema e design system (artefatos)

Dois artefatos no claude.ai registram o estado visual do LAP Reuniões. São privados da conta do Andrew; para outra pessoa abrir, é preciso compartilhar pelo menu Share da página.

| Artefato | Link | O que tem |
|---|---|---|
| **Telas do LAP Reuniões** (canvas) | https://claude.ai/artifact/3rFzeoiEbxF4qEDGSSqBTm | 43 artboards na escala densa (feature `densidade`, 20/11/2026): a barra lateral em pilha com os níveis Email, Configurações e Assistente, as telas recriadas do código, estados vazios e de erro, duas telas no tema escuro, a tela de bloqueio, o aviso de reunião e os 8 prints reais do README. |
| **LAP Reuniões Design System** | https://claude.ai/artifact/XifBZPKYhAdXQoBYD1pxMe | Tokens (cores em Claro e Escuro, espaço, raio, densidade, tamanhos, estilos de texto), brand book em pt-BR, os componentes com preview e os logos. Instalado no canvas das telas como fonte de cores e estilos. A fonte dele no repositório é `ds/lap-reunioes/`. |

## Como foram feitos

- Inventário a partir do código em `apps/desktop/src/renderer/src/` (rotas em `shared/routes.ts`, tokens em `design/tokens.css` e `design/base.css`, componentes em `design/`). Nenhum valor foi inventado; onde `docs/specs/desktop-shell/design.md` diverge do CSS, vale o CSS.
- Escala densa (spec arquivada em `docs/specs/_archive/densidade/spec.md`): controles de 32 (segmentado e botões compactos de 28), linhas de lista de 44 ou 32, linhas de configuração de 44, cabeçalhos de painel de 44, títulos de página 20/26, de painel 15/20 e de bloco 14/20, rótulos de seção em 11/16 peso 500 caixa normal (caixa alta só na fita e em "LAP SOFTWARE"), página com 32 nas laterais e 20 no topo, balões em 14/22, leitura em 15/24.
- Em 20/11/2026 os 35 artboards de 19/11 passaram pela primeira passada mecânica de `scripts/adensar.mjs` e depois foram revisados à mão um a um: cada um renderizado com o Chrome headless (PNG 2x) e comparado ao print do smoke (`apps/desktop/out/smoke/`) da mesma tela. A revisão tirou a faixa de 52 px que sobrava no topo das telas (no app, o topo arrastável fica por cima do conteúdo), refez o rodapé da barra lateral (126 px, "Bloquear" e permissões em linhas de 28), pôs o Assistente no nível próprio da barra, sem o cabeçalho "Assistente / Pergunte…" (contrato 78) e com o painel Contexto à direita, e tirou a lista de conversas do WhatsApp quando os detalhes estão abertos (é o que o app faz numa janela de 1120).
- Novos em 20/11/2026: `SidebarAssistente`, `EmailLeitura`, `EmailCompor` e as abas de Configurações que faltavam (`ConfigGravacao`, `ConfigArquivos`, `ConfigEmail`, `ConfigPlugins`, `ConfigSobre`). O nível Redes (Instagram) fica para o contrato 77.

## Fontes dos artboards

`artboards/` guarda os 43 arquivos `.dc.html` e o `canvas.json` (`boards` com posição e tamanho, `order` com a ordem de navegação). O artefato é a versão viva (quem edita na página muda só lá); esta pasta é o ponto de partida para novos mockups e para republicar.

- `SidebarRaiz`, `SidebarEmail`, `SidebarConfig` e `SidebarAssistente` (224×740) são componentes importados pelas telas via `<dc-import name="SidebarRaiz" ativo="reunioes" nao-lidas="{{n}}">`. Props: `ativo` (reunioes | assistente | email | automacoes | whatsapp | configuracoes | qualquer outro = nenhum marcado), `naoLidas`; `pasta` (inbox | enviados); `aba` (geral | gravacao | claude | arquivos | contas | email | plugins | conexoes | sobre); `conversa` (pendencias | resumo | daily | fornecedor | decisoes | nenhuma).
- As demais telas têm 1120×740 (tamanho da janela padrão). `Main.dc.html` é a lista de Reuniões.
- Os prints (`Print*.dc.html`) apontam para imagens guardadas no próprio artefato; os originais estão em `docs/images/` (refrescados com os prints do smoke da densidade). Ao republicar, as imagens dos prints sobem de novo a partir de `docs/images/` (passo 2 de "Para atualizar").
- O `support.js` que os arquivos citam é o runtime do canvas no claude.ai; não existe no repositório.

## Design system no repositório

`ds/lap-reunioes/` é a fonte do artefato "LAP Reuniões Design System":

- `tokens.json`: gerado de `design/tokens.css` (os dois temas e os valores comuns) e de `design/base.css` (escala de texto, alturas da barra lateral, `.label` e `.caps`) por `apps/desktop/scripts/export-tokens.mjs`. Não se edita à mão: `pnpm tokens:export` na raiz. O teste `apps/desktop/test/export-tokens.test.ts` reprova se o JSON do repositório ficar diferente do que o exportador gera.
- `components/<Nome>/`: um `README.md` com as medidas densas e as variantes e um `preview.html` que abre sozinho no navegador (claro e escuro), com as cores do `tokens.json` em variáveis no topo do arquivo. Ver `ds/lap-reunioes/README.md`.

## Scripts

- `scripts/adensar.mjs`: a primeira passada da densidade nos artboards (troca de valores literais da escala antiga pela densa). Marca cada arquivo tratado com `<!-- densidade: adensar.mjs -->` e pula os marcados, porque as trocas não são idempotentes. Já foi aplicado a todos; serve de registro e para mockups antigos que voltem a entrar. `node docs/telas/scripts/adensar.mjs [arquivo.dc.html …]`.

## Para atualizar

1. Editar o `.dc.html` em `artboards/` (ou criar um novo e registrá-lo em `canvas.json`, em `boards` e `order`). Mudou um token em `tokens.css`: rodar `pnpm tokens:export` e conferir os `preview.html` afetados.
2. Mudaram os prints de `docs/images/` (na densidade, os 8 foram refeitos): reenviar as 8 imagens ao artefato do canvas e trocar, em cada `Print*.dc.html`, o `src="/_blob/…"` pelo `_blob` novo que o artefato devolver. Sem isso a última linha do canvas continua com os prints antigos.
3. Numa sessão do Claude Code, publicar com a ferramenta Artifact para a URL do canvas (ou do design system), passando só os arquivos alterados.
4. Copiar a versão publicada de volta para esta pasta (inclusive os `Print*.dc.html` com os `_blob` novos).
