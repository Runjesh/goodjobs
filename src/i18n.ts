import { useState, useEffect, useCallback } from 'react';

type SupportedLanguage = 'en' | 'hi' | 'ta';

export const translations = {
  en: {
    dashboard: 'Today',
    tasks: 'Tasks',
    copilot: 'GoodJobs Copilot',
    fundraising: 'Fundraising',
    crm: 'Donor CRM',
    finance: 'Finance & FCRA',
    programs: 'Programs',
    csr: 'CSR Pipeline',
    volunteers: 'Volunteers',
    compliance: 'Compliance',
    settings: 'Settings',
    funding: 'Funding',
    insights: 'Insights',
    reports: 'Reports',
    agenthq: 'Copilot',
    search: 'Search donors, campaigns…',
    main: 'Workspaces',
    operations: 'Operations',
    system: 'System'
  },
  hi: {
    dashboard: 'आज',
    tasks: 'कार्य',
    copilot: 'गुडजॉब्स कोपायलट',
    fundraising: 'फंडरेज़िंग',
    crm: 'डोनर सीआरएम',
    finance: 'वित्त और FCRA',
    programs: 'प्रोग्राम',
    csr: 'CSR पाइपलाइन',
    volunteers: 'स्वयंसेवक',
    compliance: 'अनुपालन',
    settings: 'सेटिंग्स',
    funding: 'फंडिंग',
    insights: 'अंतर्दृष्टि',
    reports: 'रिपोर्ट',
    agenthq: 'कोपायलट',
    search: 'डोनर और अभियान खोजें…',
    main: 'कार्यक्षेत्र',
    operations: 'संचालन',
    system: 'प्रणाली'
  },
  ta: {
    dashboard: 'இன்று',
    tasks: 'பணிகள்',
    copilot: 'குட்ஜாப்ஸ் கோபைலட்',
    fundraising: 'நிதி திரட்டல்',
    crm: 'நன்கொடையாளர் CRM',
    finance: 'நிதி & FCRA',
    programs: 'திட்டங்கள்',
    csr: 'CSR பைப்லைன்',
    volunteers: 'தொண்டர்கள்',
    compliance: 'இணக்கம்',
    settings: 'அமைப்புகள்',
    funding: 'நிதியளிப்பு',
    insights: 'நுண்ணறிவு',
    reports: 'அறிக்கைகள்',
    agenthq: 'கோபைலட்',
    search: 'நன்கொடையாளர்களைத் தேடுக…',
    main: 'பணியிடங்கள்',
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
