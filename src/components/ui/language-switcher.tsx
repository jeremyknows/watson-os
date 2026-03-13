'use client'

import { useLocale } from 'next-intl'
import { locales, localeNames, type Locale } from '@/i18n/config'

function setLocaleCookie(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;SameSite=Lax`
  window.location.reload()
}

export function LanguageSwitcher({ compact }: { compact?: boolean }) {
  const currentLocale = useLocale() as Locale

  if (compact) {
    return (
      <select
        value={currentLocale}
        onChange={(e) => setLocaleCookie(e.target.value as Locale)}
        className="h-7 pl-1.5 pr-5 rounded-md bg-secondary border border-border text-xs text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 4px center' }}
        aria-label="Language"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeNames[loc]}
          </option>
        ))}
      </select>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <select
        value={currentLocale}
        onChange={(e) => setLocaleCookie(e.target.value as Locale)}
        className="h-9 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-smooth"
        aria-label="Language"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {localeNames[loc]}
          </option>
        ))}
      </select>
    </div>
  )
}
