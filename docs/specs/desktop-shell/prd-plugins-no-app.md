# PRD — Plugins no app (baixar e instalar o plugin do Chrome pelo próprio app)
Feature: desktop-shell · Wave: 31 · Data: 18/11/2026 · Pedido do Andrew (18/11 15:00)

## Problema
O plugin "Quem fala no Meet" só existe na pasta do repositório: quem usa o app instalado não tem como obtê-lo,
e a instalação (carregar sem compactar no Chrome) não está explicada em lugar nenhum do app. Quando a extensão
não está conectada, o marcador vermelho não oferece caminho nenhum.

## Solução
1. O plugin passa a vir **embutido no app** (dentro do pacote; nada baixado da internet).
2. Nova aba **Configurações › Plugins**: um cartão por plugin (hoje um; a lista é genérica para os próximos,
   ex. Teams) com o estado (Conectado/Desconectado), o botão **"Salvar plugin…"** (escolhe uma pasta e o app
   grava ali a pasta da extensão, com o README dentro) e o manual **"Como instalar"** passo a passo.
3. Na tela de gravação, o marcador "Meet desconectado" vira **clicável** e leva à aba Plugins.

## O que NÃO é
- Não publica na Chrome Web Store; não baixa nada da internet; não instala sozinho no Chrome (o Chrome não
  permite — a pessoa carrega sem compactar seguindo o manual).

## Telas de impacto no usuário
- Configurações: aba nova "Plugins" com o cartão do Meet (estado, salvar, manual).
- Gravação: o marcador vermelho do Meet vira atalho para a instalação.

## Riscos
- A extensão fica dentro do app.asar: a cópia para fora é arquivo a arquivo (padrão já usado no app).
- `chrome://extensions` não abre por link (limitação do Chrome): o manual manda digitar o endereço.
