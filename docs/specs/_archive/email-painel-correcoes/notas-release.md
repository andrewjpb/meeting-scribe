---
feature: email-painel-correcoes
versao: 0.26.2
data: 2026-11-24
semana: 2026-W48
---

# Notas da versão: correções do Painel de e-mail (destaques para o release)

Duas correções vindas do teste navegado da 0.25.0 nas contas reais.

- **Desfazer funciona em toda conta.** Em contas cuja Caixa de Entrada aparece com outro nome na lista de pastas (como "Caixa de entrada" no Zoho), o Desfazer dos lotes do Painel ("Mover" e "Mover todos") falhava com "pasta de origem não existe mais". Agora o app reconhece a pasta de entrada da conta como a origem e devolve as mensagens, inclusive para os lotes feitos na 0.25.0.
- **A Caixa de Entrada mostra o que o Painel moveu.** Depois de um mover pelo Painel, a pasta de origem passa a exibir a faixa "O Painel moveu N mensagens", com hora e Desfazer, do mesmo jeito que já fazia para o Assistente.
