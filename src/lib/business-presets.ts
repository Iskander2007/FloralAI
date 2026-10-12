import type { BusinessProfile } from "./business";

export const businessTemplates = [
    { id: "shop", icon: "🌷", title: "Цветочный магазин", detail: "Букеты на каждый день и в подарок", description: "Цветочный магазин. Помогаем выбрать букет для близких, праздника или особого случая.", services: ["Сборка букета по пожеланиям", "Подарочная упаковка"] },
    { id: "studio", icon: "💐", title: "Флористическая студия", detail: "Авторские букеты и композиции", description: "Флористическая студия. Создаём авторские букеты и цветочные композиции с учётом повода и пожеланий клиента.", services: ["Авторские букеты", "Цветочные композиции", "Сборка букета по пожеланиям"] },
    { id: "online", icon: "🎁", title: "Цветы онлайн", detail: "Выбор и оформление в переписке", description: "Онлайн-магазин цветов. Помогаем выбрать букет из каталога и оформить заявку в переписке.", services: ["Помощь с выбором букета", "Открытка с пожеланием"] },
] as const;

export const serviceOptions = ["Сборка букета по пожеланиям", "Подарочная упаковка", "Открытка с пожеланием", "Фото букета перед отправкой", "Авторские букеты", "Цветочные композиции", "Помощь с выбором букета", "Букеты для свадеб"];
export const hoursOptions = ["Ежедневно 09:00–21:00", "Ежедневно 10:00–22:00", "Пн–Сб 09:00–20:00", "Круглосуточно"];
export const deliveryAreaOptions = ["По городу", "По городу и в пригород", "В пределах района"];
export const policyOptions = ["Наличие цветов подтверждает флорист", "Замены цветов согласуем с клиентом", "Время доставки согласуем после заявки", "Перед отправкой согласуем фото букета"];

// A template changes only the description and selected services, never contact or delivery details.
export function applyBusinessTemplate(profile: BusinessProfile, id: string): BusinessProfile {
    const template = businessTemplates.find((item) => item.id === id);
    if (!template) return profile;
    return { ...profile, category: "Retail & online shop", description: template.description, services: [...template.services] };
}

export function toggleBusinessOption(options: string[], value: string): string[] {
    return options.includes(value) ? options.filter((item) => item !== value) : [...options, value];
}
