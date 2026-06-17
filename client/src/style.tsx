import { cn } from '@/lib/utils'
import { CatolicaLogo } from '@/svgs'

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

export { CatolicaLogo, CatolicaLogo as Logo, MicrosoftLogo } from '@/svgs'

export function LogoLockup({
  size = 32,
  className,
  title,
}: {
  size?: number
  className?: string
  title: string
}) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <CatolicaLogo size={size} />
      <span className="text-lg font-semibold">{title}</span>
    </div>
  )
}
