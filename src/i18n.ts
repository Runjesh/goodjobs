import { useState, useEffect, useCallback } from 'react';

type SupportedLanguage = 'en' | 'hi' | 'ta';

export const translations = {
  en: {
    dashboard: 'Dashboard',
    tasks: 'Tasks',
    copilot: 'GoodJobs Copilot',
    fundraising: 'Fundraising Cloud',
    crm: 'Donor CRM',
    finance: 'Finance & FCRA',
    programs: 'Programs MIS',
    csr: 'CSR Pipeline',
    volunteers: 'Volunteers',
    compliance: 'Compliance HQ',
    settings: 'Settings',
    search: 'Search donors, campaigns…',
    main: 'Main',
    operations: 'Operations',
    system: 'System'
  },
  hi: {
    dashboard: 'डैशबोर्ड',
    tasks: 'कार्य',
    copilot: 'गुडजॉब्स कोपायलट',
    fundraising: 'फंडरेज़िंग क्लाउड',
    crm: 'डोनर सीआरएम',
    finance: 'वित्त और FCRA',
    programs: 'प्रोग्राम MIS',
    csr: 'CSR पाइपलाइन',
    volunteers: 'स्वयंसेवक',
    compliance: 'अनुपालन HQ',
    settings: 'सेटिंग्स',
    search: 'डोनर और अभियान खोजें…',
    main: 'मुख्य',
    operations: 'संचालन',
    system: 'प्रणाली'
  },
  ta: {
    dashboard: 'டாஷ்போர்டு',
    tasks: 'பணிகள்',
    copilot: 'குட்ஜாப்ஸ் கோபைலட்',
    fundraising: 'நிதி திரட்டல்',
    crm: 'நன்கொடையாளர் CRM',
    finance: 'நிதி & FCRA',
    programs: 'திட்டங்கள் MIS',
    csr: 'CSR பைப்லைன்',
    volunteers: 'தொண்டர்கள்',
    compliance: 'இணக்கம் HQ',
    settings: 'அமைப்புகள்',
    search: 'நன்கொடையாளர்களைத் தேடுக…',
    main: 'முக்கிய',
    operations: 'செயல்பாடுகள்',
    system: 'அமைப்பு'
  }
};

export type TranslationKey = keyof typeof translations['en'];

let currentLanguage: SupportedLanguage = (localStorage.getItem('language') as SupportedLanguage) || 'en';
const listeners = new Set<(lang: SupportedLanguage) => void>();

export const setLanguage = (lang: SupportedLanguage) => {
  currentLanguage = lang;
  localStorage.setItem('language', lang);
  listeners.forEach(listener => listener(lang));
};

export const useTranslation = () => {
  const [lang, setLang] = useState<SupportedLanguage>(currentLanguage);

  useEffect(() => {
    listeners.add(setLang);
    return () => {
      listeners.delete(setLang);
    };
  }, []);

  const t = useCallback((key: TranslationKey) => {
    return translations[lang][key] || translations['en'][key];
  }, [lang]);

  return { t, lang, setLanguage };
};
