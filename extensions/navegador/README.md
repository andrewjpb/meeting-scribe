# Controle do navegador — extensão do Chrome

Extensão do LAP Reuniões (contrato 46). Executa, numa **janela própria do Chrome**, os comandos que o app manda
deste computador: abrir endereços em abas novas, listar as abas, ler a página, clicar, digitar, aguardar e fechar
uma aba ou a janela.

- Age só na janela que ela mesma abriu no primeiro "abrir". Nunca lê nem mexe nas suas abas.
- Até 10 abas ao mesmo tempo na janela própria. Um link que abre aba nova dentro dela entra na lista; a aba que você
  fechar à mão sai.
- Não digita em campo de senha.
- O texto das páginas volta ao app como dado; a extensão nunca segue instrução escrita numa página.
- Só fala com `127.0.0.1` (o app). Nada sai do computador.
- Sem `chrome.debugger`: nenhuma faixa de "depurando este navegador".

## Instalar (sem compactar)

1. No Chrome, abra `chrome://extensions`.
2. Ligue **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha a pasta salva pelo app (ou `extensions/navegador` deste
   repositório).
4. A extensão aparece como "LAP Reuniões — Controle do navegador".

No app, em **Configurações › Plugins › Controle do navegador**, ligue **Ativar ponte**. Em alguns segundos o
cartão mostra "Conectado".

Depois de mudar algum arquivo, clique no ícone de recarregar da extensão em `chrome://extensions`.

## Como funciona

O app escuta numa das portas 47672 a 47681 (a extensão tenta nessa ordem e lembra a última que respondeu):

- `GET /v1/navegador/comandos`: o app segura o pedido até 25 s e responde `{ "comando": { "id", "tipo", ... } }`
  ou `{}`.
- `POST /v1/navegador/resultados` com `{ "id", "ok", "dados"?, "erro"? }`.

Comandos: `abrir` (`url`, só http/https; sempre aba nova, devolve o número `aba`), `abas` (a lista, com a usada
por último marcada `ativa`), `ler` (título, endereço, texto visível até 40 KB e os elementos interativos com `ref`),
`clicar` (`ref`), `digitar` (`ref`, `texto`), `aguardar` (`segundos`, 1 a 10) e `fechar` (com `aba`, só ela; sem,
a janela inteira). `ler`, `clicar`, `digitar` e `fechar` aceitam `aba`; sem ela, vale a última aba usada. Número
de aba que não existe dá "aba não existe"; o 11º `abrir` dá "muitas abas".
Os `ref` valem até a próxima leitura ou navegação daquela aba; depois disso o erro é "ref vencida, leia a página
de novo".

Conferir o servidor sem a extensão (com a ponte ligada no app):

```sh
curl -i http://127.0.0.1:47672/v1/navegador/comandos -H 'Origin: chrome-extension://teste'
```

Responde `{}` depois de até 25 s. Sem a origem `chrome-extension://`, responde 404.

## Quando o cartão fica "Desconectado"

O Chrome às vezes para o service worker da extensão. Abra `chrome://extensions` e clique em **service worker**
da extensão (ou no ícone de recarregar): ela volta a procurar o app.
