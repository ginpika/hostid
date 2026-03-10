import { createContext, useContext, useState, ReactNode } from 'react';
import { translations } from './translations';

type Language = 'zh-CN' | 'en-US';

type I18nContextType = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  t: (key: keyof typeof translations['zh-CN']) => string;
};

const I18nContext = createContext<I18nContextType | undefined>(undefined);

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
};

interface I18nProviderProps {
  children: ReactNode;
  initialLanguage?: Language;
}

export const I18nProvider = ({ children, initialLanguage = 'zh-CN' }: I18nProviderProps) => {
  const [language, setLanguageState] = useState<Language>(() => {
    const savedLang = localStorage.getItem('tempLanguage') as Language;
    return savedLang || initialLanguage;
  });

  const setLanguage = async (newLanguage: Language) => {
    try {
      localStorage.setItem('tempLanguage', newLanguage);
      
      const token = localStorage.getItem('token');
      if (token) {
        await fetch('/api/auth/language', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ language: newLanguage }),
        });
      }

      setLanguageState(newLanguage);
    } catch (error) {
      console.error('Failed to update language:', error);
    }
  };

  const t = (key: keyof typeof translations['zh-CN']) => {
    return translations[language][key] || translations['zh-CN'][key];
  };

  return (
    <I18nContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
};
