"use client";

import { Moon, Sun } from "lucide-react";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { useTheme } from "@/components/theme-provider";

export function AppearanceControls() {
    const { theme, setTheme } = useTheme();
    const { t } = useLanguage();
    const label = t(theme === "dark" ? "Switch to light theme" : "Switch to dark theme");
    return (
        <div className="appearance-controls">
            <button
                className="theme-toggle"
                type="button"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                aria-label={label}
                title={label}
            >
                <Sun className="theme-icon-light" size={18} aria-hidden="true" />
                <Moon className="theme-icon-dark" size={18} aria-hidden="true" />
                <span className="theme-toggle-label">{t("Theme")}</span>
            </button>
            <LanguageSwitcher />
        </div>
    );
}
