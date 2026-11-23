---
status: aprovada
feature: pastas-assistente
tipo: prd
data: 2026-11-23
semana: 2026-W48
---

# PRD — Pastas do Assistente e anexos na resposta de e-mail

## Problema

O Andrew guarda os documentos da LAP numa pasta do Mac. Quando um cliente pede documentos por e-mail (caso real: o Michel), ele precisa abrir a pasta, descobrir o que já tem, anexar um por um e escrever a resposta à mão. O Assistente do LAP Reuniões lê o e-mail, mas não vê a pasta e não consegue anexar nada. Ele quer "resolver tudo pelo sistema".

## Objetivo

1. O Andrew escolhe, em Configurações, pastas do Mac que o Assistente pode **ler** (nunca alterar).
2. Com a fonte **Pastas** ligada na conversa, o Assistente sabe o que existe nas pastas, abre os arquivos quando precisa (PDF, Word, planilha, texto, imagem) e cita cada um com um botão **Abrir** que revela o arquivo no Finder.
3. Ao ler um e-mail que **pede documentos**, o Assistente cruza o pedido com as pastas e propõe um cartão de resposta com os anexos encontrados, item a item, dizendo o que **não encontrou**. O botão **Abrir no Composer** monta o e-mail com os anexos já colocados; **o envio continua sendo só o clique do Andrew em Enviar**.
4. Perguntas como "o que o Michel pediu e o que eu já tenho?" ou "resuma este contrato" funcionam sobre arquivos da pasta e sobre anexos do e-mail, pela mesma leitura.

## Fora do objetivo

- Escrever, mover, renomear ou apagar arquivos das pastas.
- Enviar e-mail sem clique, ou anexar algo fora das pastas permitidas.
- Indexar o conteúdo (busca por texto dentro dos arquivos): o índice tem nomes, caminhos, tipos, tamanhos e datas; o conteúdo é lido sob demanda.
- PowerPoint, compactados, vídeo e áudio das pastas: podem ser anexados, mas não são lidos nesta versão.
- Pastas em nuvem não montadas no Finder (Drive via API etc.).

## Telas de impacto no usuário

| Tela | O que muda |
|---|---|
| Configurações › Claude | Seção nova **"Pastas que o Assistente pode ler"**: lista das pastas (caminho encurtado, contagem de arquivos legíveis), botão **Adicionar pasta…** (diálogo nativo), **Remover** por linha, aviso quando uma pasta é recusada (sensível ou oculta). |
| Assistente › painel Contexto | Linha nova **Pastas** (desligada por padrão; mostra "Nenhuma pasta escolhida · Configurações" quando a lista está vazia). |
| Assistente › resposta | Passo "Lendo um arquivo da pasta"; citações `[Pasta · caminho/do/arquivo]` com botão **Abrir** (revela no Finder). |
| Assistente › cartão **Resposta de e-mail** | Quando há anexos: lista "pedido → arquivo (tamanho)" ou "não encontrado", total dos anexos contra o limite de 20 MB, botão **Abrir no Composer** no lugar de Enviar. |
| Email › Composer | Abre já preenchido (para, assunto, texto, em resposta a) e com os anexos listados, como se o Andrew os tivesse escolhido; Enviar como hoje. |

Dá para gerar a apresentação do cliente depois da implementação, com prints reais; perguntar antes.

## Privacidade e segurança (limites que valem)

- Só leitura: o CLI roda com `--restricted` e sem `--add-dir`; a única porta para as pastas é a ferramenta do app, que copia um arquivo por vez para a pasta da conversa (0600) e o apaga quando a fonte é desligada ou a conversa é apagada.
- Pastas recusadas por padrão: a pasta pessoal inteira, `Library`, pastas ocultas (`.ssh`, `.gnupg`, `.aws`, `.config`…), raiz do sistema, pasta de dados do próprio app. Arquivos e pastas ocultos nunca entram no índice; links simbólicos não são seguidos.
- Limites: 20 MB por arquivo para leitura e anexo, 20 MB e 10 arquivos somados por e-mail (limite do app), 20.000 caracteres de texto extraído, 8 leituras por pergunta (orçamento compartilhado com as mídias).
- Conteúdo das pastas é **material**, não instrução: um arquivo não pode induzir ação que altera algo (regra do contrato 149 vale para a leitura de pastas).
- O modelo só indica **ids** do índice; o app resolve o caminho real dentro da pasta permitida e confere o tamanho antes de ler ou anexar. Nada de conteúdo de arquivo ou de e-mail em log; o smoke registra só números e booleanos e usa pasta de exemplo sintética.

## Sucesso

O Andrew aponta a pasta dos documentos da LAP, abre o e-mail do Michel, pede ao Assistente, recebe o cartão com os anexos encontrados e os faltantes, abre no Composer com os arquivos anexados e envia ele mesmo.
