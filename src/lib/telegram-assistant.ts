import { generateAIResponse, isLiveAIConfigured, type ChatTurn } from "@/lib/ai";
import type { BusinessProfile } from "@/lib/business";
import { runSalesTurn, type SalesProduct, type SalesState, type SalesTurn } from "@/lib/sales-assistant";

export function telegramHistory(value: unknown): ChatTurn[] {
    if (!value || typeof value !== "object") return [];
    const history = (value as Record<string, unknown>).assistantHistory;
    if (!Array.isArray(history)) return [];
    return history.filter((item): item is ChatTurn => item && (item.role === "user" || item.role === "assistant")
        && typeof item.content === "string" && item.content.length <= 4000).slice(-10);
}

const topics = [
    { match: /ухаж|уход|ваз[аеуы]|вод[аыуе]|подрез|увяд|завял|сохранить|просто[яи]|care|vase|wilt/i,
        answer: "Общий совет по уходу: поставьте букет в чистую вазу, уберите листья ниже уровня воды и обновите срезы чистым инструментом. Меняйте воду, держите цветы подальше от солнца, батареи и фруктов. Если есть подкормка для срезанных цветов, используйте её по инструкции. Для композиции во флористической губке уход отличается — напишите, какие у вас цветы и упаковка." },
    { match: /аллерг|аромат|пахн|запах|пыльц|allerg|scent/i,
        answer: "Если получатель чувствителен к запахам, обычно выбирают цветы без выраженного аромата и заранее уточняют конкретные аллергии. Полностью гипоаллергенный букет обещать нельзя. Напишите пожелания в комментарии к заявке — магазин подтвердит подходящий состав." },
    { match: /кошк|кот[ау]?\b|собак|питом|лили.*опас|pets|cats/i,
        answer: "Лилии опасны для кошек, в том числе пыльца и вода из вазы. Для дома с животными состав нужно проверить по каждому растению; держите букет вне их доступа. Если животное могло контактировать с лилией или съесть растение, срочно обратитесь к ветеринару. Какое животное живёт у получателя?" },
    { match: /открытк|подписать|поздравлен|текст.*записк|что написать|card|greeting/i,
        answer: "Можно подписать открытку так: «Пусть этот букет подарит тебе улыбку и напомнит, как много ты для меня значишь». Для мамы: «Спасибо за твою заботу и тепло. Люблю тебя!». Наличие открытки и её стоимость уточнит магазин. Кому и по какому поводу нужен текст?" },
    { match: /упаков|коробк|корзин|губк|пленк|плёнк|wrapping|basket/i,
        answer: "Общий совет: для букета в стеблях понадобится ваза, а коробка или корзина часто содержит флористическую губку — её аккуратно увлажняют, не заливая упаковку. Не вытаскивайте стебли из готовой композиции без необходимости. Доступные виды упаковки и доплаты должен подтвердить магазин." },
    { match: /сочетан|состав|какие цветы|какой.*букет|подобрать|посовет|порекоменд|свадьб|свидан|годовщин|учител|colou?r|recommend/i,
        answer: "Для нежного впечатления часто выбирают светлые оттенки, для яркого подарка — насыщенные. При выборе учитывают повод, любимые цветы и запахи получателя. Сезонные замены можно обсудить с флористом; точный состав и наличие подтвердит магазин. На какой бюджет и для кого подбираете букет?" },
    { match: /мороз|жар[ауе]|перевоз|транспорт|холод|нести|transport/i,
        answer: "Общий совет по перевозке: защитите букет от ветра, мороза и прямого солнца, сократите время без воды. В машине держите его устойчиво, вдали от горячего воздуха. В холодную погоду попросите защитную упаковку; возможность и стоимость уточнит магазин." },
];

function knowledgeAnswer(message: string, knowledge = "") {
    // Owner-entered FAQ pairs are searchable even without an AI provider.
    const words = (value: string) => value.toLowerCase().replace(/ё/g, "е").match(/[\p{L}\d]{4,}/gu) ?? [];
    const stop = new Set(["какие", "какой", "можно", "либо", "вашего", "вашем", "магазина", "магазине", "скажите", "пожалуйста", "есть"]);
    const query = new Set(words(message).filter((word) => !stop.has(word)).map((word) => word.slice(0, 5)));
    let best: { score: number; answer: string } | undefined;
    for (const match of knowledge.matchAll(/(?:^|\n)Вопрос:\s*([^\n]+)\nОтвет:\s*([\s\S]*?)(?=\nВопрос:|$)/gi)) {
        const terms = new Set(words(match[1]).filter((word) => !stop.has(word)).map((word) => word.slice(0, 5)));
        const hits = [...query].filter((word) => terms.has(word)).length;
        const score = query.size ? hits / query.size : 0;
        if (hits && score >= 0.6 && (!best || score > best.score)) best = { score, answer: match[2].trim().slice(0, 2600) };
    }
    return best?.answer;
}

export function isConsultation(message: string) {
    return /\?|^(?:а\s+)?(?:как|когда|где|сколько|како[йея]|какие|можно|что|кто|почему|зачем|чем|есть ли|есть у вас|а есть|расскажи|расскажите|посовет|подскаж|порекоменд|помоги|нужен совет)|ухаж|уход за|увяд|завял|аллерг|возврат|упаков|открытк|самовывоз|оплат|доставк|график|режим работы|условия|правила|наличие|what|how|which|can you/i.test(message);
}

export async function runTelegramTurn(input: {
    message: string; profile: BusinessProfile; products: SalesProduct[]; state: SalesState; history: ChatTurn[]; aiDeadline?: number;
}): Promise<SalesTurn> {
    const { message, profile, products, state, history } = input;
    if (/^\/help(?:@\w+)?$/i.test(message)) return { state, reply: "Помогу выбрать букет, разобраться в уходе, упаковке и условиях магазина. Можно задать вопрос в любой момент.\n\n/catalog — букеты и цены\n/new — новая заявка\n/cancel — очистить черновик\n«Продолжить» — вернуться к оформлению\n«Оператор» — контакты магазина" };
    if (/^\/start(?:@\w+)?$/i.test(message)) {
        const turn = runSalesTurn(input);
        return { ...turn, reply: profile.assistantGreeting?.trim()
            ? `${profile.assistantGreeting.trim()}\n\nЯ цифровой помощник «${profile.name}». Каталог: /catalog. Задайте вопрос или напишите, кому выбираете цветы.`
            : `Здравствуйте! Я цифровой помощник «${profile.name}». Помогу подобрать букет, подскажу по уходу и отвечу на вопросы о магазине.\n\nКаталог: /catalog. Чтобы оформить заявку, напишите, кому и по какому поводу нужны цветы. Помощь: /help.` };
    }
    if (/^(?:продолжить|продолжим|оформление)$/i.test(message)) {
        if (state.step === "review") return runSalesTurn({ ...input, message: `Комментарий: ${state.draft.note || "убрать"}` });
        const prompts: Record<SalesState["step"], string> = {
            discover: "Кому и по какому поводу выбираете цветы?", budget: "Какой у вас бюджет на букет в тенге?",
            product: "Выберите название или номер букета. Каталог: /catalog.", name: "Как к вам обращаться?",
            phone: "Напишите ваш телефон для связи.", address: "Напишите полный адрес доставки.", date: "На какую дату и время нужна доставка?",
            review: "Для просмотра деталей напишите «Комментарий: …» или исправьте поле, например «Изменить адрес». Подтверждайте заявку только после проверки деталей.",
            submitted: "Заявка уже сохранена. Для новой заявки напишите /new.",
        };
        return { state, reply: prompts[state.step] };
    }
    const faq = knowledgeAnswer(message, profile.assistantKnowledge);
    // Commands, labeled checkout fields, exact catalog selections and confirmations use the validated checkout.
    if (/^\/|^(?:изменить|исправить|поменять|беру|выбираю|бюджет)\b|^(?:имя(?: клиента)?|телефон|адрес|дата|время|букет|повод|комментарий|пожелания)\s*:|^(?:подтверждаю|да|всё верно|все верно|отмена|новый заказ)[.!]?$/i.test(message)
        || products.some((product) => product.name.toLocaleLowerCase() === message.toLocaleLowerCase() || product.id === message)
        || (!isConsultation(message) && !faq)) return runSalesTurn(input);

    if (/оператор|менеджер|сотрудник|позвонить|связаться|оплат|перевод|реквизит|данные карты/i.test(message)) return runSalesTurn({ ...input, message: `${message}?` });

    let reply = faq;
    if (!reply && isLiveAIConfigured()
        && (input.aiDeadline === undefined || Date.now() + 20_000 <= input.aiDeadline)) {
        try {
            reply = await generateAIResponse(message, {
                businessName: profile.name, language: profile.language, tone: profile.tone,
                flowerConsultant: profile.allowFlowerAdvice !== false,
                businessDescription: JSON.stringify({ description: profile.description, address: profile.location, hours: profile.hours,
                    phone: profile.phone, deliveryAreas: profile.deliveryAreas, deliveryFeeKzt: profile.deliveryFeeKzt,
                    orderPolicy: profile.orderPolicy, knowledge: profile.assistantKnowledge,
                    checkout: { step: state.step, occasion: state.draft.occasion, budgetKzt: state.draft.budgetKzt,
                        selectedProduct: products.find((product) => product.id === state.draft.productId)?.name },
                    actionPolicy: "No actions are available. For checkout ask the customer to type Продолжить. Never claim staff were notified. Availability and delivery slots require shop confirmation." }),
                products, services: profile.services,
            }, history);
        } catch {
            // Provider outages must not break consultation or lose a customer's checkout draft.
            console.error("Telegram consultation provider unavailable; using local answers.");
        }
    }
    if (!reply && profile.allowFlowerAdvice !== false) reply = topics.find((topic) => topic.match.test(message))?.answer;
    if (!reply) return runSalesTurn({ ...input, message: `${message}?` });
    return { state, reply: `${reply.slice(0, 3600)}${!["discover", "submitted"].includes(state.step) ? "\n\nЧерновик сохранён. Напишите «Продолжить», когда будете готовы к оформлению." : ""}` };
}
