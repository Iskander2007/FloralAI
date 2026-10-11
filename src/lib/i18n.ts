export const supportedLocales = ["en", "ru", "kk"] as const;
export type Locale = (typeof supportedLocales)[number];
type MessageKey =
    | "product"
    | "solutions"
    | "howItWorks"
    | "pricing"
    | "faq"
    | "tryFree"
    | "assistantReady";

export const messages: Record<Locale, Record<MessageKey, string>> = {
    en: {
        product: "Product",
        solutions: "Solutions",
        howItWorks: "How it works",
        pricing: "Pricing",
        faq: "FAQ",
        tryFree: "Try for free",
        assistantReady: "Your AI assistant is ready to talk to customers.",
    },
    ru: {
        product: "Продукт",
        solutions: "Для бизнеса",
        howItWorks: "Как это работает",
        pricing: "Тарифы",
        faq: "Вопросы",
        tryFree: "Попробовать бесплатно",
        assistantReady: "Ваш AI-ассистент готов общаться с клиентами.",
    },
    kk: {
        product: "Өнім",
        solutions: "Бизнеске арналған",
        howItWorks: "Қалай жұмыс істейді",
        pricing: "Тарифтер",
        faq: "Сұрақтар",
        tryFree: "Тегін қолданып көру",
        assistantReady: "AI-көмекшіңіз клиенттермен сөйлесуге дайын.",
    },
};
