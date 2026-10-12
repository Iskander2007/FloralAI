"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { defaultLocale, isLocale, Locale, translate } from "@/lib/i18n";

type LanguageContextValue = {
    locale: Locale;
    setLocale: (locale: Locale) => void;
    t: (english: string) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);
const localeStorageKey = "floralai:locale:v2";
const localeChangeEvent = "floralai:localechange";

export function LanguageProvider({ children }: { children: ReactNode }) {
    const pathname = usePathname();
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
        return isLocale(stored) ? stored : defaultLocale;
    }, []);
    const getServerLocaleSnapshot = useCallback((): Locale => defaultLocale, []);
    const locale = useSyncExternalStore(
        subscribe,
        getLocaleSnapshot,
        getServerLocaleSnapshot,
    );

    useEffect(() => {
        document.documentElement.lang = locale;
        const title =
            pathname === "/login"
                ? "Log in to FloralAI"
                : pathname === "/signup"
                  ? "Create your FloralAI account"
                  : "FloralAI | Thoughtful conversations, beautifully handled";
        const timer = window.setTimeout(() => {
            document.title = translate(locale, title);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [locale, pathname]);

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
