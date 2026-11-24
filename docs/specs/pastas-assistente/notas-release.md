---
feature: pastas-assistente
tipo: notas-release
data: 2026-11-23
semana: 2026-W48
---

# Notas da versão — Pastas do Assistente e anexos na resposta de e-mail

**O que você ganha**

- **Pastas do Assistente**: em Configurações › Claude, "Pastas que o Assistente pode ler" guarda as pastas do Mac onde ficam os seus documentos. Em cada conversa, ligue a fonte **Pastas** no Contexto e pergunte: "onde está o contrato da ABF?", "resuma a proposta em Word", "quais valores tem na planilha?". Ele lê PDF, imagem, Word, planilha (xlsx) e texto, e cita cada arquivo como **[Pasta · …]**, um botão que mostra o arquivo no Finder.
- **Resposta de e-mail com os documentos pedidos**: com o e-mail aberto no Assistente, "responda ao Michel com os documentos que ele pediu" vira o cartão "Responder por email" com os anexos achados (um por item pedido), o que não foi encontrado e o total. **Abrir no Composer** abre a resposta na tela Email com os anexos prontos; você revisa e envia.

**Limites desta versão**

- 20 MB por arquivo; 20 MB e 10 arquivos por e-mail; até 8 arquivos lidos por pergunta e 20.000 caracteres de texto por arquivo.
- PowerPoint, Keynote, Pages, Numbers e OpenDocument de planilha e apresentação (ods, odp) entram só como anexo (não são lidos); Word, rtf e odt são lidos.
- O índice vai até 5.000 arquivos e 6 níveis de subpasta; pastas enormes saem com a lista parcial (a resposta avisa).
- A lista de pastas ainda não mostra quantos arquivos cada uma tem.

**Privacidade**

- **Só leitura, sempre**: o Assistente nunca altera, move ou apaga nada nas pastas. A pasta pessoal inteira, a Library, as pastas do sistema, as do app e as ocultas não podem ser escolhidas; links simbólicos e arquivos ocultos ficam de fora.
- A fonte vem desligada em cada conversa. Ligada, a lista dos arquivos (sem conteúdo) e os arquivos que ele lê para responder vão para o Claude. As cópias lidas ficam na pasta da conversa, no seu Mac, e somem quando você desliga a fonte, remove a pasta ou apaga a conversa.
- **Nada sai sem o seu clique em "Enviar" no Composer**: o cartão com anexos não tem botão de envio.
