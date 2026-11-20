# Telas do sistema e design system (artefatos)

Dois artefatos no claude.ai registram o estado visual do LAP Reuniões em 19/11/2026. São privados da conta do Andrew; para outra pessoa abrir, é preciso compartilhar pelo menu Share da página.

| Artefato | Link | O que tem |
|---|---|---|
| **Telas do LAP Reuniões** (canvas) | https://claude.ai/artifact/3rFzeoiEbxF4qEDGSSqBTm | 35 artboards: as telas atuais recriadas do código, **já com o sidebar em pilha** (spec `sidebar-pilha`, contratos 65 e 66), estados vazios e de erro, duas telas no tema escuro, a tela de bloqueio, o aviso de reunião e os 8 prints reais do README (ainda com o sidebar antigo). |
| **LAP Reuniões Design System** | https://claude.ai/artifact/XifBZPKYhAdXQoBYD1pxMe | 90 tokens (50 cores em Claro e Escuro, espaço, raio, tamanhos, 21 estilos de texto), brand book em pt-BR, 13 componentes com preview (Button, Field, Switch, Tabs, Segmented, SettingRow, Note, StickyNote, Transcript, EmptyState, Tag, SidebarItem, ControlBar) e os logos. Instalado no canvas das telas como fonte de cores e estilos. |

## Como foram feitos

- Inventário a partir do código em `apps/desktop/src/renderer/src/` (rotas em `shared/routes.ts`, tokens em `design/tokens.css` e `design/base.css`, componentes em `design/`). Nenhum valor foi inventado; onde `docs/specs/desktop-shell/design.md` diverge do CSS, vale o CSS.
- O sidebar segue o mockup aprovado `docs/specs/sidebar-pilha/mockups/SidebarPilha.dc.html` (branch `sidebar-pilha`): raiz com Reuniões, Assistente, Email (com o total de não lidas), Automações, WhatsApp e Configurações; níveis próprios para Email e Configurações com cabeçalho-voltar; Configurações sem abas horizontais, com o nome da aba no topo.
- Nada foi verificado visualmente nesta sessão: os artboards foram escritos e publicados sem renderizar. Ajustes visuais se fazem na própria página do canvas ou editando os fontes abaixo e republicando.

## Fontes dos artboards

`artboards/` guarda a cópia dos 35 arquivos `.dc.html` e do `canvas.json` publicados em 19/11/2026. O artefato é a versão viva (quem edita na página muda só lá); esta pasta é o ponto de partida para novos mockups e para republicar.

- `SidebarRaiz`, `SidebarEmail`, `SidebarConfig` (224×740) são componentes importados pelas telas via `<dc-import name="SidebarRaiz" ativo="reunioes" nao-lidas="{{n}}">`. Props: `ativo` (reunioes | assistente | email | automacoes | whatsapp | configuracoes | qualquer outro = nenhum marcado), `naoLidas`; `pasta` (inbox | enviados); `aba` (geral | gravacao | claude | arquivos | contas | plugins | conexoes | sobre).
- As demais telas têm 1120×740 (tamanho da janela padrão). `Main.dc.html` é a lista de Reuniões.
- Os prints (`Print*.dc.html`) apontam para imagens guardadas no próprio artefato; os originais estão em `docs/images/`.

## Para atualizar

1. Editar o `.dc.html` em `artboards/` (ou criar um novo e registrá-lo em `canvas.json`, em `boards` e `order`).
2. Numa sessão do Claude Code, publicar com a ferramenta Artifact para a URL do canvas, passando só os arquivos alterados.
3. Copiar a versão publicada de volta para esta pasta.
