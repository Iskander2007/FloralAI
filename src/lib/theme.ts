export type Theme = "light" | "dark";
export const themeStorageKey = "floralai:theme:v1";
export const themeChangeEvent = "floralai:themechange";

export function isTheme(value: unknown): value is Theme {
    return value === "light" || value === "dark";
}

// Runs in the document head before the page paints, including on direct visits.
// Storage can be unavailable in private browsing; the system preference still works.
export const themeInitScript = `(() => {
    let saved;
    try { saved = localStorage.getItem(${JSON.stringify(themeStorageKey)}); } catch {}
    const theme = saved === 'light' || saved === 'dark' ? saved
        : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
})();`;
