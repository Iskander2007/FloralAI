export const annualDiscount = 0.2;
export const trialDays = 7;

export const plans = {
    free: {
        name: "Free trial",
        monthlyPriceKzt: 0,
        messageLimit: 100,
        assistantLimit: 1,
        features: ["All available FloralAI features", "Catalog with photos and prices", "Telegram assistant", "Order management"],
    },
    starter: {
        name: "Starter",
        monthlyPriceKzt: 9_950,
        messageLimit: 2_000,
        assistantLimit: 1,
        features: ["Business knowledge base", "Catalog with photos and prices", "Telegram assistant", "Order management"],
    },
    business: {
        name: "Business",
        monthlyPriceKzt: 24_950,
        messageLimit: 10_000,
        assistantLimit: 5,
        features: ["Business knowledge base", "Catalog with photos and prices", "Telegram assistant", "Order management"],
    },
} as const;
