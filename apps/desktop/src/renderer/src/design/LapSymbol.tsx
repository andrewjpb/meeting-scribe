// Símbolo da LAP na versão para fundo azul (design.md, Marca). Mesma geometria de
// docs/specs/desktop-shell/brand/logo-lap-simbolo.svg: quadrado com rx 6 em viewBox 100, "L" com
// traço 8 e pontas quadradas, quadrado 22×22 em 62,58. Só as cores trocam: quadrado branco, "L" no
// azul profundo e o quadrado pequeno no azul vibrante.

export function LapSymbol({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="LAP" focusable="false" className="block shrink-0">
      <rect x={0} y={0} width={100} height={100} rx={6} className="fill-logo-tile" />
      <path
        d="M 20 25 L 20 75 L 55 75"
        fill="none"
        strokeWidth={8}
        strokeLinecap="square"
        strokeLinejoin="miter"
        className="stroke-logo-mark"
      />
      <rect x={62} y={58} width={22} height={22} className="fill-logo-dot" />
    </svg>
  )
}
