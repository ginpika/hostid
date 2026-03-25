import { Link } from 'react-router-dom'
import { Mail, FileText } from 'lucide-react'
import Layout from '../components/Layout'
import { useI18n } from '../i18n/I18nContext'
import { useConfig } from '../contexts/ConfigContext'

export default function InfoPage() {
  const { t, language } = useI18n()
  const { config, getDisplayName, getDescription } = useConfig()

  return (
    <Layout>
      <div className="flex-1 overflow-y-auto relative" style={{ backgroundColor: 'var(--color-bg-primary)' }}>
        <Link
          to="/tos"
          className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-2 rounded-lg transition-colors hover:bg-[var(--color-bg-tertiary)]"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          <FileText className="w-4 h-4" />
          <span className="text-sm">{t('tosAndPrivacy')}</span>
        </Link>
        
        <div className="max-w-2xl mx-auto p-8">
          <div className="mb-8">
            <h2 className="text-2xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{t('about')}</h2>
            <p className="mt-1" style={{ color: 'var(--color-text-tertiary)' }}>{getDescription(language as 'zh-CN' | 'en-US')}</p>
          </div>

          <div 
            className="rounded-lg border p-8"
            style={{ 
              backgroundColor: 'var(--color-bg-secondary)',
              borderColor: 'var(--color-border-primary)'
            }}
          >
            <div className="text-center mb-8">
              <div 
                className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'var(--color-accent-muted)' }}
              >
                <Mail className="w-8 h-8" style={{ color: 'var(--color-accent-primary)' }} />
              </div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text-primary)' }}>{getDisplayName(language as 'zh-CN' | 'en-US')}</h1>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-quaternary)' }}>v{config.version}</p>
            </div>

            <p className="text-center mb-8" style={{ color: 'var(--color-text-secondary)' }}>
              {t('aboutIntro')}
            </p>

            <div className="border-t pt-6" style={{ borderColor: 'var(--color-border-primary)' }}>
              <h3 className="text-sm font-semibold uppercase tracking-wider mb-4" style={{ color: 'var(--color-text-tertiary)' }}>{t('features')}</h3>
              <ul className="space-y-3">
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature1')}</span>
                </li>
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature2')}</span>
                </li>
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature3')}</span>
                </li>
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature4')}</span>
                </li>
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature5')}</span>
                </li>
                <li className="flex items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent-primary)' }}></span>
                  <span>{t('feature6')}</span>
                </li>
              </ul>
            </div>

            <div className="border-t pt-6 mt-6 text-center text-sm" style={{ borderColor: 'var(--color-border-primary)', color: 'var(--color-text-quaternary)' }}>
              <p>{t('builtWith')}</p>
            </div>
          </div>

          <div className="mt-6 flex justify-center">
            {/* <button
              onClick={() => navigate('/')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded-lg transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{t('backToInbox')}</span>
            </button> */}
          </div>
        </div>
      </div>
    </Layout>
  )
}
