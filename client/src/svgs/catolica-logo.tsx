import { cn } from '@/lib/utils'

export type CatolicaLogoProps = {
  /** Tamanho (largura/altura) em px. Padrão 40. */
  size?: number
  className?: string
  /** 'brand' = bordô (padrão); 'white' = branco (para fundos escuros/bordô). */
  variant?: 'brand' | 'white'
}

/**
 * Símbolo (livro aberto) da Católica SC.
 * Usa `currentColor`, então herda a cor do texto.
 */
export function CatolicaLogo({ size = 40, className, variant = 'brand' }: CatolicaLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 180 180"
      role="img"
      aria-label="Católica SC"
      className={cn(variant === 'white' ? 'text-white' : 'text-primary', className)}
    >
      <g transform="translate(0,180) scale(0.1,-0.1)" fill="currentColor" stroke="none">
        <path d="M430 1537 l0 -242 193 -120 c105 -65 202 -125 215 -133 l22 -14 0 248 0 249 -209 128 c-115 70 -212 127 -215 127 -3 0 -6 -109 -6 -243z" />
        <path d="M1143 1653 l-203 -125 0 -244 c0 -134 3 -244 6 -244 4 0 98 57 210 126 l204 126 0 244 c0 134 -3 244 -7 243 -5 0 -99 -57 -210 -126z" />
        <path d="M50 971 l0 -469 203 -123 c111 -68 283 -173 382 -234 100 -62 191 -117 203 -124 l22 -12 0 468 0 468 -42 26 c-253 155 -394 241 -565 345 l-203 124 0 -469z" />
        <path d="M1333 1188 l-393 -240 0 -470 0 -470 33 21 c17 12 196 121 397 243 201 122 368 227 372 232 4 6 8 217 8 469 0 359 -3 457 -12 456 -7 0 -190 -109 -405 -241z" />
      </g>
    </svg>
  )
}
