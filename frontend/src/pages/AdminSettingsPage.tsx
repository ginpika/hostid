import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { AppWindow, Database, KeyRound, Settings2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useI18n } from '../i18n/I18nContext'
import AdminPage from './AdminPage'
import OAuthAppsPage from './OAuthAppsPage'
import OAuthConfigPage from './OAuthConfigPage'
import SystemSettingsPage from './SystemSettingsPage'
import '../styles/admin-settings.css'

const TABS = [
  { id: 'general', label: 'systemSettings', icon: SlidersHorizontal, Panel: SystemSettingsPage },
  { id: 'providers', label: 'settingsLoginProviders', icon: KeyRound, Panel: OAuthConfigPage },
  { id: 'apps', label: 'settingsAuthorizedApps', icon: AppWindow, Panel: OAuthAppsPage },
  { id: 'database', label: 'admin', icon: Database, Panel: AdminPage }
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminSettingsPage() {
  const { user } = useAuth()
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = TABS.find(tab => tab.id === searchParams.get('tab'))?.id || 'general'
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set([activeTab]))
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({})

  useEffect(() => {
    setVisitedTabs(previous => previous.has(activeTab) ? previous : new Set([...previous, activeTab]))
  }, [activeTab])

  const selectTab = (id: TabId) => {
    if (id === activeTab) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      if (id === 'general') next.delete('tab')
      else next.set('tab', id)
      return next
    })
  }

  const handleTabKey = (event: KeyboardEvent<HTMLButtonElement>, id: TabId) => {
    const index = TABS.findIndex(tab => tab.id === id)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight': nextIndex = (index + 1) % TABS.length; break
      case 'ArrowLeft': nextIndex = (index - 1 + TABS.length) % TABS.length; break
      case 'Home': nextIndex = 0; break
      case 'End': nextIndex = TABS.length - 1; break
      default: return
    }
    event.preventDefault()
    const button = tabRefs.current[TABS[nextIndex].id]
    button?.focus()
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  if (user?.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-shell">
        <header className="admin-settings-heading">
          <div className="admin-settings-heading-copy">
            <span className="admin-settings-mark" aria-hidden="true"><Settings2 size={24} strokeWidth={1.6} /></span>
            <div>
              <h2>{t('settings')}</h2>
              <p>{t('settingsOverviewDescription')}</p>
            </div>
          </div>
          <span className="admin-settings-access"><ShieldCheck size={14} aria-hidden="true" />{t('settingsAdministrator')}</span>
        </header>

        <div className="admin-settings-surface">
          <div className="admin-settings-tabs" role="tablist" aria-label={t('settingsSections')}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                ref={element => { tabRefs.current[tab.id] = element }}
                id={`settings-tab-${tab.id}`}
                type="button"
                role="tab"
                className="admin-settings-tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`settings-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                onKeyDown={event => handleTabKey(event, tab.id)}
              >
                <tab.icon size={17} strokeWidth={1.8} aria-hidden="true" />
                <span>{t(tab.label)}</span>
              </button>
            ))}
          </div>

          {TABS.map(tab => (
            <section
              key={tab.id}
              id={`settings-panel-${tab.id}`}
              className="admin-settings-panel"
              role="tabpanel"
              aria-labelledby={`settings-tab-${tab.id}`}
              hidden={activeTab !== tab.id}
              tabIndex={0}
            >
              {(activeTab === tab.id || visitedTabs.has(tab.id)) && <tab.Panel embedded />}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
