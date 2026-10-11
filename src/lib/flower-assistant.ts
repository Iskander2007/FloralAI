export const flowerCatalog = [
    {
        id: "spring",
        name: "Весенний букет",
        description: "Микс сезонных цветов в спокойной палитре",
        priceKzt: 12_000,
    },
    {
        id: "roses",
        name: "Букет из 15 роз",
        description: "Классические розы с оформлением",
        priceKzt: 18_000,
    },
    {
        id: "premium",
        name: "Авторский букет",
        description: "Сборная композиция с открыткой",
        priceKzt: 25_000,
    },
] as const;

export type FlowerProductId = (typeof flowerCatalog)[number]["id"];
export type FlowerPaymentMethod = "cash_on_delivery" | "bank_transfer";
export type FlowerFlowStep =
    | "occasion"
    | "bouquet"
    | "budget"
    | "delivery"
    | "customer"
    | "phone"
    | "address"
    | "payment"
    | "confirm"
    | "complete";

export type FlowerOrderDraft = {
    occasion: string;
    productId: FlowerProductId | "";
    budgetKzt: number | null;
    deliveryDate: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    paymentMethod: FlowerPaymentMethod | "";
};

export const emptyFlowerOrder: FlowerOrderDraft = {
    occasion: "",
    productId: "",
    budgetKzt: null,
    deliveryDate: "",
    customerName: "",
    customerPhone: "",
    deliveryAddress: "",
    paymentMethod: "",
};

export function formatKzt(amount: number) {
    return `${new Intl.NumberFormat("ru-RU").format(amount)} ₸`;
}

export function flowerOrderSummary(draft: FlowerOrderDraft) {
    const product = flowerCatalog.find((item) => item.id === draft.productId);
    if (!product || !draft.paymentMethod) return "";

    const payment =
        draft.paymentMethod === "cash_on_delivery"
            ? "наличными при получении"
            : "переводом после подтверждения заказа магазином";

    return [
        `Повод: ${draft.occasion}`,
        `Букет: ${product.name} — ${formatKzt(product.priceKzt)}`,
        `Доставка: ${draft.deliveryDate}`,
        `Получатель: ${draft.customerName}`,
        `Телефон: ${draft.customerPhone}`,
        `Адрес: ${draft.deliveryAddress}`,
        `Оплата: ${payment}`,
    ].join("\n");
}

export function answerFlowerQuestion(message: string) {
    const text = message.toLocaleLowerCase("ru-RU");
    if (/цен|стоим|сколько|прайс/.test(text)) {
        return `Цены в демонстрационном каталоге:\n${flowerCatalog
            .map((item) => `• ${item.name} — ${formatKzt(item.priceKzt)}`)
            .join("\n")}\n\nЭто примерные цены для демо, наличие и итоговую стоимость подтвердит магазин.`;
    }
    if (/налич|есть ли|свеж|ассортимент/.test(text)) {
        return "Каталог показывает примеры букетов, но актуальное наличие цветов я проверить не могу. Магазин подтвердит состав и наличие перед оформлением.";
    }
    if (/достав|привез|курьер/.test(text)) {
        return "Дату и адрес доставки я передам магазину вместе с заказом. Стоимость и возможность доставки магазин должен подтвердить отдельно.";
    }
    if (/оплат|карт|перевод|налич/.test(text)) {
        return "В демо доступны наличные при получении или перевод после подтверждения магазином. Онлайн-оплата картой не подключена.";
    }
    return null;
}

export function parseFlowerBudget(message: string) {
    if (/не важно|любой|любая|без огранич|не принципиально/i.test(message)) return null;
    const amount = message.replace(/\s/g, "").match(/\d[\d.,]*/)?.[0];
    if (!amount) return undefined;
    const multiplier = /тыс|тысяч|\bk\b/i.test(message) ? 1_000 : 1;
    const value = Number(amount.replace(/[.,]/g, "")) * multiplier;
    return Number.isSafeInteger(value) && value > 0 && value <= 10_000_000
        ? value
        : undefined;
}

export function findFlowerProduct(message: string) {
    const text = message.toLocaleLowerCase("ru-RU");
    const byName = flowerCatalog.find((product) =>
        text.includes(product.name.toLocaleLowerCase("ru-RU")),
    );
    if (byName) return byName;
    const index = Number(text.match(/^\s*(\d)\s*$/)?.[1]);
    return Number.isInteger(index) ? flowerCatalog[index - 1] : undefined;
}

export function validFlowerPhone(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
}

export function isFlowerConfirmation(value: string) {
    return /^(да|подтверждаю|верно|оформить|заказать|yes|confirm)$/i.test(value.trim());
}
