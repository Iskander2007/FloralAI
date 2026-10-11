export const annualDiscount = 0.2;

export const plans = {
    free: {
        name: "Free",
        monthlyPriceKzt: 0,
        messageLimit: 100,
        assistantLimit: 1,
        features: ["Basic business knowledge", "Essential analytics"],
    },
    starter: {
        name: "Starter",
        monthlyPriceKzt: 19_900,
        messageLimit: 2_000,
        assistantLimit: 1,
        features: ["Lead capture & appointments", "Business knowledge base", "Multiple languages", "Conversation analytics"],
    },
    business: {
        name: "Business",
        monthlyPriceKzt: 49_900,
        messageLimit: 10_000,
        assistantLimit: 5,
        features: ["Multiple assistants", "Advanced analytics", "Team access & integrations", "Priority support"],
    },
} as const;
