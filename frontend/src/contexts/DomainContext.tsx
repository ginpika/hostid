import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface DomainContextType {
  domain: string
  registrationEnabled: boolean
  loading: boolean
}

const DomainContext = createContext<DomainContextType>({
  domain: '',
  registrationEnabled: true,
  loading: true
})

export function DomainProvider({ children }: { children: ReactNode }) {
  const [domain, setDomain] = useState('')
  const [registrationEnabled, setRegistrationEnabled] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/auth/domain')
      .then(res => res.json())
      .then(data => {
        setDomain(data.domain || '')
        setRegistrationEnabled(data.registrationEnabled !== false)
      })
      .catch(() => {
        setDomain('')
        setRegistrationEnabled(true)
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <DomainContext.Provider value={{ domain, registrationEnabled, loading }}>
      {children}
    </DomainContext.Provider>
  )
}

export function useDomain() {
  const context = useContext(DomainContext)
  if (!context) {
    throw new Error('useDomain must be used within a DomainProvider')
  }
  return context
}
