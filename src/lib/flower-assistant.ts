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
export type FlowerLocale = "en" | "ru" | "kk";
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

const flowerCopy: Record<string, Record<FlowerLocale, string>> = {
    welcome: {
        en: "Hello! I can help you choose a bouquet and place an order. What is the occasion?",
        ru: "Здравствуйте! Я помогу выбрать букет и оформить заявку. Сначала расскажите, по какому поводу нужны цветы?",
        kk: "Сәлеметсіз бе! Гүл шоғын таңдап, тапсырыс беруге көмектесемін. Гүлдер қандай жағдайға қажет?",
    },
    "price-answer": {
        en: "Prices in the sample catalog:",
        ru: "Цены в демонстрационном каталоге:",
        kk: "Демо каталогтағы бағалар:",
    },
    "sample-price-disclaimer": {
        en: "These are sample prices. The shop will confirm availability and the final price.",
        ru: "Это примерные цены для демо, наличие и итоговую стоимость подтвердит магазин.",
        kk: "Бұл демо бағалары. Дүкен тауардың бар-жоғын және соңғы бағасын растайды.",
    },
    "stock-answer": {
        en: "The catalog shows sample bouquets. I can't check live stock; the shop will confirm the flowers and availability before the order is placed.",
        ru: "Каталог показывает примеры букетов, но актуальное наличие цветов я проверить не могу. Магазин подтвердит состав и наличие перед оформлением.",
        kk: "Каталогта үлгі гүл шоқтары көрсетілген. Нақты қорды тексере алмаймын; дүкен тапсырыс алдында гүлдердің құрамы мен бар-жоғын растайды.",
    },
    "delivery-answer": {
        en: "I'll pass your requested delivery date and address to the shop. The shop must confirm delivery availability and cost.",
        ru: "Дату и адрес доставки я передам магазину вместе с заказом. Стоимость и возможность доставки магазин должен подтвердить отдельно.",
        kk: "Жеткізу күні мен мекенжайын дүкенге жіберемін. Жеткізу мүмкіндігі мен құнын дүкен растауы керек.",
    },
    "payment-answer": {
        en: "This demo supports cash on delivery or a bank transfer after the shop confirms the order. Online card payments are not connected.",
        ru: "В демо доступны наличные при получении или перевод после подтверждения магазином. Онлайн-оплата картой не подключена.",
        kk: "Демода алған кезде қолма-қол төлеу немесе дүкен растағаннан кейін аудару қолжетімді. Онлайн карта төлемі қосылмаған.",
    },
    "occasion-prompt": {
        en: "What is the occasion for the flowers?",
        ru: "Расскажите, по какому поводу выбираете цветы.",
        kk: "Гүлді қандай жағдайға таңдап жатырсыз?",
    },
    "choose-bouquet": {
        en: "Choose a bouquet:",
        ru: "Выберите букет:",
        kk: "Гүл шоғын таңдаңыз:",
    },
    "enter-bouquet": {
        en: "Enter the bouquet name or number.",
        ru: "Напишите название или номер.",
        kk: "Гүл шоғының атауын немесе нөмірін жазыңыз.",
    },
    "unknown-bouquet": {
        en: "I couldn't find that option. Enter a bouquet name or its number from the list.",
        ru: "Не нашла такой вариант. Напишите название букета или его номер из списка.",
        kk: "Мұндай нұсқаны таппадым. Гүл шоғының атауын немесе тізімдегі нөмірін жазыңыз.",
    },
    "ask-budget": {
        en: "What is your budget? You can say “no limit”.",
        ru: "Какой у вас бюджет? Можно написать «без ограничений».",
        kk: "Бюджетіңіз қанша? «Шектеусіз» деп жаза аласыз.",
    },
    "budget-prompt": {
        en: "Enter your budget in tenge or say that there is no limit.",
        ru: "Напишите бюджет числом в тенге или укажите, что ограничений нет.",
        kk: "Бюджетті теңгемен жазыңыз немесе шектеу жоқ екенін көрсетіңіз.",
    },
    "restart-bouquet": {
        en: "Let's choose a bouquet again. Type “start” to continue.",
        ru: "Давайте заново выберем букет. Напишите «начать», чтобы продолжить.",
        kk: "Гүл шоғын қайта таңдайық. Жалғастыру үшін «бастау» деп жазыңыз.",
    },
    "budget-too-low": {
        en: "You entered {amount}, but the selected bouquet costs {price}. Choose a less expensive bouquet or enter a different budget.",
        ru: "Вы указали {amount}, а выбранный букет стоит {price}. Выберите вариант дешевле или укажите другой бюджет.",
        kk: "Сіз {amount} деп көрсеттіңіз, ал таңдалған гүл шоғы {price} тұрады. Арзанырақ гүл шоғын таңдаңыз немесе басқа бюджет жазыңыз.",
    },
    "delivery-date": {
        en: "What date do you need delivery? Enter a date or preferred time; the shop will confirm availability.",
        ru: "На какую дату нужна доставка? Напишите дату или удобное время, магазин подтвердит возможность.",
        kk: "Жеткізу қай күнге қажет? Күнді немесе ыңғайлы уақытты жазыңыз, дүкен мүмкіндігін растайды.",
    },
    "delivery-date-required": {
        en: "Enter your preferred delivery date or time.",
        ru: "Укажите желаемую дату или время доставки.",
        kk: "Қалаған жеткізу күніңізді немесе уақытыңызды жазыңыз.",
    },
    "recipient-name": {
        en: "What is the recipient's name?",
        ru: "Как зовут получателя заказа?",
        kk: "Тапсырысты алушының аты кім?",
    },
    "recipient-name-required": {
        en: "Please enter the recipient's name.",
        ru: "Укажите, пожалуйста, имя получателя.",
        kk: "Алушының атын жазыңыз.",
    },
    "phone-prompt": {
        en: "Enter a phone number so the shop can confirm the order.",
        ru: "Оставьте номер телефона для подтверждения заказа.",
        kk: "Тапсырысты растау үшін телефон нөмірін жазыңыз.",
    },
    "phone-invalid": {
        en: "Check the phone number. It must contain 10 to 15 digits and may start with “+”.",
        ru: "Проверьте номер телефона: нужно от 10 до 15 цифр, можно с «+».",
        kk: "Телефон нөмірін тексеріңіз: 10–15 сан болуы керек, «+» белгісімен басталуы мүмкін.",
    },
    "address-prompt": {
        en: "Enter the delivery address and any note for the courier.",
        ru: "Укажите адрес доставки и, если нужно, комментарий для курьера.",
        kk: "Жеткізу мекенжайын және курьерге арналған ескертпені жазыңыз.",
    },
    "address-required": {
        en: "Enter the full delivery address.",
        ru: "Укажите полный адрес доставки.",
        kk: "Толық жеткізу мекенжайын жазыңыз.",
    },
    "payment-options": {
        en: "How would you like to pay?\n1. Cash on delivery\n2. Bank transfer after shop confirmation\n\nOnline card payments are not connected.",
        ru: "Как удобнее оплатить?\n1. Наличными при получении\n2. Переводом после подтверждения магазином\n\nОнлайн-оплата картой пока не подключена.",
        kk: "Қалай төлеген ыңғайлы?\n1. Алған кезде қолма-қол\n2. Дүкен растағаннан кейін аудару\n\nОнлайн карта төлемі қосылмаған.",
    },
    "payment-required": {
        en: "Choose 1 for cash on delivery or 2 for a bank transfer after confirmation.",
        ru: "Выберите 1 — наличными при получении или 2 — переводом после подтверждения.",
        kk: "1 — алған кезде қолма-қол немесе 2 — растаудан кейін аудару нұсқасын таңдаңыз.",
    },
    "order-review": {
        en: "Review your order:",
        ru: "Проверьте заказ:",
        kk: "Тапсырысты тексеріңіз:",
    },
    "confirm-order": {
        en: "To place the order, type “Confirm”. To start over, type “Start”.",
        ru: "Чтобы оформить, напишите «Подтверждаю». Чтобы начать заново — «Начать».",
        kk: "Тапсырысты рәсімдеу үшін «Растаймын» деп жазыңыз. Қайта бастау үшін «Бастау» деп жазыңыз.",
    },
    "start-over": {
        en: "Okay, let's start over. What is the occasion for the flowers?",
        ru: "Хорошо, начнём заново. По какому поводу выбираете цветы?",
        kk: "Жақсы, қайта бастайық. Гүлдер қандай жағдайға қажет?",
    },
    "not-confirmed": {
        en: "Your order has not been placed yet. Type “Confirm” or “Start” for a new order.",
        ru: "Заказ ещё не оформлен. Напишите «Подтверждаю» (или “confirm”) либо «Начать» для нового заказа.",
        kk: "Тапсырыс әлі рәсімделген жоқ. «Растаймын» немесе жаңа тапсырыс үшін «Бастау» деп жазыңыз.",
    },
    "incomplete-order": {
        en: "Some order details are missing. Please start again.",
        ru: "В заказе не хватает данных. Начните оформление заново.",
        kk: "Тапсырыс деректері толық емес. Қайта бастаңыз.",
    },
    "already-placed": {
        en: "This order has already been placed. Select “New order” to start again.",
        ru: "Этот заказ уже оформлен. Нажмите «Новый заказ», чтобы начать сначала.",
        kk: "Бұл тапсырыс рәсімделді. Қайта бастау үшін «Жаңа тапсырыс» түймесін басыңыз.",
    },
    "bouquet-unavailable": {
        en: "The selected bouquet is no longer available.",
        ru: "Выбранный букет больше недоступен.",
        kk: "Таңдалған гүл шоғы енді қолжетімсіз.",
    },
    "save-order-failed": {
        en: "Could not save the order. Check the database connection and try again.",
        ru: "Не удалось сохранить заказ. Проверьте подключение базы данных и попробуйте ещё раз.",
        kk: "Тапсырысты сақтау мүмкін болмады. Дерекқор байланысын тексеріп, қайталап көріңіз.",
    },
    "order-saved": {
        en: "Order saved. Reference: {id}. The shop will contact you to confirm availability, delivery and payment.",
        ru: "Заказ сохранён. Номер: {id}. Магазин свяжется с вами для подтверждения наличия, доставки и оплаты.",
        kk: "Тапсырыс сақталды. Нөмірі: {id}. Дүкен тауарды, жеткізуді және төлемді растау үшін хабарласады.",
    },
    "order-already-saved": {
        en: "This order is already saved. Reference: {id}.",
        ru: "Заказ уже сохранён. Номер: {id}.",
        kk: "Бұл тапсырыс сақталған. Нөмірі: {id}.",
    },
};

const localizedProductNames: Record<string, Record<FlowerLocale, string>> = {
    spring: { en: "Spring bouquet", ru: "Весенний букет", kk: "Көктемгі гүл шоғы" },
    roses: { en: "15 roses", ru: "Букет из 15 роз", kk: "15 раушаннан жасалған гүл шоғы" },
    premium: { en: "Signature bouquet", ru: "Авторский букет", kk: "Авторлық гүл шоғы" },
};
const localizedDescriptions: Record<string, Record<FlowerLocale, string>> = {
    spring: {
        en: "Seasonal flowers in a calm palette",
        ru: "Микс сезонных цветов в спокойной палитре",
        kk: "Байсалды түстердегі маусымдық гүлдер",
    },
    roses: {
        en: "Classic roses with wrapping",
        ru: "Классические розы с оформлением",
        kk: "Әсем безендірілген классикалық раушандар",
    },
    premium: {
        en: "A mixed arrangement with a greeting card",
        ru: "Сборная композиция с открыткой",
        kk: "Ашық хатпен бірге құрастырылған гүл композициясы",
    },
};

export function flowerText(locale: FlowerLocale, key: string, values?: Record<string, string>) {
    let text = flowerCopy[key]?.[locale] ?? flowerCopy[key]?.ru ?? key;
    for (const [name, value] of Object.entries(values ?? {})) {
        text = text.replace(`{${name}}`, value);
    }
    return text;
}

export function flowerProductName(id: string, locale: FlowerLocale) {
    return localizedProductNames[id]?.[locale] ?? id;
}

export function flowerProductDescription(id: string, locale: FlowerLocale) {
    return localizedDescriptions[id]?.[locale] ?? "";
}

export function formatKzt(amount: number, locale: FlowerLocale = "ru") {
    const language = locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";
    return `${new Intl.NumberFormat(language).format(amount)} ₸`;
}

export function flowerOrderSummary(draft: FlowerOrderDraft, locale: FlowerLocale = "ru") {
    const product = flowerCatalog.find((item) => item.id === draft.productId);
    if (!product || !draft.paymentMethod) return "";

    const payment =
        draft.paymentMethod === "cash_on_delivery"
            ? locale === "en" ? "Cash on delivery" : locale === "kk" ? "Алған кезде қолма-қол" : "Наличными при получении"
            : locale === "en" ? "Bank transfer after shop confirmation" : locale === "kk" ? "Дүкен растағаннан кейін аудару" : "Переводом после подтверждения заказа магазином";

    return [
        `${locale === "en" ? "Occasion" : locale === "kk" ? "Себебі" : "Повод"}: ${draft.occasion}`,
        `${locale === "en" ? "Bouquet" : locale === "kk" ? "Гүл шоғы" : "Букет"}: ${flowerProductName(product.id, locale)} — ${formatKzt(product.priceKzt, locale)}`,
        `${locale === "en" ? "Delivery" : locale === "kk" ? "Жеткізу" : "Доставка"}: ${draft.deliveryDate}`,
        `${locale === "en" ? "Recipient" : locale === "kk" ? "Алушы" : "Получатель"}: ${draft.customerName}`,
        `${locale === "en" ? "Phone" : locale === "kk" ? "Телефон" : "Телефон"}: ${draft.customerPhone}`,
        `${locale === "en" ? "Address" : locale === "kk" ? "Мекенжай" : "Адрес"}: ${draft.deliveryAddress}`,
        `${locale === "en" ? "Payment" : locale === "kk" ? "Төлем" : "Оплата"}: ${payment}`,
    ].join("\n");
}

export function answerFlowerQuestion(message: string, locale: FlowerLocale = "ru") {
    const text = message.toLocaleLowerCase("ru-RU");
    if (/цен|стоим|сколько|прайс|price|cost|how much|баға|қанша/.test(text)) {
        return `${flowerText(locale, "price-answer")}\n${flowerCatalog
            .map((item) => `• ${flowerProductName(item.id, locale)} — ${formatKzt(item.priceKzt, locale)}`)
            .join("\n")}\n\n${flowerText(locale, "sample-price-disclaimer")}`;
    }
    if (/налич|есть ли|свеж|ассортимент|available|in stock|fresh|бар ма|қолда бар/.test(text)) {
        return flowerText(locale, "stock-answer");
    }
    if (/достав|привез|курьер|deliver|shipping|жеткіз/.test(text)) {
        return flowerText(locale, "delivery-answer");
    }
    if (/оплат|карт|перевод|налич|pay|card|cash|төлем|карта/.test(text)) {
        return flowerText(locale, "payment-answer");
    }
    return null;
}

export function parseFlowerBudget(message: string) {
    if (/не важно|любой|любая|без огранич|не принципиально|no limit|any budget|шектеусіз|маңызды емес/i.test(message)) return null;
    const amount = message.replace(/\s/g, "").match(/\d[\d.,]*/)?.[0];
    if (!amount) return undefined;
    const multiplier = /тыс|тысяч|\bk\b|thousand|мың/i.test(message) ? 1_000 : 1;
    const value = Number(amount.replace(/[.,]/g, "")) * multiplier;
    return Number.isSafeInteger(value) && value > 0 && value <= 10_000_000
        ? value
        : undefined;
}

export function findFlowerProduct(message: string, locale: FlowerLocale = "ru") {
    const text = message.toLocaleLowerCase(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU");
    const byName = flowerCatalog.find((product) =>
        text.includes(product.name.toLocaleLowerCase("ru-RU")) ||
        text.includes(flowerProductName(product.id, locale).toLocaleLowerCase(locale === "kk" ? "kk-KZ" : locale === "en" ? "en-US" : "ru-RU")),
    );
    if (byName) return byName;
    const aliases: Record<string, string[]> = {
        spring: ["spring", "seasonal", "көктем", "маусымдық"],
        roses: ["rose", "roses", "раушан"],
        premium: ["signature", "premium", "авторлық"],
    };
    const byAlias = flowerCatalog.find((product) =>
        aliases[product.id].some((alias) => text.includes(alias)),
    );
    if (byAlias) return byAlias;
    const index = Number(text.match(/^\s*(\d)\s*$/)?.[1]);
    return Number.isInteger(index) ? flowerCatalog[index - 1] : undefined;
}

export function validFlowerPhone(value: string) {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15;
}

export function isFlowerConfirmation(value: string) {
    return /^(да|подтверждаю|верно|оформить|заказать|yes|confirm|confirmed|иә|растаймын|растау)$/i.test(value.trim());
}
