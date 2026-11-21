---
status: aprovado
feature: funil-vendas
tipo: prd
data: 2026-11-20
semana: 2026-W47
base: main dd106ce (versão 0.19.0)
---

# PRD: Funil de vendas (Contatos, Empresas e Oportunidades)

## Em uma frase

O LAP Reuniões passa a ter um funil de vendas de uma pessoa só, que se preenche a partir do que o app já
escuta e lê (reuniões, e-mail, WhatsApp, agenda) e que o Assistente consulta e alimenta, sempre com
confirmação do usuário.

## Por que existe

Hoje cada reunião é uma ilha. O app sabe quem participou, o que foi decidido e quais tarefas ficaram, mas
não sabe que a reunião de terça com a ABF, o e-mail de quinta com a proposta e a mensagem de WhatsApp de
sexta pedindo desconto são a **mesma venda**. O usuário carrega esse fio na cabeça ou num CRM externo que
ele preenche depois, e por isso fica sempre desatualizado.

A tese do produto: **o CRM que se preenche sozinho a partir das conversas**. Nenhum dos grandes (RD
Station, Pipedrive, HubSpot) faz isso localmente, com a IA que o usuário escolhe e sem servidor. É também o
que muda o posicionamento do app de "transcritor de reuniões" para "assistente comercial pessoal".

## Para quem

Uma pessoa que vende o próprio trabalho ou o da sua empresa pequena: consultor, dono de software house,
agência, freelancer. Faz de 5 a 60 reuniões comerciais por mês, conduz as negociações por e-mail e WhatsApp,
e não tem equipe de vendas. O próprio Andrew, na LAP, é o usuário zero.

## Não é

- Não é CRM de equipe: não há login, metas de time, gerente olhando o funil dos outros nem servidor. Essa
  decisão (adendo v1.3, sem backend) permanece.
- Não é ferramenta de marketing: sem campanha, sem disparo em massa, sem landing page, sem lead scoring.
- Não substitui um CRM corporativo quando o cliente já tem um. Integração com CRM externo fica para
  depois, pelos conectores MCP que o app já suporta.

## O que entra (visão de produto)

### 1. Contatos
Pessoas com quem o usuário conversa. Cada contato tem nome, um ou mais e-mails, um ou mais telefones,
empresa, cargo e notas. Nasce de quatro jeitos: digitado à mão, **importado** de um arquivo (CSV ou vCard),
**sugerido pelo app** a partir dos participantes de reuniões, remetentes de e-mail, conversas do WhatsApp e
eventos da agenda, ou **adicionado com um clique** de dentro da tela em que a pessoa aparece (leitura de um
e-mail, painel de uma conversa do WhatsApp, participantes de uma reunião).

A tela de Contatos mostra a lista e, ao lado, a ficha do contato com a **linha do tempo** dele: reuniões em
que participou, e-mails trocados, conversa do WhatsApp e oportunidades em que está. Da ficha saem dois
atalhos: escrever e-mail (abre o Composer já endereçado) e abrir a conversa no WhatsApp.

### 2. Empresas
Agrupam contatos e oportunidades. Têm nome, domínios de e-mail (para ligar contatos automaticamente), site
e notas. O app sugere a empresa a partir do domínio do e-mail do contato, ignorando provedores pessoais
(gmail, hotmail, outlook, icloud, uol etc.).

### 3. Oportunidades (o funil propriamente dito)
Cada oportunidade é uma venda em andamento: título, empresa, contatos, valor estimado em reais, previsão de
fechamento, etapa atual, próximo passo com data e as reuniões, e-mails e conversas ligadas a ela.

As etapas são editáveis. As padrão são **Contato → Descoberta → Proposta → Negociação**, mais as duas
finais fixas **Ganho** e **Perdido**. A tela principal é um **kanban**: uma coluna por etapa, com a soma dos
valores e a contagem no cabeçalho, e cartões que se arrastam entre colunas. O cartão mostra título,
empresa, valor, próximo passo e há quantos dias está parado. Oportunidade sem nenhuma interação há mais de
N dias (padrão 7) ganha o marcador **esfriou**.

Cada oportunidade tem a sua tela de detalhe com os campos editáveis e uma **linha do tempo unificada**:
reuniões (com link para o resumo), e-mails, mensagens de WhatsApp, mudanças de etapa e notas, tudo em ordem
de data.

### 4. A IA alimenta o funil
Ao terminar o resumo de uma reunião, o app roda uma segunda leitura curta perguntando: há uma
oportunidade de venda aqui? Se houver, aparece na aba Resumo da reunião um cartão **"Oportunidade
detectada"** com título, empresa, contatos, etapa sugerida, valor (se foi dito) e próximo passo, e três
ações: **Criar**, **Vincular a uma oportunidade existente** ou **Ignorar**. Se já existe oportunidade aberta
com a mesma empresa ou os mesmos contatos, o cartão vem como **"Atualizar oportunidade X"**, propondo a nova
etapa e o novo próximo passo. Nada entra no funil sem o clique. Essa leitura pode ser desligada em
Configurações.

### 5. O Assistente conhece o funil
O funil vira uma **fonte** do Assistente, com interruptor no painel Contexto como as demais. Com ela ligada,
o usuário pergunta "quanto tenho em proposta aberta este mês?", "quais oportunidades esfriaram?", "o que
combinei com a Ana da ABF?". O Assistente também **propõe cartões**: criar oportunidade, mover de etapa,
registrar próximo passo, criar contato. Como todos os cartões do app, só executam no clique. Citações no
formato `[Funil · Oportunidade X]`.

### 6. Follow-up que não deixa a venda esfriar
Um verificador diário, sem IA, avisa por notificação do macOS as oportunidades abertas sem interação há
mais de N dias e as que têm próximo passo vencido. Tarefas agendadas e agentes das Automações passam a
receber o funil como contexto, de modo que "toda segunda, me diga o que está esfriando e o que fazer" vira
uma tarefa como as outras, com o envio de e-mail já regulado pela permissão existente.

## Telas de impacto no usuário

| Tela | O que muda |
|---|---|
| **Barra lateral** | Item novo **Funil** (entre Email e Redes), com subitens Oportunidades, Contatos e Empresas no segundo nível da pilha. |
| **Funil › Oportunidades** (nova) | Kanban com colunas por etapa, cartões arrastáveis, filtro Abertas/Ganhas/Perdidas/Todas, busca, botão "Nova oportunidade", edição das etapas no próprio cabeçalho. |
| **Funil › Oportunidade** (nova) | Detalhe com título editável, etapa, empresa, contatos, valor, previsão, próximo passo, abas Linha do tempo · Reuniões · Notas; ações Escrever e-mail, Abrir WhatsApp, Vincular reunião, Marcar como ganha/perdida, Apagar. |
| **Funil › Contatos** (nova) | Lista à esquerda e ficha à direita; botões "Importar…" (CSV/vCard) e "Novo contato"; aba **Sugestões** com as pessoas encontradas em reuniões, e-mails, WhatsApp e agenda, para adicionar ou ignorar. |
| **Funil › Empresas** (nova) | Lista e ficha com domínios, contatos e oportunidades da empresa. |
| **Reunião › Resumo** | Cartão "Oportunidade detectada" ou "Atualizar oportunidade" depois do resumo; participantes ganham o botão "Adicionar aos contatos" (ou o nome do contato já existente, com link). |
| **Email › leitura** | Ao lado do remetente, ação "Adicionar aos contatos" (ou o nome do contato existente, com link para a ficha). |
| **WhatsApp › painel de detalhes** | Bloco "Contato" com "Adicionar aos contatos" ou a ficha ligada e as oportunidades da pessoa. |
| **Assistente › Contexto** | Fonte nova **Funil** com interruptor; cartões novos de oportunidade e contato. |
| **Configurações › Geral** | Seção **Funil de vendas**: detectar oportunidades nas reuniões (ligado), dias para considerar esfriada (7), avisar oportunidades esfriadas (ligado). |
| **Automações** | Tarefas e agentes recebem `FUNIL.md` na pasta da execução quando a fonte estiver ligada no agente. |

Como há telas novas e mudadas, dá para gerar a apresentação do cliente **depois da implementação**, com
prints reais. Isso será perguntado na hora, não gerado automaticamente.

## Fora de escopo desta versão

1. Multiusuário, backend, sincronização entre Macs.
2. Integração com CRM externo (HubSpot, RD Station, Pipedrive). Caminho futuro: MCP.
3. Importar do app Contatos do macOS (exige helper Swift novo e permissão). Candidato forte para a versão
   seguinte; ver "Gaps" na spec.
4. O Assistente redigir **e-mail novo** (hoje ele só responde a e-mails existentes). O follow-up sai pelo
   atalho "Escrever e-mail" da oportunidade, que abre o Composer endereçado.
5. Relatórios além dos totais por coluna e do resumo "ganho no mês" no cabeçalho do kanban.
6. Moeda diferente de BRL, campos personalizados, anexos em oportunidades, produtos/itens de proposta.
7. Mesclar contatos duplicados à mão (a importação já evita duplicar por e-mail e telefone).
8. Exportar contatos ou oportunidades.

## Métricas de sucesso (uso pessoal)

- Toda reunião comercial termina com a oportunidade criada ou atualizada em até um clique.
- O usuário consegue responder "quanto tenho aberto e o que está esfriando" sem sair do app.
- Zero oportunidades criadas sem ação humana (invariante de produto, não métrica).

## Riscos

- **Extração errada** (empresa, valor, etapa). Mitigação: tudo é proposta; o cartão mostra a justificativa
  e permite editar antes de criar.
- **Explosão de sugestões de contato** em quem tem caixa de e-mail grande. Mitigação: só remetentes com
  duas ou mais trocas nos últimos 90 dias entram nas sugestões; newsletters e `noreply` são filtrados;
  "Ignorar" é lembrado.
- **Barra lateral cheia.** Com o Instagram mesclado na 0.19.0, a raiz tem 8 itens; o Funil entra entre
  Email e Redes. Mitigação: nenhuma nesta versão; se a raiz crescer de novo, agrupar.
- **Custo de tokens** da leitura extra por reunião. Mitigação: passada curta com Haiku por padrão, e o
  interruptor em Configurações.

## Documentos

- Spec: `spec.md` (regras, critérios de aceite, verificação end-to-end).
- Plan: `plan.md` (decisões técnicas, grafo de tarefas, waves).
- Contratos: `contracts/107-…` em diante (84 a 106 pertencem à frente arquitetura-seguranca).
- Inventário do app usado como base: `inventario.md`.
