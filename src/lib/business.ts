export type BusinessCategory =
    | "Beauty & wellness"
    | "Food & hospitality"
    | "Health & clinics"
    | "Retail & online shop"
    | "Auto & home services"
    | "Other";

export type BusinessProfile = {
    name: string;
    category: BusinessCategory;
    description: string;
    location: string;
    hours: string;
    phone: string;
    language: "English" | "Russian" | "Kazakh";
    tone: "Friendly" | "Professional" | "Premium" | "Casual";
    services: string[];
    deliveryAreas?: string;
    deliveryFeeKzt?: number | null;
    orderPolicy?: string;
    acceptOrdersOffline?: boolean;
};

export const businessCategories: BusinessCategory[] = [
    "Beauty & wellness", "Food & hospitality", "Health & clinics",
    "Retail & online shop", "Auto & home services", "Other",
];

export function parseBusinessProfile(value: unknown): BusinessProfile | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const limits: Record<string, number> = {
        name: 120, description: 8000, location: 300, hours: 300, phone: 40,
        deliveryAreas: 1000, orderPolicy: 3000,
    };
    const strings: Record<string, string> = {};
    for (const [field, limit] of Object.entries(limits)) {
        const input = source[field] ?? "";
        if (typeof input !== "string" || input.length > limit) return null;
        strings[field] = input.trim();
    }
    if (!strings.name || !businessCategories.includes(source.category as BusinessCategory)) return null;
    if (typeof source.language !== "string" || !["English", "Russian", "Kazakh"].includes(source.language)) return null;
    if (typeof source.tone !== "string" || !["Friendly", "Professional", "Premium", "Casual"].includes(source.tone)) return null;
    if (!Array.isArray(source.services) || source.services.length > 30 || !source.services.every((service) => typeof service === "string" && service.length <= 500)) return null;
    const deliveryFeeKzt = source.deliveryFeeKzt ?? null;
    if (deliveryFeeKzt !== null && (!Number.isSafeInteger(deliveryFeeKzt) || Number(deliveryFeeKzt) < 0 || Number(deliveryFeeKzt) > 10_000_000)) return null;
    if (source.acceptOrdersOffline !== undefined && typeof source.acceptOrdersOffline !== "boolean") return null;
    return {
        ...strings,
        name: strings.name,
        category: source.category as BusinessCategory,
        description: strings.description,
        location: strings.location,
        hours: strings.hours,
        phone: strings.phone,
        language: source.language as BusinessProfile["language"],
        tone: source.tone as BusinessProfile["tone"],
        services: source.services.map((service: string) => service.trim()).filter(Boolean),
        deliveryFeeKzt: deliveryFeeKzt as number | null,
        acceptOrdersOffline: source.acceptOrdersOffline === true,
    };
}
