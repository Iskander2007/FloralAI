import type { BusinessProfile } from "@/lib/business";

export type SalesProduct = {
    id: string;
    name: string;
    price_kzt: number;
    description: string;
};

export type SalesDraft = {
    occasion: string;
    budgetKzt: number | null;
    productId: string;
    customerName: string;
    customerPhone: string;
    deliveryAddress: string;
    deliveryDate: string;
    note: string;
};

export type SalesState = {
    step: "discover" | "budget" | "product" | "name" | "phone" | "address" | "date" | "review" | "submitted";
    draft: SalesDraft;
    orderId: string | null;
    reviewedQuote?: {
        productPriceKzt: number;
        deliveryFeeKzt: number | null;
        totalKzt: number | null;
    };
};

export type SalesTurn = {
    reply: string;
    state: SalesState;
    order?: {
        draft: SalesDraft;
        product: SalesProduct;
        deliveryFeeKzt: number | null;
        totalKzt: number | null;
    };
};

export function emptySalesState(): SalesState {
    return {
        step: "discover",
        draft: {
            occasion: "",
            budgetKzt: null,
            productId: "",
            customerName: "",
            customerPhone: "",
            deliveryAddress: "",
            deliveryDate: "",
            note: "",
        },
        orderId: null,
    };
}

/** Normalize untrusted preview input and stored JSON before using it in a turn. */
export function parseSalesState(value: unknown): SalesState {
    if (!value || typeof value !== "object" || Array.isArray(value)) return emptySalesState();
    const record = value as Record<string, unknown>;
    const steps = new Set<SalesState["step"]>(["discover", "budget", "product", "name", "phone", "address", "date", "review", "submitted"]);
    if (typeof record.step !== "string" || !steps.has(record.step as SalesState["step"]) ||
        !(record.orderId === null || (typeof record.orderId === "string" && record.orderId.length <= 300)) ||
        !record.draft || typeof record.draft !== "object" || Array.isArray(record.draft)) return emptySalesState();
    const rawDraft = record.draft as Record<string, unknown>;
    const draft = emptySalesState().draft;
    const limits = { occasion: 300, productId: 300, customerName: 300, customerPhone: 300, deliveryAddress: 500, deliveryDate: 300, note: 1000 } as const;
    for (const [field, limit] of Object.entries(limits)) {
        const content = rawDraft[field];
        if (typeof content !== "string" || content.length > limit) return emptySalesState();
        draft[field as keyof typeof limits] = content;
    }
    if (rawDraft.budgetKzt !== null && (typeof rawDraft.budgetKzt !== "number" || !Number.isSafeInteger(rawDraft.budgetKzt) || rawDraft.budgetKzt <= 0 || rawDraft.budgetKzt > 10_000_000)) return emptySalesState();
    draft.budgetKzt = rawDraft.budgetKzt as number | null;
    const state: SalesState = { step: record.step as SalesState["step"], draft, orderId: record.orderId as string | null };
    if (record.reviewedQuote !== undefined) {
        if (!record.reviewedQuote || typeof record.reviewedQuote !== "object" || Array.isArray(record.reviewedQuote)) return emptySalesState();
        const rawQuote = record.reviewedQuote as Record<string, unknown>;
        const nonnegative = (number: unknown): number is number => typeof number === "number" && Number.isSafeInteger(number) && number >= 0;
        if (!nonnegative(rawQuote.productPriceKzt) || !(rawQuote.deliveryFeeKzt === null || nonnegative(rawQuote.deliveryFeeKzt)) || !(rawQuote.totalKzt === null || nonnegative(rawQuote.totalKzt))) return emptySalesState();
        if (rawQuote.deliveryFeeKzt === null ? rawQuote.totalKzt !== null : rawQuote.totalKzt !== rawQuote.productPriceKzt + rawQuote.deliveryFeeKzt) return emptySalesState();
        state.reviewedQuote = { productPriceKzt: rawQuote.productPriceKzt, deliveryFeeKzt: rawQuote.deliveryFeeKzt, totalKzt: rawQuote.totalKzt };
    }
    return state;
}

const money = (amount: number) => `${new Intl.NumberFormat("ru-RU").format(amount)} ₸`;
const normalize = (value: string) => value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").trim();
const shorten = (value: string, limit: number) => value.length <= limit ? value : value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/, "").trimEnd() + "…";
const validPhone = (value: string) => /^\+?[\d\s()-]+$/.test(value) && /^\d{10,15}$/.test(value.replace(/\D/g, ""));
const validName = (value: string) => value.length >= 2 && value.length <= 100 && /^[\p{L}][\p{L}\s'’-]*$/u.test(value) && !/^(да|нет|не знаю|ок|хорошо|спасибо|подтверждаю|привет|здравствуйте|отмена)$/i.test(value);
const validAddress = (value: string) => value.length >= 5 && value.length <= 500 && /\p{L}/u.test(value) && !/^(да|нет|не знаю|ок|хорошо|спасибо|подтверждаю|отмена)$/i.test(value);
const validDate = (value: string) => value.length >= 2 && value.length <= 300 && /\d|сегодня|завтра|послезавтра|понедельник|вторник|сред[ау]|четверг|пятниц|суббот|воскресень|утром|вечером|днем|днём/i.test(value);

function deliveryFee(profile: BusinessProfile): number | null {
    return typeof profile.deliveryFeeKzt === "number" && Number.isSafeInteger(profile.deliveryFeeKzt) && profile.deliveryFeeKzt >= 0
        ? profile.deliveryFeeKzt
        : null;
}

function parseBudget(value: string): number | null | undefined {
    const text = normalize(value).replace(/[₸]/g, "").replace(/тенге|kzt/g, "").trim();
    if (/^(?:бюджет\s*[:—-]?\s*)?(?:без ограничений|любой|не важно|неважно|без лимита)$/i.test(text)) return null;
    const match = text.match(/^(?:(?:бюджет|до|около|примерно|не больше|максимум)\s*[:—-]?\s*)?(\d[\d\s]*(?:[.,]\d+)?)\s*(к|k|тыс\.?|тысяч[аи]?)?$/i);
    if (!match) return undefined;
    const number = Number(match[1].replace(/\s/g, "").replace(",", ".")) * (match[2] ? 1000 : 1);
    return Number.isSafeInteger(number) && number > 0 && number <= 10_000_000 ? number : undefined;
}

function findProduct(message: string, products: SalesProduct[], numbered: boolean): SalesProduct | undefined {
    const exact = products.find((product) => normalize(product.id) === normalize(message) || normalize(product.name) === normalize(message));
    if (exact) return exact;
    const text = normalize(message).replace(/^(?:хочу|беру|выбираю|выбрать|мне|букет|вариант|номер|№)\s+/i, "").replace(/[.!]$/, "").trim();
    if (numbered && /^\d{1,3}$/.test(text)) return products[Number(text) - 1];
    return products.find((product) => normalize(product.id) === text || normalize(product.name) === text)
        ?? products.find((product) => normalize(message).match(/^(?:хочу|беру|выбираю|выбрать|мне)\s+/i) && normalize(message).replace(/^(?:хочу|беру|выбираю|выбрать|мне)\s+/i, "").replace(/[.!]$/, "").trim() === normalize(product.name));
}

function catalog(products: SalesProduct[], budget: number | null = null, page = 1) {
    const eligible = products.map((product, index) => ({ product, number: index + 1 }))
        .filter(({ product }) => budget === null || product.price_kzt <= budget);
    if (!eligible.length) {
        const cheapest = products.reduce<SalesProduct | undefined>((best, product) => !best || product.price_kzt < best.price_kzt ? product : best, undefined);
        return cheapest
            ? `В этом бюджете пока нет букетов в каталоге. Самый доступный — «${shorten(cheapest.name, 120)}», ${money(cheapest.price_kzt)}. Можно увеличить бюджет или обсудить другой состав с магазином.`
            : "Магазин пока не добавил букеты в каталог.";
    }
    const pages = Math.ceil(eligible.length / 8);
    if (page < 1 || page > pages) return `В каталоге ${pages} ${pages === 1 ? "страница" : "страниц"}. Начало каталога: /catalog 1.`;
    const items = eligible.slice((page - 1) * 8, page * 8).map(({ product, number }) =>
        `${number}. ${shorten(product.name.replace(/\s+/g, " "), 120)} — ${money(product.price_kzt)}${product.description ? `\n   ${shorten(product.description.replace(/\s+/g, " "), 120)}` : ""}`,
    ).join("\n\n");
    const footer = budget !== null
        ? eligible.length > 8 ? "\n\nБольше вариантов: /catalog. В полном каталоге есть букеты с другим бюджетом." : ""
        : pages > 1 ? `\n\nСтраница ${page} из ${pages}.${page < pages ? ` Ещё букеты: /catalog ${page + 1}.` : " Начало: /catalog 1."}` : "";
    return items + footer;
}

function quote(product: SalesProduct, profile: BusinessProfile) {
    const fee = deliveryFee(profile);
    return { productPriceKzt: product.price_kzt, deliveryFeeKzt: fee, totalKzt: fee === null ? null : product.price_kzt + fee };
}

function review(state: SalesState, product: SalesProduct, profile: BusinessProfile): SalesTurn {
    const currentQuote = quote(product, profile);
    const draft = state.draft;
    const lines = [
        "Проверим детали:",
        `Букет: ${shorten(product.name, 120)} — ${money(product.price_kzt)}`,
        `Повод: ${shorten(draft.occasion, 300)}`,
        `Имя клиента: ${shorten(draft.customerName, 100)}`,
        `Телефон клиента: ${shorten(draft.customerPhone, 300)}`,
        `Адрес: ${shorten(draft.deliveryAddress, 500)}`,
        `Дата и время: ${shorten(draft.deliveryDate, 300)}`,
        draft.note ? `Пожелания: ${shorten(draft.note, 1000)}` : "",
        currentQuote.deliveryFeeKzt === null ? "Стоимость доставки: уточнит магазин." : `Доставка: ${money(currentQuote.deliveryFeeKzt)}`,
        currentQuote.totalKzt === null ? `Букет: ${money(product.price_kzt)}. Итог с доставкой подтвердит магазин.` : `Сумма по каталогу: ${money(currentQuote.totalKzt)}`,
        "Это заявка: наличие, доставку и итоговые условия подтвердит магазин. Оплата через этого бота пока не принимается.",
        profile.orderPolicy?.trim() ? `Условия магазина: ${shorten(profile.orderPolicy.trim(), 500)}${profile.orderPolicy.trim().length > 500 ? "\nПолные правила: напишите «Условия»." : ""}` : "",
        "Если всё верно, напишите «Подтверждаю». Для исправления: «Изменить адрес», «Имя: …» или «Комментарий: …».",
    ];
    return { reply: lines.filter(Boolean).join("\n"), state: { ...state, step: "review", reviewedQuote: currentQuote } };
}

function nextStep(draft: SalesDraft): SalesState["step"] {
    if (!draft.occasion.trim()) return "discover";
    if (!draft.productId) return "product";
    if (!validName(draft.customerName)) return "name";
    if (!validPhone(draft.customerPhone)) return "phone";
    if (!validAddress(draft.deliveryAddress)) return "address";
    if (!validDate(draft.deliveryDate)) return "date";
    return "review";
}

function continueFlow(state: SalesState, profile: BusinessProfile, products: SalesProduct[], prefix = ""): SalesTurn {
    const step = nextStep(state.draft);
    const next = { ...state, step, reviewedQuote: undefined };
    const product = products.find((item) => item.id === state.draft.productId);
    if (step === "review" && product) {
        const result = review(next, product, profile);
        return { ...result, reply: prefix + result.reply };
    }
    const prompts: Partial<Record<SalesState["step"], string>> = {
        discover: "По какому поводу выбираете цветы и кому дарите?",
        product: `${catalog(products, state.draft.budgetKzt)}\n\nКакой букет вам нравится? Напишите название или номер.`,
        name: "Как к вам обращаться?",
        phone: "Укажите ваш телефон для связи и подтверждения заявки, например +7 777 123 45 67.",
        address: `Куда доставить цветы? Напишите город, улицу, дом и квартиру.${profile.deliveryAreas?.trim() ? `\nРайоны доставки: ${profile.deliveryAreas.trim()}.` : ""}\nЕсли цветы получит другой человек, его имя и телефон можно добавить отдельно: «Комментарий: …».`,
        date: "На какую дату и время нужна доставка? Например: «завтра, 14:00–16:00». Магазин подтвердит свободное время.",
    };
    return { reply: prefix + (prompts[step] ?? "Какой букет хотите выбрать?"), state: next };
}

function resumePrompt(state: SalesState) {
    const prompts: Record<SalesState["step"], string> = {
        discover: "По какому поводу выбираете цветы и кому дарите?",
        budget: "На какой бюджет ориентироваться? Можно написать сумму в тенге или «без ограничений».",
        product: "Какой букет вам нравится? Напишите название или номер из каталога.",
        name: "Как к вам обращаться?",
        phone: "Укажите ваш телефон для связи и подтверждения заявки.",
        address: "Напишите адрес доставки: город, улицу, дом и квартиру.",
        date: "На какую дату и время нужна доставка?",
        review: "Если детали заявки верны, напишите «Подтверждаю». Для исправления можно написать «Изменить адрес».",
        submitted: "Если нужна ещё одна заявка, напишите /new.",
    };
    return prompts[state.step];
}

function businessInformation(profile: BusinessProfile, servicesFirst: boolean) {
    // Quote only merchant-approved text; do not infer offers, prices, or promises from it.
    const description = profile.description.trim();
    const services = profile.services.map((service) => service.trim()).filter(Boolean);
    const about = description ? `О магазине «${profile.name}»:\n${shorten(description, 1600)}` : "";
    const offers = services.length ? `Услуги, которые добавил магазин:\n${services.slice(0, 8).map((service) => `• ${shorten(service, 180)}`).join("\n")}${services.length > 8 ? "\nОстальные услуги можно уточнить у магазина." : ""}` : "";
    return (servicesFirst ? [offers, about] : [about, offers]).filter(Boolean).join("\n\n")
        || "Магазин пока не добавил описание и список услуг. Я могу помочь выбрать букет из каталога; остальные возможности уточнит владелец.";
}

function answerQuestion(message: string, profile: BusinessProfile, products: SalesProduct[]): string | null {
    const text = normalize(message);
    if (/оператор|менеджер|владелец|сотрудник|живой человек|позвонить|связаться|человек\??$/.test(text)) {
        return profile.phone?.trim()
            ? `Связаться с магазином можно по телефону ${profile.phone.trim()}. Я могу продолжить оформление здесь.`
            : "Магазин пока не указал контактный телефон. Можем сохранить заявку для владельца.";
    }
    if (/(?:ты|вы).*(?:бот|человек)|кто (?:ты|вы)/.test(text)) return `Я цифровой помощник магазина «${profile.name}». Помогу подобрать цветы и собрать заявку. Наличие и доставку подтвердит магазин.`;
    const asks = /\?|^(?:а\s+)?(?:как|когда|где|сколько|какой|какая|какие|можно|что|кто|почему|зачем|чем|есть ли|есть у вас|а есть|расскажи|расскажите)|работаете|доставляете|оплата|условия|правила|наличие|каталог|цены|график|услуги|описание|^а доставка/.test(text);
    if (!asks) return null;
    if (/час|работ|график|открыт|закрыт/.test(text)) return profile.hours?.trim() ? `График магазина: ${profile.hours.trim()}. Заявку можно оставить здесь.` : "Магазин пока не указал часы работы. Я могу собрать заявку, а время исполнения подтвердит владелец.";
    if (/оплат|перевод|банк|реквизит|карт|деньг/.test(text)) {
        return "Оплата через этого бота пока не принимается. Я могу собрать заявку, а магазин свяжется с вами и уточнит дальнейшие действия. Данные карты в чат присылать не нужно.";
    }
    if (/достав|курьер|привез/.test(text)) {
        const fee = deliveryFee(profile);
        return [
            profile.deliveryAreas?.trim() ? `Доставка: ${profile.deliveryAreas.trim()}.` : "Районы доставки пока не указаны; адрес проверит магазин.",
            fee === null ? "Стоимость доставки уточнит магазин." : `Стоимость доставки: ${money(fee)}.`,
            "Желаемую дату и время запишу в заявку. Возможность доставки подтвердит магазин.",
        ].join("\n");
    }
    if (/услуг|сервис|о (?:вас|вашем магазине|магазине|компании|бизнесе)|про (?:вас|ваш магазин|магазин|компанию|бизнес)|чем (?:вы )?(?:занимаетесь|можете помочь)|что (?:вы )?(?:предлагаете|продаете|умеете)|описани/.test(text)) return businessInformation(profile, /услуг|сервис/.test(text));
    if (/налич|есть ли|а есть|свеж|остал/.test(text)) return "Могу предложить букеты из каталога. Актуальные остатки цветов не подключены, поэтому наличие подтвердит магазин.\n\n" + catalog(products);
    if (/цен|стоим|сколько|каталог|ассортимент|букеты|варианты/.test(text)) return "Вот букеты и цены из каталога магазина:\n\n" + catalog(products);
    if (/адрес|где|находит/.test(text)) return profile.location?.trim() ? `Адрес магазина: ${profile.location.trim()}.` : "Магазин пока не указал адрес.";
    if (/скидк|возврат|отмен|услови|правил/.test(text)) return profile.orderPolicy?.trim() ? `Условия магазина: ${shorten(profile.orderPolicy.trim(), 3000)}` : "Магазин пока не добавил эти условия. Их нужно уточнить у владельца.";
    return "Этого нет в подтверждённой информации магазина. Уточните у владельца" + (profile.phone?.trim() ? ` по телефону ${profile.phone.trim()}` : "") + ". Я могу помочь с выбором букета и заявкой.";
}

type CorrectionField = "occasion" | "budgetKzt" | "productId" | "customerName" | "customerPhone" | "deliveryAddress" | "deliveryDate" | "note";
const correctionFields: { pattern: string; field: CorrectionField; step: SalesState["step"] }[] = [
    { pattern: "(?:имя(?: клиента)?|клиент)", field: "customerName", step: "name" },
    { pattern: "(?:телефон|номер)", field: "customerPhone", step: "phone" },
    { pattern: "адрес", field: "deliveryAddress", step: "address" },
    { pattern: "(?:дату|дата|время)", field: "deliveryDate", step: "date" },
    { pattern: "бюджет", field: "budgetKzt", step: "budget" },
    { pattern: "(?:букет|товар)", field: "productId", step: "product" },
    { pattern: "повод", field: "occasion", step: "discover" },
    { pattern: "(?:комментарий|пожелания|записку)", field: "note", step: "review" },
];

export function runSalesTurn({ message, profile, products: suppliedProducts, state: previous }: {
    message: string;
    profile: BusinessProfile;
    products: SalesProduct[];
    state: SalesState;
}): SalesTurn {
    const messageText = message.trim();
    const text = normalize(messageText);
    const state: SalesState = { ...previous, draft: { ...previous.draft } };
    const products = suppliedProducts.filter((product) => product.id && product.name.trim() && Number.isSafeInteger(product.price_kzt) && product.price_kzt >= 0);
    const welcome = `Здравствуйте! Я помощник магазина «${profile.name}». Помогу подобрать цветы и оформить заявку. По какому поводу выбираете букет?`;

    if (/^\/(?:start|new)(?:@\w+)?(?:\s|$)/i.test(text) || /^(?:начать(?: заново)?|новый заказ)$/i.test(text)) return { reply: welcome, state: emptySalesState() };
    if (/^\/cancel(?:@\w+)?$/i.test(text) || /^(?:отмена|отменить)$/i.test(text)) return state.step === "submitted"
        ? { reply: `Заявка уже сохранена. Для отмены свяжитесь с магазином${profile.phone?.trim() ? `: ${profile.phone.trim()}` : "."}. Я не буду отменять её без подтверждения владельца.`, state }
        : { reply: "Оформление отменено. Данные этого черновика очищены. Для новой заявки напишите /new.", state: emptySalesState() };
    if (!messageText || messageText.length > 1200) return { reply: "Напишите сообщение длиной от 1 до 1200 символов.", state };
    const catalogCommand = text.match(/^\/catalog(?:@\w+)?(?:\s+(\S+))?$/i);
    if (catalogCommand) {
        const page = catalogCommand[1] === undefined ? 1 : Number(catalogCommand[1]);
        if (!Number.isSafeInteger(page) || page < 1) return { reply: "Напишите /catalog или номер страницы, например /catalog 2.\n\n" + resumePrompt(state), state };
        const selection = ["discover", "product"].includes(state.step)
            ? "Для выбора напишите название или номер букета."
            : "Чтобы выбрать или сменить букет, напишите «Букет: название или номер».";
        return { reply: `Каталог «${profile.name}»:\n\n${catalog(products, null, page)}\n\n${selection} Наличие подтвердит магазин.\n\n${resumePrompt(state)}`, state };
    }

    if (state.step === "submitted") {
        if (/^(?:я\s+)?(?:оплатил[аи]?|оплачено|перевел[аи]?|перевод отправлен|деньги отправлены|paid)[.!]?$/i.test(text)) {
            return {
                reply: "Оплата через этого бота пока не принимается. Магазин свяжется с вами, чтобы подтвердить заявку и уточнить дальнейшие действия.",
                state,
            };
        }
        const answer = answerQuestion(messageText, profile, products);
        return { reply: answer ?? `Заявка уже сохранена${state.orderId ? `, номер ${state.orderId.slice(0, 8).toUpperCase()}` : ""}. Для нового заказа напишите /new. Для изменения сохранённой заявки свяжитесь с магазином${profile.phone?.trim() ? `: ${profile.phone.trim()}` : "."}`, state };
    }
    if (/^(привет|здравствуйте|добрый (?:день|вечер|утро)|салем|сәлем)[.!]?$/i.test(text)) {
        return { reply: state.step === "discover" ? welcome : `Здравствуйте! Продолжим оформление заявки.\n\n${resumePrompt(state)}`, state };
    }

    // Explicit field labels and correction commands work from any checkout step.
    for (const correction of correctionFields) {
        const inline = messageText.match(new RegExp(`^(?:изменить\\s+|исправить\\s+|поменять\\s+)?${correction.pattern}\\s*:\\s*(.+)$`, "i"));
        const change = new RegExp(`^(?:изменить|исправить|поменять)\\s+${correction.pattern}[.!]?$`, "i").test(messageText);
        if (!inline && !change) continue;
        if (change) {
            if (correction.field === "note") return { reply: "Напишите «Комментарий: …». Чтобы убрать пожелания: «Комментарий: убрать».", state };
            const changed = { ...state, step: correction.step, reviewedQuote: undefined, draft: { ...state.draft, [correction.field]: correction.field === "budgetKzt" ? null : "" } };
            if (correction.step === "budget") return { reply: "Какой бюджет на букет? Напишите сумму в тенге или «без ограничений».", state: changed };
            return continueFlow(changed, profile, products);
        }
        const value = inline![1].trim();
        if (correction.field === "note") {
            if (value.length > 1000) return { reply: "Сократите комментарий до 1000 символов.", state };
            state.draft.note = /^(убрать|нет|без комментария)$/i.test(value) ? "" : value;
        } else if (correction.field === "budgetKzt") {
            const amount = parseBudget(value);
            if (amount === undefined) return { reply: "Напишите бюджет числом в тенге или «без ограничений».", state };
            state.draft.budgetKzt = amount;
            const selected = products.find((product) => product.id === state.draft.productId);
            if (selected && amount !== null && selected.price_kzt > amount) state.draft.productId = "";
        } else if (correction.field === "productId") {
            const selected = findProduct(value, products, true);
            if (!selected) return { reply: `Не нашла такой букет в каталоге.\n\n${catalog(products)}`, state };
            if (state.draft.budgetKzt !== null && selected.price_kzt > state.draft.budgetKzt) return { reply: `Этот букет стоит ${money(selected.price_kzt)}, это выше бюджета. Выберите другой или измените бюджет.`, state };
            state.draft.productId = selected.id;
        } else {
            const valid = correction.field === "customerName" ? validName(value)
                : correction.field === "customerPhone" ? validPhone(value)
                : correction.field === "deliveryAddress" ? validAddress(value)
                : correction.field === "deliveryDate" ? validDate(value)
                : value.length >= 2 && value.length <= 300;
            if (!valid) return { reply: "Проверьте значение: " + (correction.field === "customerPhone" ? "телефон должен содержать от 10 до 15 цифр." : correction.field === "deliveryDate" ? "укажите дату или день и время доставки." : "данные неполные или слишком длинные."), state };
            state.draft[correction.field] = value;
        }
        return continueFlow(state, profile, products, "Исправила.\n\n");
    }

    // An explicit budget can be changed without confusing a phone or address with money.
    if (/^бюджет\s+/i.test(text)) {
        const amount = parseBudget(messageText);
        if (amount === undefined) return { reply: "Укажите бюджет числом в тенге, например «бюджет 15 000».", state };
        state.draft.budgetKzt = amount;
        const selected = products.find((product) => product.id === state.draft.productId);
        if (selected && amount !== null && selected.price_kzt > amount) state.draft.productId = "";
        return continueFlow(state, profile, products, "Бюджет обновила.\n\n");
    }

    const choosingProduct = ["discover", "budget", "product"].includes(state.step);
    const explicitSelection = /^(?:беру|выбираю)\s+/i.test(messageText);
    const product = choosingProduct || explicitSelection
        ? findProduct(messageText, products, ["discover", "product"].includes(state.step) || explicitSelection)
        : undefined;
    if (product) {
        if (state.draft.budgetKzt !== null && product.price_kzt > state.draft.budgetKzt) return { reply: `«${product.name}» стоит ${money(product.price_kzt)}, это выше бюджета ${money(state.draft.budgetKzt)}. Можно выбрать другой букет или написать «бюджет ${product.price_kzt}».`, state };
        state.draft.productId = product.id;
        return continueFlow(state, profile, products, `Хороший выбор: «${shorten(product.name, 120)}», ${money(product.price_kzt)}.\n\n`);
    }

    const answer = answerQuestion(messageText, profile, products);
    if (answer) return { reply: `${answer}\n\n${resumePrompt(state)}`, state };
    if (!products.length) return { reply: `У магазина пока нет букетов в каталоге.${profile.phone?.trim() ? ` Свяжитесь с магазином: ${profile.phone.trim()}.` : " Владелец должен добавить товары перед оформлением."}`, state };

    switch (state.step) {
        case "discover":
            if (parseBudget(messageText) !== undefined) {
                state.draft.budgetKzt = parseBudget(messageText)!;
                return { reply: "Бюджет записала. Кому и по какому поводу выбираете цветы?", state };
            }
            if (messageText.length < 2 || messageText.length > 300 || /^(хочу (?:букет|цветы)|да|нет|спасибо|ок|хорошо)$/i.test(text)) return { reply: "Кому и по какому поводу выбираете цветы? Это поможет подобрать букет.", state };
            state.draft.occasion = messageText;
            if (state.draft.productId) return continueFlow(state, profile, products);
            if (state.draft.budgetKzt !== null) return continueFlow(state, profile, products);
            return { reply: "Поняла, подберём подходящий букет. На какой бюджет ориентироваться? Напишите сумму в тенге или «без ограничений».", state: { ...state, step: "budget" } };
        case "budget": {
            const amount = parseBudget(messageText);
            if (amount === undefined) return { reply: "Какой бюджет на букет? Например: «15 000» или «без ограничений».", state };
            state.draft.budgetKzt = amount;
            return { reply: `${amount === null ? "Можно рассмотреть эти букеты:" : `Вот варианты до ${money(amount)}:`}\n\n${catalog(products, amount)}\n\nНапишите название или номер букета.`, state: { ...state, step: "product" } };
        }
        case "product": return { reply: `Не нашла такой вариант в каталоге. Напишите точное название или номер.\n\n${catalog(products, state.draft.budgetKzt)}`, state };
        case "name":
            if (!validName(messageText)) return { reply: "Напишите своё имя буквами, например «Айдана».", state };
            state.draft.customerName = messageText;
            return continueFlow(state, profile, products);
        case "phone":
            if (!validPhone(messageText)) return { reply: "Проверьте телефон: нужно от 10 до 15 цифр. Например +7 777 123 45 67.", state };
            state.draft.customerPhone = messageText;
            return continueFlow(state, profile, products);
        case "address":
            if (!validAddress(messageText)) return { reply: "Напишите полный адрес: город, улица, дом и квартира при необходимости.", state };
            state.draft.deliveryAddress = messageText;
            return continueFlow(state, profile, products);
        case "date":
            if (!validDate(messageText)) return { reply: "Укажите дату и удобное время доставки, например «завтра после 15:00».", state };
            state.draft.deliveryDate = messageText;
            return continueFlow(state, profile, products);
        case "review": {
            if (!/^(?:подтверждаю(?: заказ| заявку)?|все верно|верно|да|оформить|оформляйте|confirm)[.!]?$/i.test(text)) return { reply: "Для сохранения заявки напишите «Подтверждаю». Если нужно исправить данные — например, «Изменить адрес».", state };
            const selected = products.find((item) => item.id === state.draft.productId);
            if (!selected) return continueFlow({ ...state, draft: { ...state.draft, productId: "" } }, profile, products, "Выбранный букет больше не указан в каталоге. Выберите другой.\n\n");
            if (nextStep(state.draft) !== "review") return continueFlow(state, profile, products, "Не хватает данных для заявки.\n\n");
            const currentQuote = quote(selected, profile);
            if (!state.reviewedQuote || state.reviewedQuote.productPriceKzt !== currentQuote.productPriceKzt || state.reviewedQuote.deliveryFeeKzt !== currentQuote.deliveryFeeKzt || state.reviewedQuote.totalKzt !== currentQuote.totalKzt) {
                const updated = review(state, selected, profile);
                return { ...updated, reply: "Условия стоимости обновились. Проверьте их и подтвердите ещё раз.\n\n" + updated.reply };
            }
            return {
                reply: "Подтверждение принято. Сохраняем заявку для магазина. Владелец свяжется с вами и подтвердит наличие, доставку и итоговую сумму. Оплата через этого бота пока не принимается.",
                state: { ...state, step: "submitted", orderId: null },
                order: { draft: { ...state.draft }, product: selected, deliveryFeeKzt: currentQuote.deliveryFeeKzt, totalKzt: currentQuote.totalKzt },
            };
        }
    }
}
