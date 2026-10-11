"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { isLocale, Locale, translate } from "@/lib/i18n";

type LanguageContextValue = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (english: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const localeStorageKey = "floralai:locale";
const localeChangeEvent = "floralai:localechange";

function getBrowserLocale(): Locale {
    const language = navigator.language.toLowerCase();
    if (language.startsWith("ru")) return "ru";
    if (language.startsWith("kk")) return "kk";
    return "en";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
    const subscribe = useCallback((onChange: () => void) => {
        window.addEventListener("storage", onChange);
        window.addEventListener(localeChangeEvent, onChange);
        return () => {
            window.removeEventListener("storage", onChange);
            window.removeEventListener(localeChangeEvent, onChange);
        };
    }, []);
    const getLocaleSnapshot = useCallback(() => {
        const stored = window.localStorage.getItem(localeStorageKey);
        return isLocale(stored) ? stored : getBrowserLocale();
    }, []);
    const getServerLocaleSnapshot = useCallback((): Locale => "en", []);
    const locale = useSyncExternalStore(
        subscribe,
        getLocaleSnapshot,
        getServerLocaleSnapshot,
    );

    useEffect(() => {
        document.documentElement.lang = locale;
    }, [locale]);

    const value = useMemo<LanguageContextValue>(
        () => ({
            locale,
            setLocale: (nextLocale) => {
                window.localStorage.setItem(localeStorageKey, nextLocale);
                window.dispatchEvent(new Event(localeChangeEvent));
            },
            t: (english) => translate(locale, english),
        }),
        [locale],
    );

    return (
        <LanguageContext.Provider value={value}>
            {children}
        </LanguageContext.Provider>
    );
}

export function useLanguage() {
    const context = useContext(LanguageContext);
    if (!context) {
        throw new Error("useLanguage must be used within LanguageProvider.");
    }
    return context;
}
