/** Dica de atalho dentro de um controle. O atalho em si é anunciado por `aria-keyshortcuts`. */
export function Shortcut({ keys }: { keys: string }) {
  return (
    <kbd aria-hidden="true" className="font-sans text-12 font-normal opacity-80">
      {keys}
    </kbd>
  )
}
