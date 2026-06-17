// src/style.tsx
// Identidade visual da Católica SC: cores da marca e o logo (livro) em SVG.
// As cores também estão no tema do shadcn (src/index.css) como variáveis CSS;
// aqui ficam os valores brutos para usos pontuais fora do Tailwind.

import { cn } from '@/lib/utils'

export const BRAND = {
  primaryDark: '#73122D',
  primary: '#911739',
  primaryLight: '#B91D49',
  neutralDark: '#1A1A1A',
  neutral: '#282828',
  neutralLight: '#3D3D3D',
  creamDark: '#E7CCA6', 
  cream: '#efdcc2',
  creamLight: '#F6EDDF',
} as const

type LogoProps = {
  size?: number
  className?: string
  variant?: 'brand' | 'white'
}

export function Logo({ size = 40, className, variant = 'brand' }: LogoProps) {
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

export function LogoLockup({
  size = 32,
  className,
  title,
}: LogoProps & { title: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Logo size={size} />
      <span className="text-lg font-semibold">{title}</span>
    </div>
  )
}
