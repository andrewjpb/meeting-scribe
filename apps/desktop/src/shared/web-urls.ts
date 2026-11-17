// Endereços `http(s)://` num texto livre (contrato 26): o pedido da pessoa, de onde saem as páginas que ela deixou o
// agente abrir. O main usa na política da internet; o formulário da tarefa mostra a lista antes de salvar.

/** Pontuação do fim que não faz parte do endereço ("veja https://x.com/a." ou "(https://x.com/a)"). */
function trimUrl(candidate: string): string {
  let url = candidate.replace(/[.,;:!?'"*]+$/, '')
  for (const [open, close] of [
    ['(', ')'],
    ['[', ']'],
  ] as const) {
    while (url.endsWith(close) && url.split(close).length > url.split(open).length) url = url.slice(0, -1).replace(/[.,;:!?'"*]+$/, '')
  }
  return url
}

/** Os endereços `http(s)://` do texto, na ordem, sem repetir. */
export function urlsIn(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"'`\\]+/g) ?? []
  return [...new Set(found.map(trimUrl).filter((url) => url.length > 'https://'.length))]
}
