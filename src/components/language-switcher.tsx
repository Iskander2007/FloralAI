"use client";

import { Globe2 } from "lucide-react";
import { supportedLocales } from "@/lib/i18n";
import { useLanguage } from "@/components/language-provider";

export function LanguageSwitcher() {
    const { locale, setLocale, t } = useLanguage();

    return (
        <label className="language-switcher">
            <Globe2 size={15} aria-hidden="true" />
            <span className="visually-hidden">{t("Choose language")}</span>
            <select
                aria-label={t("Choose language")}
                value={locale}
                onChange={(event) => setLocale(event.target.value as (typeof supportedLocales)[number])}
            >
                {supportedLocales.map((option) => (
                    <option key={option} value={option}>
                        {t(option === "en" ? "English" : option === "ru" ? "Russian" : "Kazakh")}
                    </option>
                ))}
            </select>
        </label>
    );
}
