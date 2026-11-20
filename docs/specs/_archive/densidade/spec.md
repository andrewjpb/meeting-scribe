---
status: arquivado
feature: densidade
data: 2026-11-20
semana: 2026-W47
---

# Spec: Densidade do sistema (estilo painel lateral do Claude Desktop)

## Problema e objetivo
O Andrew aprovou a barra lateral densa (linhas 32/28 px, gap 8, rótulos 11 px em caixa normal, menos margem) e quer o mesmo ritmo em todo o LAP Reuniões e nos artefatos de design. Hoje a interface usa controles de 40 px, linhas de lista de 64 px, títulos de página de 26 px e rótulos de seção em caixa alta de 10 px: tudo maior e mais espaçado que o padrão escolhido. Objetivo: uma escala densa única, aplicada por componente (para cascatear) e depois tela a tela, com o design.md, o smoke e os artefatos atualizados. Aprovação do Andrew dada antecipadamente em 2026-11-20 ("não precisa me perguntar mais"); mockups hoje×proposta das telas principais são produzidos para registro e conferência.

## Não-objetivos
Mudar cores, ícones, larguras de painel (224 barra, 300 Contexto/WhatsApp, 340 lista do Email, 320 anotações), ordem de itens, comportamento, textos (salvo caixa alta → caixa normal). Não mexer nas superfícies de leitura longa além do indicado (resumo, corpo de email, transcrição mantêm 15/24).

## A escala densa (vale para tudo)

| Papel | Hoje | Densa |
|---|---|---|
| Título de página (`PageHeader` page) | 26/32 | **20/26**, `-0.3px`, peso 700 |
| Título de seção/painel (`PageHeader` section, cabeçalho de conversa/leitura) | 20/26 | **15/20**, peso 700 |
| Título de bloco dentro da página (Resumo "Decisões", formulários 17) | 17/24 | **14/20**, peso 600 |
| Rótulo de seção / grupo (dias, "Permissões", títulos de `Section`, cabeçalhos de tabela) | `caps` 10 ou 12 bold | **11/16**, peso 500, `text-muted`, caixa normal, sem tracking |
| Texto de interface | 13/20 | 13/20 (igual) |
| Texto de apoio | 12/16 | 12/16 (igual); 11/16 em metadados secundários |
| Texto de leitura (resumo, corpo de email, transcrição, balões) | 15–16 | balões e prévia **14/22**; resumo, email e transcrição **15/24** (transcrição de 16/26 para 15/24; tradução 13/20) |
| Botão (`Button`) | 40 | **32** (`h-8`), `px-3`, 13/500; `ActionButton` continua 28 |
| Campo (`TextField`, `Select`) | 40 | **32**, `px-2.5` |
| `Tabs` | 40 | **32** |
| `Segmented` | 40 | **28** |
| `Switch` | 44×24 | **36×20**, botão 14 |
| `Note` | `px-4 py-3` | `px-3 py-2`, 13 |
| `SettingRow` | min 64, `py-3` | **min 44**, `py-2`, nome 13/500, descrição 12; coluna do controle 340 mantida |
| `Section` | título `caps` 10; caixa `mt-3`; filhos `px-4` | título **11 caixa normal** com `mb-1`; caixa `mt-2`; filhos `px-3` |
| Linha de lista (reuniões, tarefas, conexões, modelo) | 64 / 56 / 48 | **44** (duas linhas de texto) ou **32** (uma linha) |
| Linha de tabela densa | `py-3` | `py-1.5` (28–32 px) |
| Cabeçalho de painel (Contexto, leitura de email, conversa, WhatsApp) | 56 / 48 | **44** |
| Página: respiro | `px-10 pt-7` | **`px-8 pt-5`** (32/20); `pb-8` |
| Grupo de seções em Configurações | `gap-8`, `pt-8` | **`gap-6`**, `pt-5` |
| `EmptyState` | ilustração `mb-7`, título 20, ação `mt-6` | ilustração `mb-5`, título **17**, texto `mt-2`, ação `mt-4` |
| Barra lateral | contrato 79 | contrato 79 (raiz/cabeçalho 32, nível 28, gap 8, margem 16, rodapé 126) |
| Logo/marca, ícones 16 (14 em ActionButton), raios 4/6, espaços 4…64 | | iguais |

Regra de caixa alta: só rótulos de fonte de áudio (fita), "LAP SOFTWARE" e nada mais. `.caps` sai de uso na interface e é substituída por `.label` (11/16, 500, muted). Resolve a pendência "títulos de seção em caps vs design.md" a favor do design denso, e o design.md é reescrito (não o contrato 18).

## Telas (o que muda em cada uma, além dos componentes)
- **Reuniões**: página `px-8 pt-5`; grupo do dia rótulo 11; linha 44 (título 13/500, apoio 11, prévia 12 em 1 linha); "Próximas" linha 32; busca 32; pastas 28; "gravando agora" `px-3 py-2`.
- **Detalhe da reunião**: cabeçalho `pt-5`, título 15/700 editável, abas 32, etiquetas 20; Resumo: títulos de bloco 14/600 com fio, texto 15/24, tabela de tarefas `py-1.5`; Anotações `gap-3`; Áudio rótulos 11; Transcrição texto 15/24, tradução 13/20, rótulo 11, botões 28.
- **Gravação**: cabeçalho `pt-5 pb-3`, status 20 px, cronômetro 14; análise linhas 28; painel de anotações abas 32 e corpo `px-3 pt-3`; barra de controles botões 32, etiquetas 24.
- **Assistente**: já sem PageHeader (contrato 78); cabeçalho da conversa 44, título 15/700; sugestões 44; corpo coluna 720 `gap-4 pt-4`; balões 14/22 `px-3 py-2`; cartão de resposta `px-3 py-2.5`; caixa de pergunta textarea 44, seletores 28; Contexto cabeçalho 44, seções `px-3 py-3`, rótulo 11, linhas 28.
- **Email**: topo da lista `px-2 pt-2 pb-1`, título 15; barra de seleção 32; linha `px-2 py-1.5` (remetente 13/600, assunto 13, prévia 12); leitura: barra 44, assunto 17/600, corpo 15/24 mantido; compor: cabeçalho 44, campos 32, texto 15; organizar `px-5 py-4`, título 15.
- **WhatsApp**: busca 28; linha `px-2 py-1.5`, avatar 32; cabeçalho 44; balões 14/22 `px-3 py-1.5`; composição `px-4 py-3`, campo 32; detalhes cabeçalho 44, seções `px-3 py-3`.
- **Automações**: abas 32 `mt-4`; corpo `pt-4 pb-8`; cartão de agente `p-3 gap-2`, título 13/600; tabela de tarefas cabeçalho rótulo 11, linha `py-1.5`; execuções `py-1.5`; formulários título 15, gap 16.
- **Configurações**: topo `px-8 pt-5 pb-2`, título 15/700 (já é o nome da aba), busca 32; rolagem `pt-5 pb-8`, `gap-6`; `Section`/`SettingRow` densos; seletor de modelo busca 32 e linha 40; Conexões blocos `py-3`, linhas `px-2 py-1.5`; Plugins/Contas `py-3`; regras de email `py-2`, botões 28; pastas 32; Sobre 13.
- **Bloqueio** e **Aviso de reunião**: iguais (já compactos), só botão 32 no bloqueio.
- **Redes (Instagram)**: nasce denso (contratos 72–75 herdam os componentes).

## Telas de impacto no usuário
Todas as telas do app mudam de ritmo (mais itens visíveis, títulos menores, rótulos de seção em caixa normal). Nenhuma funcionalidade muda. O cliente aqui é o Andrew; a apresentação com prints reais pode ser gerada ao final se ele quiser.

## Critérios de aceite
- **CA1.** Componentes do `design/` com as medidas da tabela; nenhum uso de `.caps` fora de fita/marca; `.label` criada e usada.
- **CA2.** Cada tela da seção "Telas" com as medidas indicadas, conferidas no smoke (`layoutMetrics` e checks por tela atualizados: `buttonHeight` 32, `inputHeight` 32, `settingRowHeight` 44–60, `modelRowHeight` 40, `contentLeft` 32, `contentTop` 20, título de Configurações `15px/20px`, cabeçalho do Contexto 44, transcrição 24/20, etc.).
- **CA3.** Nenhum texto cortado, nenhum controle desalinhado nos prints (auditoria de todos os prints do smoke com laudo).
- **CA4.** design.md reescrito nas linhas 45–48, 52–53, 61, 69–81, 92–102 e "Não fazer" ganha "não voltar a 40 px em controles nem a caixa alta em rótulos".
- **CA5.** `docs/telas`: todos os 35 artboards regenerados na escala densa (valores literais atualizados: 40→32, 64→44, 10 caps→11 normal, etc.), mais os artboards que faltam (Configurações Gravação/Arquivos/Email/Plugins/Sobre, Email leitura e compor) e os de Redes (contrato 77), `canvas.json` e README; `docs/telas/ds/lap-reunioes/` passa a existir no repo com `tokens.json` (gerado de `tokens.css` por script `scripts/export-tokens.mjs`) e os READMEs dos componentes com as medidas densas; artefatos "Telas do LAP Reuniões" e "LAP Reuniões Design System" republicados pelo coordenador.
- **CA6.** Gates verdes; `expectedShots` inalterado (prints regravados).

## Riscos
Conflitos de merge com as branches `redes-instagram` e `assistente-agenda` (as duas tocam telas): a ordem de junção é densidade → Instagram → Assistente, com gates a cada passo. Legibilidade: balões a 14 px e listas a 44 px são o limite; nada abaixo disso.

## Verificação end-to-end
Smoke completo + auditoria dos prints + uso real pelo Andrew na versão publicada.
