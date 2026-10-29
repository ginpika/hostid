interface BrandMarkProps {
  size?: number
  className?: string
  label?: string
}

export default function BrandMark({ size = 32, className, label = '' }: BrandMarkProps) {
  return <img src="/logo-stylized.png" width={size} height={size} className={`brand-mark${className ? ` ${className}` : ''}`} alt={label} draggable={false} />
}
