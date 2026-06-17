export type MicrosoftLogoProps = {
  /** Tamanho (largura/altura) em px. Padrão 16. */
  size?: number
  className?: string
}

/**
 * Logo da Microsoft (4 quadrados), monocromático.
 * Usa `currentColor`, então herda a cor do texto (no botão de login = branco).
 * Para uso no botão "Entrar com Microsoft".
 */
export function MicrosoftLogo({ size = 16, className }: MicrosoftLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="currentColor"
      role="img"
      aria-label="Microsoft"
      className={className}
    >
      <path d="M31.87,30.58H244.7V243.39H31.87Z" />
      <path d="M266.89,30.58H479.7V243.39H266.89Z" />
      <path d="M31.87,265.61H244.7v212.8H31.87Z" />
      <path d="M266.89,265.61H479.7v212.8H266.89Z" />
    </svg>
  )
}
