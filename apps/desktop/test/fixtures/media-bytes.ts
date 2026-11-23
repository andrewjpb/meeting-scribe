// Contrato 149: bytes mínimos de cada tipo para os testes das ferramentas de mídia (o começo de cada formato basta: o
// app decide o tipo pelos primeiros bytes) e os que nunca podem virar imagem (SVG, HTML, Lottie).
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 1)])
export const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(32, 1)])
export const WEBP = Buffer.concat([Buffer.from('RIFF\x20\0\0\0WEBPVP8 ', 'latin1'), Buffer.alloc(32, 1)])
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n', 'latin1')
export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
export const HTML = Buffer.from('<!doctype html><html><body>oi</body></html>')
/** A figurinha animada do WhatsApp em Lottie (JSON), declarada como `image/webp`. */
export const LOTTIE = Buffer.from('{"v":"5.7.4","fr":30,"layers":[]}')
