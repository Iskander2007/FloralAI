"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { isTheme, type Theme, themeChangeEvent, themeStorageKey } from "@/lib/theme";

const ThemeContext = createContext<{ theme: Theme; setTheme: (theme: Theme) => void } | null>(null);
let sessionPreference: Theme | undefined;

function savedPreference() {
    try {
        const stored = window.localStorage.getItem(themeStorageKey);
        return isTheme(stored) ? stored : sessionPreference;
    } catch {
        return sessionPreference;
    }
}

function applyTheme(theme: Theme) {
    document.documentElement.dataset.theme = theme;
    window.dispatchEvent(new Event(themeChangeEvent));
}

function subscribe(onChange: () => void) {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const systemTheme = () => {
        if (!savedPreference()) applyTheme(media.matches ? "dark" : "light");
    };
    const storageChanged = (event: StorageEvent) => {
        if (event.key !== themeStorageKey && event.key !== null) return;
        sessionPreference = undefined;
        applyTheme(savedPreference() ?? (media.matches ? "dark" : "light"));
    };
    window.addEventListener(themeChangeEvent, onChange);
    window.addEventListener("storage", storageChanged);
    media.addEventListener("change", systemTheme);
    return () => {
        window.removeEventListener(themeChangeEvent, onChange);
        window.removeEventListener("storage", storageChanged);
        media.removeEventListener("change", systemTheme);
    };
}

function getSnapshot(): Theme {
    return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

const getServerSnapshot = (): Theme => "light";

function setTheme(theme: Theme) {
    sessionPreference = theme;
    try { window.localStorage.setItem(themeStorageKey, theme); } catch {}
    applyTheme(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
    return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) throw new Error("useTheme must be used within ThemeProvider.");
    return context;
}
