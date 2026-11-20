---
status: em-aprovacao
feature: redes-instagram
data: 2026-11-20
semana: 2026-W47
---

# Spec: Redes sociais — Instagram

## Problema e objetivo

O Andrew quer cuidar das redes sociais de dentro do LAP Reuniões, uma rede por vez, começando pelo Instagram: publicar e agendar posts, acompanhar e responder comentários e mensagens, ver métricas, e usar o Assistente para redigir posts a partir das reuniões. Integração própria (sem agregador pago), para as contas profissionais do próprio Andrew, com o app Meta em modo desenvolvimento (Standard Access, sem App Review). As credenciais são dele; o app fica pronto para recebê-las.

## Não-objetivos

- Atender contas de terceiros (Advanced Access, App Review, verificação de empresa).
- LinkedIn e outras redes (entram depois no mesmo domínio "Redes").
- Webhooks (um app desktop não recebe chamadas da Meta): tudo é por consulta periódica.
- Publicar por automação agendada (ação controlada como a de email, contrato 51): fica para uma rodada seguinte; aqui a automação não publica.
- Stories e menções: a API da Instagram Login não garante os dois sem Página; ficam fora até se confirmar na prática.
- Editar post já publicado, curtir, seguir, anúncios, loja.
- Release: esta rodada termina em build local (`pnpm dev` ou `.dmg` sem tag) para teste conjunto.

## O que existe hoje

Não há nada de redes sociais. O padrão a seguir é o domínio Email: serviço no main (`main/email/service.ts`) com store JSON em `userData`, canais `scribe:email-*` em `shared/ipc.ts` classificados em `WHEN_LOCKED`, store Zustand, rota em `shared/routes.ts`, nível em pilha na barra lateral (`app/sidebarLevels.ts`, `SidebarStack.tsx`), seção na aba Contas de Configurações (como Google, Microsoft e WhatsApp em `features/settings`), segredos em `main/accounts/vault.ts` (`safeStorage`), HTTP só por `net.fetch` com lista de hosts (`accounts/http.ts`), Assistente com contexto por arquivos (`main/chat/sources.ts`) e ferramentas `lap-ferramenta` (`main/chat/tools.ts`), smoke sem rede com `HttpFetch` falso (`main/google/fake-google.ts`). Os nove atalhos ⌘1–⌘9 de Configurações já estão ocupados: não entra aba nova.

## Fatos da API que a spec assume (pesquisa de 2026-11-20, Instagram API with Instagram Login, `graph.instagram.com`, v27.0)

- Conta Business ou Creator; sem Página do Facebook. App Meta do tipo Business com o produto Instagram; a conta do Andrew entra como conta de teste/testador.
- **Token:** o painel da Meta ("API setup with Instagram login › Generate token") gera um token longo de 60 dias. `GET /refresh_access_token?grant_type=ig_refresh_token` renova por mais 60 dias, sem o segredo do app, desde que o token tenha mais de 24 h e ainda valha. A troca OAuth exige o `client_secret`, que a Meta manda não guardar no dispositivo: **por isso esta fase usa o token colado, não OAuth.**
- **Perfil:** `GET /me?fields=user_id,username,name,account_type,profile_picture_url,followers_count,follows_count,media_count`.
- **Publicar:** `POST /<IG_ID>/media` (contêiner) e `POST /<IG_ID>/media_publish`. Imagem exige `image_url` pública em JPEG (até 8 MB, 4:5 a 1,91:1, 320–1440 px). Vídeo/Reels: `video_url` pública ou upload retomável em `rupload.facebook.com` a partir do arquivo local (MP4/MOV, 3 s a 15 min, até 300 MB). Carrossel: filhos com `is_carousel_item=true`, 2 a 10 itens, sem Reels. Status do contêiner por `status_code` (IN_PROGRESS, FINISHED, ERROR, EXPIRED, PUBLISHED). Cota: `GET /<IG_ID>/content_publishing_limit` (`quota_usage`, `quota_total`, hoje 50/24 h). Legenda até 2.200 caracteres, 30 hashtags, 20 @. Não há agendamento nativo: quem agenda é o app.
- **Comentários:** `GET /<MEDIA_ID>/comments` (campos `id,text,timestamp,username,from,hidden,like_count,parent_id,replies`), `POST /<COMMENT_ID>/replies`, `POST /<COMMENT_ID>?hide=`, `DELETE /<COMMENT_ID>`.
- **Mensagens:** `GET /me/conversations?platform=instagram` (`updated_time`), `GET /<CONV_ID>?fields=messages{id,created_time,from,to,message}` (só as 20 mais recentes com detalhe), `POST /<IG_ID>/messages` com `recipient{id}` e `message{text}` (até 1000 bytes). Janela de 24 h desde a última mensagem do contato. Pode exigir "Permitir acesso a mensagens" nas configurações do Instagram e pode ficar limitado em Standard Access: a tela avisa quando a API recusar.
- **Métricas:** conta `GET /<IG_ID>/insights?metric=reach,views,accounts_engaged,total_interactions,likes,comments,saves,shares,follows_and_unfollows,profile_links_taps&period=day&metric_type=total_value&since&until`; mídia `GET /<MEDIA_ID>/insights?metric=views,reach,likes,comments,saved,shares,total_interactions`. Atraso de até 48 h. `impressions` não existe mais.
- **Limites:** uso por app+usuário (cabeçalho `X-Business-Use-Case-Usage`); códigos 4, 17, 80002 pedem espera. Conversas: 2 chamadas/s.

## Regras

**R1. Domínio "Redes".** Novo domínio `redes` (main `main/redes/`, canais `scribe:redes-*`, rota `/redes/:conta?/:secao?`, seção `redes` na barra lateral, store `useRedes`). A primeira rede é o Instagram; o modelo de dados já tem o campo `rede: 'instagram'` para as próximas.

**R2. Conta por token.** Em Configurações › Contas, seção **Instagram**: campo "Token de acesso" (gerado no painel da Meta), botão **Conectar**. O app valida chamando `/me`, guarda o token no cofre cifrado (`userData/accounts/instagram.bin`, padrão `createVault`) e mostra a conta (foto, @username, tipo, seguidores, "Token válido até <data>"). Várias contas podem ser conectadas (uma por token). **Renovação:** o serviço renova cada token quando ele tem mais de 7 dias e menos de 60 (ao abrir o app e uma vez por dia); se a renovação falhar ou o token vencer, o estado vira `expirado` e a seção pede um token novo. Botão **Remover** apaga token e dados locais da conta. Estados: `conectando`, `conectada`, `expirada`, `erro` (com mensagem). Instruções curtas na própria seção: como gerar o token no painel da Meta (4 passos) e o aviso de que a conta precisa ser profissional e pública.

**R3. Armazenamento de mídia.** Em Configurações › Contas, seção **Armazenamento de mídia (S3)**: endpoint, região, bucket, chave de acesso, chave secreta, URL pública base. Compatível com Cloudflare R2 e qualquer S3. Chaves no cofre (`media-host.bin`). Botão **Testar** faz um upload de 1 byte e um GET público. Imagens e carrosséis só publicam com o armazenamento configurado; vídeo/Reels usam o upload retomável da Meta e não precisam dele. O arquivo sobe para `instagram/<conta>/<id>.<ext>` e é apagado do bucket após a publicação confirmada (ou 48 h depois de erro). Assinatura AWS SigV4 implementada no app, sem dependência nova.

**R4. Publicações.** Cada conta tem uma fila local de publicações com estados `rascunho`, `agendada`, `publicando`, `publicada`, `erro`. Uma publicação tem: tipo (imagem, carrossel, vídeo/Reels; inferido pelas mídias), de 1 a 10 mídias (arquivos locais escolhidos no diálogo nativo, validados pelas especificações da Meta antes de salvar: formato, tamanho, proporção, duração), legenda (contador de 2.200, hashtags e @), texto alternativo opcional por imagem, data/hora agendada (opcional), e, depois de publicada, o `media_id`, o permalink e a hora real. **Publicar agora** e **Agendar** passam pelo token de clique do preload (como `emailSend`). O agendador do serviço (tick de 30 s, no main) publica o que venceu: sobe a mídia, cria o contêiner, espera `FINISHED` (consulta a cada 5 s por até 5 min), publica, grava o resultado; em erro, a publicação vira `erro` com a mensagem traduzida e um botão **Tentar de novo**; nada é publicado duas vezes (idempotência por `id` local e por contêiner já criado). Antes de publicar, confere a cota: se `quota_usage >= quota_total`, adia 1 h e avisa. Rascunho pode ser editado e apagado; agendada pode voltar a rascunho; publicada só abre o permalink e mostra métricas.

**R5. Comentários.** O serviço lê os comentários das 25 mídias mais recentes a cada `redesPollMinutes` (setting, padrão 5) e ao abrir a seção. Guarda localmente (`userData/redes/instagram-<id>.json`) com `lido` por comentário (marca ao abrir a mídia na tela). Tela: lista de mídias com comentários, agrupada por mídia (miniatura, legenda curta, total e não lidos), comentários em ordem cronológica com respostas aninhadas; ações **Responder** (inline, Enter envia, Esc cancela), **Ocultar/Mostrar**, **Excluir** (confirmação inline). Não lidos somam no badge do nível.

**R6. Mensagens.** O serviço lê `/me/conversations` a cada `redesPollMinutes` e as mensagens das conversas com `updated_time` novo. Tela em duas colunas: conversas (nome/@, última mensagem, hora, não lida) e a conversa aberta (balões, hora) com campo de resposta (até 1000 bytes, contador). Se a última mensagem do contato tem mais de 24 h, o campo mostra "Fora da janela de 24 h: o Instagram pode recusar" e deixa tentar. Se a API recusar o acesso a mensagens (permissão ou Standard Access), a tela mostra uma `Note` explicando e como liberar no Instagram, sem erro vermelho.

**R7. Métricas.** Tela com dois blocos: **Conta** (seguidores agora, e para o período escolhido: alcance, visualizações, contas engajadas, interações, curtidas, comentários, salvamentos, compartilhamentos, seguidores ganhos/perdidos, toques em links; período 7, 28 ou 90 dias, com a nota "até 48 h de atraso") e **Publicações** (as 25 mais recentes com visualizações, alcance, curtidas, comentários, salvamentos, compartilhamentos; ordenável). Números com formatação pt-BR. Atualiza ao abrir e a cada hora; cache local.

**R8. Barra lateral e tela.** Item raiz **Redes** (ícone `at-sign`), entre Email e Automações, só visível com pelo menos uma conta conectada ou quando a rota está ativa (sem conta, a tela mostra `EmptyState` com o botão "Conectar conta" que abre Configurações › Contas). Nível em pilha **Redes** com cabeçalho "‹ Redes": uma linha por conta (ícone do Instagram + @username, recolhível quando há mais de uma), com as linhas Publicações, Comentários (badge de não lidos), Mensagens (badge), Métricas; no pé, "Conectar conta…" leva a Configurações › Contas. Marca e rodapé não se movem; mesmas regras de foco, memória de último destino e voltar sem navegar do sidebar em pilha. Tela: `PageHeader` com "@username · <Seção>" e ações da seção à direita ("Nova publicação" em Publicações; "Atualizar" nas demais).

**R9. Assistente.** Fonte de contexto **Redes** (`REDES.md` na pasta da conversa, interruptor no painel Contexto, desligado por padrão): contas, últimas 10 publicações com métricas, comentários e mensagens não lidos (texto de terceiros em uma linha). Ferramentas `lap-ferramenta`: `listar_publicacoes_instagram`, `listar_comentarios_instagram`, `criar_rascunho_instagram` (legenda, mídias opcionais por caminho, data opcional). Cartão `lap-acao` do tipo `instagram-rascunho`: mostra a legenda proposta e o botão **Criar rascunho** (abre a publicação na tela Redes, nunca publica direto). Guia do app ganha a seção Redes.

**R10. Bloqueio, segurança e rede.** Todos os canais `scribe:redes-*` são `refused` com o app bloqueado; eventos ignorados. Hosts permitidos: `graph.instagram.com`, `rupload.facebook.com`, o endpoint S3 configurado e a URL pública base; para as miniaturas das mídias (comentários e métricas), também `*.cdninstagram.com` e `*.fbcdn.net`, só leitura por `https` (sem usuário, senha nem porta), só JPEG de até 8 MB, gravado em `userData/redes/thumbs/`; qualquer outro é recusado por `allowedUrl`. Nenhum segredo em log, `report.json` ou arquivo de contexto do Assistente. Texto de terceiros (comentários, mensagens, legendas) nunca é interpretado como instrução pelo Assistente (uma linha, sem cerca de código, como já é no email).

## Regras de negócio

- Uma publicação só é criada na Meta uma vez; o `creation_id` fica gravado antes de chamar `media_publish`. Ao reabrir o app com uma publicação em `publicando`, o serviço consulta o contêiner e retoma.
- Horários agendados são locais do Mac; a tela mostra a hora local. Com o app fechado nada publica: a tela avisa "Publica quando o LAP Reuniões estiver aberto" ao agendar.
- Mídia validada no app antes de salvar o rascunho; o erro da Meta na publicação vira texto em pt-BR (tabela de códigos 9004, 9007, 36003, 36000, 352, 24, 25, 4/2207051, 9/2207042).
- Comentários e mensagens só mudam de "não lido" para "lido" por ação do usuário na tela.
- Remover a conta apaga token, cache e fila; publicações já feitas continuam no Instagram.

## Telas de impacto no usuário

1. **Configurações › Contas** ganha as seções **Instagram** (token, conta conectada, estado, renovação, remover, instruções) e **Armazenamento de mídia (S3)**.
2. **Barra lateral**: novo item raiz **Redes** e novo nível em pilha com contas e seções, badges de não lidos.
3. **Tela Redes › Publicações**: fila (rascunhos, agendadas, publicadas, erro) e o editor de publicação (mídias, legenda, texto alternativo, agendar/publicar agora).
4. **Tela Redes › Comentários**: mídias com comentários, responder, ocultar, excluir.
5. **Tela Redes › Mensagens**: conversas e resposta com aviso da janela de 24 h.
6. **Tela Redes › Métricas**: números da conta e das publicações.
7. **Assistente**: interruptor "Redes" no Contexto e o cartão "Criar rascunho".
8. **Painel Contexto e guia do app**: textos novos.

Dá para gerar a apresentação do cliente depois da implementação, com prints reais; aqui o "cliente" é o próprio Andrew, então só se ele quiser.

## Critérios de aceite

- **CA1.** Colar um token válido em Configurações › Contas › Instagram e Conectar mostra a conta (@, foto, tipo, seguidores, validade) em até 5 s; token inválido mostra "Token recusado pelo Instagram" sem travar a tela.
- **CA2.** O token é guardado cifrado; não aparece em settings.json, logs, report.json nem em arquivos do Assistente.
- **CA3.** Token com mais de 7 dias é renovado ao abrir o app; a validade mostrada avança. Falha de renovação deixa a conta `expirada` com o pedido de token novo.
- **CA4.** Armazenamento S3 configurado e **Testar** verde; sem ele, o editor avisa ao escolher imagem e desabilita Publicar/Agendar para imagem e carrossel; vídeo segue.
- **CA5.** Nova publicação com uma imagem JPEG válida: Publicar agora → estado `publicando` → `publicada` com permalink, em um fluxo único e sem duplicar; a mídia é apagada do bucket depois.
- **CA6.** Imagem fora das especificações é recusada no editor com a razão (formato, tamanho, proporção, dimensões).
- **CA7.** Carrossel de 2 a 10 imagens publica; 11 é recusado no editor. Vídeo MP4 publica como Reels pelo upload retomável.
- **CA8.** Agendar para daqui a 1 min publica no tick seguinte ao horário; com cota esgotada, adia 1 h e mostra o aviso.
- **CA9.** Erro da Meta vira mensagem em pt-BR e botão Tentar de novo; um contêiner já criado não é criado de novo na nova tentativa.
- **CA10.** Comentários aparecem agrupados por mídia; responder, ocultar e excluir refletem na lista; não lidos somam no badge do nível e zeram ao abrir a mídia.
- **CA11.** Mensagens: conversas e balões aparecem; enviar resposta dentro da janela funciona; fora da janela mostra o aviso; recusa da API vira `Note` explicativa.
- **CA12.** Métricas da conta e das 25 publicações carregam para 7/28/90 dias, formatadas em pt-BR.
- **CA13.** Barra lateral: item Redes aparece com conta conectada; nível com contas e seções; badges; voltar não navega; ⌘, do nível Redes vai a Configurações; mesmas regras do sidebar em pilha (slide 180 ms, reduzido instantâneo, largura 224 px sem corte).
- **CA14.** Assistente: com o interruptor Redes ligado, a conversa recebe `REDES.md`; a ferramenta `criar_rascunho_instagram` cria um rascunho visível na fila e o cartão "Criar rascunho" abre o editor; nada é publicado pelo Assistente.
- **CA15.** Bloqueado (⌘⇧L), todos os canais `scribe:redes-*` recusam e o agendador não publica; ao desbloquear, retoma.
- **CA16.** Remover conta apaga token, cache e fila e esconde a conta do nível.
- **CA17.** Smoke sem rede: `HttpFetch` falso do Instagram e do S3 cobre CA1, CA3, CA5–CA10, CA12–CA16; nenhuma chamada externa real.
- **CA18.** Docs: README, guia do app, design.md e docs/telas atualizados; spec arquivada em `_archive/redes-instagram/`.

## Prints exigidos (smoke, claro e escuro)

`contas-instagram` (seção com conta conectada), `contas-midia-s3`, `sidebar-redes` (nível), `redes-publicacoes` (fila), `redes-editor` (publicação com imagem e legenda), `redes-publicacao-erro`, `redes-comentarios`, `redes-mensagens`, `redes-mensagens-janela`, `redes-metricas`, `redes-vazio` (sem conta), `assistente-contexto-redes`, `assistente-cartao-rascunho`.

## Riscos

- Standard Access pode limitar mensagens: a tela degrada com explicação (R6). Confirmar no teste conjunto.
- Limite de 50 ou 100 publicações/24 h: o app lê `content_publishing_limit` em vez de assumir.
- Token colado manualmente vence em 60 dias se o app ficar fechado por mais de 60 dias: a seção pede token novo.
- Imagem exige URL pública: dependência do bucket (R3). Vídeo não.
- A Meta direciona novidades para a "Unified Login" (com portfólio empresarial). A Instagram Login segue sem data de descontinuação; o cliente HTTP fica isolado em `main/redes/instagram-client.ts` para trocar a montagem sem mexer na tela.

## Fora de escopo

Ver Não-objetivos. Também: múltiplos usuários, aprovação de posts, biblioteca de mídia, edição de imagem, hashtags sugeridas, melhor horário, LinkedIn.

## Verificação end-to-end

Teste conjunto com o Andrew no build local (`pnpm dev` no worktree ou `.dmg` local sem tag): conectar a conta real pelo token, configurar o bucket, publicar uma imagem de teste e apagá-la no Instagram, responder um comentário, ler e responder uma mensagem, ver métricas; depois teste navegado em sessão nova com prints e relatório.
