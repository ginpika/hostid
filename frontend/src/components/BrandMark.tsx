import { useEffect, useState } from 'react'
import { useConfig } from '../contexts/ConfigContext'
import { DEFAULT_SITE_ICON_URL } from '../lib/siteBranding'

interface BrandMarkProps {
  size?: number
  className?: string
  label?: string
  src?: string
}

export default function BrandMark({ size = 32, className, label = '', src }: BrandMarkProps) {
  const { siteIconUrl } = useConfig()
  const resolvedSrc = src ?? (siteIconUrl || DEFAULT_SITE_ICON_URL)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  useEffect(() => {
    setFailedSrc(null)
  }, [resolvedSrc])

  const effectiveSrc = failedSrc === resolvedSrc ? DEFAULT_SITE_ICON_URL : resolvedSrc

  return (
    <img
      src={effectiveSrc}
      width={size}
      height={size}
      className={`brand-mark${className ? ` ${className}` : ''}`}
      alt={label}
      draggable={false}
      onError={() => {
        if (effectiveSrc !== DEFAULT_SITE_ICON_URL) {
          setFailedSrc(resolvedSrc)
        }
      }}
    />
  )
}
