import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./sales-assistant.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { emptySalesState, parseSalesState, runSalesTurn } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("catalog photo selection follows pages and keeps original product numbers", () => {
    const products = Array.from({ length: 18 }, (_, index) => ({ id: `photo-${index}`, name: `Букет ${index}`, price_kzt: (index + 1) * 1000, description: "", image_path: `owner/${index}.jpg` }));
    const state = emptySalesState();
    const page = runSalesTurn({ message: "/catalog 2", profile, products, state });
    assert.deepEqual(page.catalogItems.map(({ number }) => number), [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.equal(runSalesTurn({ message: "/catalog 99", profile, products, state }).catalogItems, undefined);
    assert.equal(runSalesTurn({ message: "/catalog -1", profile, products, state }).catalogItems, undefined);
    const budget = runSalesTurn({ message: "2500", profile, products, state: { ...state, step: "budget" } });
    assert.deepEqual(budget.catalogItems.map(({ number }) => number), [1, 2]);
    const filtered = runSalesTurn({ message: "2500", profile, products: [products[5], products[0], products[1]], state: { ...state, step: "budget" } });
    assert.deepEqual(filtered.catalogItems.map(({ number }) => number), [2, 3]);
    assert.equal(runSalesTurn({ message: "500", profile, products, state: { ...state, step: "budget" } }).catalogItems, undefined);
});

test("photos are attached to catalog questions, never ordinary contact prompts", () => {
    const products = [{ id: "photo-1", name: "Розы", price_kzt: 1000, description: "" }];
    const state = { ...emptySalesState(), draft: { ...emptySalesState().draft, occasion: "Подарок", productId: "photo-1" }, step: "name" };
    assert.equal(runSalesTurn({ message: "Айдана", profile, products, state }).catalogItems, undefined);
    const answer = runSalesTurn({ message: "Покажи фото", profile, products, state });
    assert.equal(answer.catalogItems.length, 1);
    assert.equal(answer.state.step, "name");
    assert.equal(answer.state.draft.productId, "photo-1");
});

const profile = {
    name: "Цветочная мастерская",
    category: "Retail & online shop",
    description: "Собираем цветы для подарков",
    location: "Кызылорда, ул. Абая, 10",
    hours: "09:00–21:00",
    phone: "+7 777 555 44 33",
    language: "Russian",
    tone: "Friendly",
    services: [],
    deliveryAreas: "Кызылорда",
    deliveryFeeKzt: 1500,
    paymentPhone: "+7 777 111 22 33",
    paymentRecipient: "Владелец магазина",
    paymentBank: "Банк",
    orderPolicy: "Состав согласуем перед сборкой",
    acceptOrdersOffline: true,
};
const products = [
    { id: "spring", name: "Весенний букет", price_kzt: 12000, description: "Сезонные цветы" },
    { id: "roses", name: "Букет из 15 роз", price_kzt: 18000, description: "Розы с оформлением" },
    { id: "premium", name: "Авторский букет", price_kzt: 25000, description: "Композиция с открыткой" },
];
const turn = (message, state = emptySalesState(), overrides = {}) => runSalesTurn({ message, profile, products, state, ...overrides });

function reviewState(overrides = {}) {
    let state = emptySalesState();
    for (const message of ["На день рождения маме", "20 000", "2", "Айдана", "+7 777 123 45 67", "Кызылорда, Абая 12, квартира 4", "завтра с 14:00 до 16:00"]) {
        const response = turn(message, state, overrides);
        assert.equal(response.order, undefined, "An order must not be emitted while gathering details");
        state = response.state;
    }
    assert.equal(state.step, "review");
    return state;
}

test("guides a complete request and creates intent only after explicit confirmation", () => {
    const state = reviewState();
    assert.deepEqual(state.reviewedQuote, { productPriceKzt: 18000, deliveryFeeKzt: 1500, totalKzt: 19500 });
    const ambiguous = turn("Я подумаю", state);
    assert.equal(ambiguous.order, undefined);
    assert.equal(ambiguous.state.step, "review");
    const confirmed = turn("Подтверждаю", state);
    assert.equal(confirmed.order.product.id, "roses");
    assert.equal(confirmed.order.totalKzt, 19500);
    assert.equal(confirmed.state.step, "submitted");
    assert.match(confirmed.reply, /заявку/);
    assert.match(confirmed.reply, /Оплата через этого бота пока не принимается/);
    assert.doesNotMatch(confirmed.reply, /реквизиты|оплата подтверждена|переведите/);
});

test("confirmation cannot skip required fields or submit a damaged stored draft", () => {
    const initial = turn("Подтверждаю");
    assert.equal(initial.order, undefined);
    const state = reviewState();
    state.draft.customerPhone = "123";
    const response = turn("Подтверждаю", state);
    assert.equal(response.order, undefined);
    assert.equal(response.state.step, "phone");
});

test("does not create a second request from a submitted conversation", () => {
    const confirmed = turn("Подтверждаю", reviewState());
    confirmed.state.orderId = "12345678-abcd-4000-8000-0000abc12345";
    const repeated = turn("Подтверждаю", confirmed.state);
    assert.equal(repeated.order, undefined);
    assert.match(repeated.reply, /12345678/);
    assert.doesNotMatch(repeated.reply, /ABC12345/);
});

test("catalog, hours, delivery, payment, and unrelated questions preserve checkout data", () => {
    const state = reviewState();
    state.step = "name";
    for (const message of ["/catalog", "Когда вы работаете?", "А доставка сколько стоит?", "Как оплатить?", "Какие есть цветы?", "Кто выиграл матч?"]) {
        const response = turn(message, state);
        assert.deepEqual(response.state, state, message);
        assert.equal(response.order, undefined);
    }
});

test("recommends only real products within budget with stable catalog numbers", () => {
    const state = turn("Для мамы").state;
    const response = turn("15 тыс", state);
    assert.match(response.reply, /1\. Весенний букет/);
    assert.doesNotMatch(response.reply, /Букет из 15 роз|Авторский букет/);
    assert.equal(response.state.draft.budgetKzt, 15000);
    assert.equal(turn("1", response.state).state.draft.productId, "spring");
    assert.equal(turn("2", response.state).state.draft.productId, "");
});

test("rejects invalid budgets and does not misinterpret a budget as a product index", () => {
    const state = turn("День рождения").state;
    for (const message of ["-5", "0", "999999999", "хочу недорого"]) {
        assert.deepEqual(turn(message, state).state, state);
    }
    const tiny = turn("2", state);
    assert.equal(tiny.state.draft.budgetKzt, 2);
    assert.equal(tiny.state.draft.productId, "");
    assert.match(tiny.reply, /нет букетов/);
});

test("accepts precise product names, product ids, and customer selection phrases", () => {
    for (const message of ["Букет из 15 роз", "roses", "Беру Букет из 15 роз"]) {
        const response = turn(message);
        assert.equal(response.state.draft.productId, "roses");
        assert.equal(response.state.step, "discover");
        assert.match(response.reply, /поводу/);
    }
});

test("unknown catalog items and live stock questions never invent prices or availability", () => {
    const state = turn("20 000", turn("День рождения").state).state;
    const response = turn("Пионы", state);
    assert.equal(response.state.draft.productId, "");
    assert.match(response.reply, /Не нашла/);
    const stock = turn("Есть ли пионы в наличии?", state);
    assert.match(stock.reply, /остатки цветов не подключены/);
    assert.equal(stock.order, undefined);
});

test("validates customer phone and name without silently progressing", () => {
    const state = reviewState();
    state.step = "name";
    state.draft.customerName = "";
    for (const message of ["12345", "да", "Айдана123"]) assert.deepEqual(turn(message, state).state, state);
    const phoneState = turn("Айдана", state).state;
    phoneState.step = "phone";
    phoneState.draft.customerPhone = "";
    for (const message of ["123", "+7 abc 777 123 4567", "+1234567890123456"]) assert.deepEqual(turn(message, phoneState).state, phoneState);
    assert.equal(turn("+7 (777) 123-45-67", phoneState).state.draft.customerPhone, "+7 (777) 123-45-67");
});

test("can correct individual details and resume review without losing other fields", () => {
    const state = reviewState();
    const edit = turn("Изменить адрес", state);
    assert.equal(edit.state.step, "address");
    assert.equal(edit.state.draft.deliveryAddress, "");
    const corrected = turn("Кызылорда, Сатпаева 20", edit.state);
    assert.equal(corrected.state.step, "review");
    assert.equal(corrected.state.draft.customerPhone, state.draft.customerPhone);
    assert.equal(corrected.state.draft.deliveryAddress, "Кызылорда, Сатпаева 20");
    const inline = turn("Имя: Алия", corrected.state);
    assert.equal(inline.state.draft.customerName, "Алия");
    assert.equal(inline.state.step, "review");
    const note = turn("Комментарий: открытка без подписи", inline.state);
    assert.equal(note.state.draft.note, "открытка без подписи");
    assert.match(note.reply, /открытка без подписи/);
});

test("price or delivery changes require a fresh review and a second confirmation", () => {
    for (const changes of [
        { products: products.map((p) => p.id === "roses" ? { ...p, price_kzt: 19000 } : p) },
        { profile: { ...profile, deliveryFeeKzt: 2000 } },
    ]) {
        const response = turn("Подтверждаю", reviewState(), changes);
        assert.equal(response.order, undefined);
        assert.match(response.reply, /стоимости обновились/);
        assert.ok(turn("Подтверждаю", response.state, changes).order);
    }
});

test("removed products cannot be ordered from a stale draft", () => {
    const response = turn("Подтверждаю", reviewState(), { products: products.filter((p) => p.id !== "roses") });
    assert.equal(response.order, undefined);
    assert.equal(response.state.step, "product");
    assert.equal(response.state.draft.productId, "");
});

test("unknown delivery cost remains null and does not become free shipping", () => {
    const overrides = { profile: { ...profile, deliveryFeeKzt: null, acceptOrdersOffline: false } };
    const state = reviewState(overrides);
    assert.equal(state.reviewedQuote.deliveryFeeKzt, null);
    assert.equal(state.reviewedQuote.totalKzt, null);
    const response = turn("Подтверждаю", state, overrides);
    assert.equal(response.order.deliveryFeeKzt, null);
    assert.equal(response.order.totalKzt, null);
    assert.match(response.reply, /итоговую сумму/);
    assert.doesNotMatch(response.reply, /бесплат|оплатите|переведите/);
});

test("zero delivery cost is distinct from an unknown cost", () => {
    const overrides = { profile: { ...profile, deliveryFeeKzt: 0 } };
    const response = turn("Подтверждаю", reviewState(overrides), overrides);
    assert.equal(response.order.deliveryFeeKzt, 0);
    assert.equal(response.order.totalKzt, 18000);
});

test("payment messages never produce instructions, confirm payment, or change saved status", () => {
    const state = { ...turn("Подтверждаю", reviewState()).state, orderId: "stored-order" };
    for (const message of ["оплатил", "Я перевела", "Как оплатить?", "Реквизиты?"]) {
        const response = turn(message, state);
        assert.deepEqual(response.state, state);
        assert.equal(response.order, undefined);
        assert.match(response.reply, /Оплата через этого бота пока не принимается/);
        assert.doesNotMatch(response.reply, /777 111 22 33|оплата подтверждена|переведите/i);
    }
});

test("new or start commands reset private details and cancellation cannot cancel a saved order", () => {
    const state = reviewState();
    for (const command of ["/new", "/start shopcode", "/cancel"]) assert.deepEqual(turn(command, state).state, emptySalesState());
    const saved = { ...turn("Подтверждаю", state).state, orderId: "saved-order" };
    const cancel = turn("/cancel", saved);
    assert.deepEqual(cancel.state, saved);
    assert.match(cancel.reply, /свяжитесь с магазином/);
});

test("handoff uses the merchant contact and empty catalogs cannot create requests", () => {
    const state = reviewState();
    const handoff = turn("Позвать оператора", state);
    assert.match(handoff.reply, /777 555 44 33/);
    assert.deepEqual(handoff.state, state);
    const empty = turn("хочу цветы", emptySalesState(), { products: [] });
    assert.equal(empty.order, undefined);
    assert.match(empty.reply, /нет букетов/);
});

test("each new state has an independent draft and turns do not mutate prior state", () => {
    const first = emptySalesState();
    const second = emptySalesState();
    first.draft.customerName = "Алия";
    assert.equal(second.draft.customerName, "");
    const snapshot = structuredClone(second);
    turn("День рождения", second);
    assert.deepEqual(second, snapshot);
});

test("untrusted preview state is normalized without retaining extra properties", () => {
    const state = reviewState();
    const normalized = parseSalesState({ ...state, unexpected: true, draft: { ...state.draft, unsafe: true } });
    assert.deepEqual(normalized, state);
    assert.notEqual(normalized.draft, state.draft);
    assert.deepEqual(parseSalesState({ ...state, reviewedQuote: { productPriceKzt: 18000, deliveryFeeKzt: null, totalKzt: null } }).reviewedQuote, { productPriceKzt: 18000, deliveryFeeKzt: null, totalKzt: null });
});

test("malformed state, oversized details, and impossible quotes safely reset", () => {
    const state = reviewState();
    for (const value of [undefined, null, [], "review", {}, { ...state, step: "unknown" }, { ...state, orderId: 123 }, { ...state, draft: null },
        { ...state, draft: { ...state.draft, customerName: 42 } },
        { ...state, draft: { ...state.draft, note: "a".repeat(1001) } },
        { ...state, draft: { ...state.draft, deliveryAddress: "a".repeat(501) } },
        { ...state, draft: { ...state.draft, budgetKzt: -1 } },
        { ...state, draft: { ...state.draft, budgetKzt: Number.NaN } },
        { ...state, reviewedQuote: { productPriceKzt: 18000, deliveryFeeKzt: null, totalKzt: 18000 } },
        { ...state, reviewedQuote: { productPriceKzt: 18000, deliveryFeeKzt: 1500, totalKzt: 10 } },
        { ...state, reviewedQuote: { productPriceKzt: -1, deliveryFeeKzt: 1500, totalKzt: 1499 } },
    ]) assert.deepEqual(parseSalesState(value), emptySalesState());
});

test("business and service questions quote approved profile data and resume the current step", () => {
    const merchant = { ...profile, description: "Семейная мастерская. Собираем букеты в спокойной палитре.", services: ["Упаковка букета", "Открытка с пожеланием"] };
    const state = reviewState();
    state.step = "phone";
    state.draft.customerPhone = "";
    for (const message of ["Расскажите о вашем магазине", "Что вы предлагаете?", "Какие услуги есть?", "Чем занимаетесь?"]) {
        const response = turn(message, state, { profile: merchant });
        assert.match(response.reply, /Семейная мастерская\. Собираем букеты в спокойной палитре\./);
        assert.match(response.reply, /Упаковка букета/);
        assert.match(response.reply, /Открытка с пожеланием/);
        assert.match(response.reply, /ваш телефон для связи и подтверждения заявки/);
        assert.deepEqual(response.state, state);
        assert.equal(response.order, undefined);
    }
});

test("service answers do not infer unknown offers or prices and describe missing business information", () => {
    const merchant = { ...profile, description: "Небольшая мастерская в центре города.", services: ["Упаковка в бумагу"] };
    const response = turn("Какие услуги вы предлагаете?", emptySalesState(), { profile: merchant });
    assert.match(response.reply, /Упаковка в бумагу/);
    assert.doesNotMatch(response.reply, /свадеб|скидк|бесплат|\d+\s*₸|круглосуточ/);
    const missing = turn("Расскажите о магазине", emptySalesState(), { profile: { ...profile, description: "", services: [] } });
    assert.match(missing.reply, /пока не добавил описание и список услуг/);
    assert.match(missing.reply, /По какому поводу/);
    assert.equal(missing.state.step, "discover");
});

test("assistant introduction describes request collection without payment verification", () => {
    const response = turn("Вы бот?");
    assert.match(response.reply, /цифровой помощник/);
    assert.match(response.reply, /собрать заявку/);
    assert.doesNotMatch(response.reply, /оплат|перевод|реквизит/i);
});

test("greetings during checkout preserve details and ask for the current field", () => {
    const collected = reviewState();
    for (const [step, prompt] of [["budget", /бюджет/], ["name", /Как к вам обращаться/], ["phone", /ваш телефон/], ["address", /адрес доставки/], ["date", /дату и время/], ["review", /Подтверждаю/]]) {
        const state = { ...collected, step };
        const response = turn("Здравствуйте", state);
        assert.deepEqual(response.state, state);
        assert.match(response.reply, prompt);
        assert.doesNotMatch(response.reply, /По какому поводу/);
        assert.equal(response.order, undefined);
    }
    const nameState = { ...collected, step: "name", draft: { ...collected.draft, customerName: "" } };
    const greeting = turn("Привет", nameState);
    assert.equal(turn("Айдана", greeting.state).state.draft.customerName, "Айдана");
});

test("a customer can share a name with a product without triggering a product selection", () => {
    const catalogWithName = [{ id: "rose", name: "Роза", price_kzt: 12000, description: "Розовый букет" }];
    let state = emptySalesState();
    for (const message of ["День рождения мамы", "15000", "1"]) state = turn(message, state, { products: catalogWithName }).state;
    assert.equal(state.step, "name");
    const named = turn("Роза", state, { products: catalogWithName });
    assert.equal(named.state.draft.customerName, "Роза");
    assert.equal(named.state.draft.productId, "rose");
    assert.equal(named.state.step, "phone");
    assert.equal(named.order, undefined);
});

test("a product can be explicitly changed at review and must be confirmed with its new quote", () => {
    for (const message of ["Беру Весенний букет", "Букет: Весенний букет"]) {
        const original = reviewState();
        const changed = turn(message, original);
        assert.equal(changed.state.step, "review");
        assert.equal(changed.state.draft.productId, "spring");
        assert.equal(changed.state.draft.customerName, original.draft.customerName);
        assert.equal(changed.state.reviewedQuote.productPriceKzt, 12000);
        assert.equal(changed.order, undefined);
        assert.equal(turn("Подтверждаю", changed.state).order.product.id, "spring");
    }
});

test("long catalogs fit Telegram replies and paginate with stable full-catalog numbers", () => {
    const largeCatalog = Array.from({ length: 20 }, (_, index) => ({
        id: `item-${index + 1}`, name: `Вариант ${index + 1} ${"Н".repeat(200)}`, price_kzt: 12000, description: "Описание ".repeat(120),
    }));
    const first = turn("/catalog", emptySalesState(), { products: largeCatalog });
    assert.ok(first.reply.length < 3000);
    assert.match(first.reply, /1\. Вариант 1/);
    assert.match(first.reply, /8\. Вариант 8/);
    assert.doesNotMatch(first.reply, /9\. Вариант 9/);
    assert.match(first.reply, /\/catalog 2/);
    const second = turn("/catalog 2", first.state, { products: largeCatalog });
    assert.ok(second.reply.length < 3000);
    assert.match(second.reply, /9\. Вариант 9/);
    assert.match(second.reply, /16\. Вариант 16/);
    assert.doesNotMatch(second.reply, /1\. Вариант 1\s/);
    assert.match(second.reply, /\/catalog 3/);
    const selected = turn("9", second.state, { products: largeCatalog });
    assert.equal(selected.state.draft.productId, "item-9");
    const invalid = turn("/catalog 999", second.state, { products: largeCatalog });
    assert.match(invalid.reply, /В каталоге 3 страниц/);
    assert.deepEqual(invalid.state, second.state);
});

test("budget recommendations display only the first page within budget", () => {
    const largeCatalog = Array.from({ length: 20 }, (_, index) => ({ id: `item-${index + 1}`, name: `Вариант ${index + 1}`, price_kzt: 10000, description: "Описание ".repeat(120) }));
    const response = turn("15000", turn("День рождения", emptySalesState(), { products: largeCatalog }).state, { products: largeCatalog });
    assert.ok(response.reply.length < 3000);
    assert.match(response.reply, /8\. Вариант 8/);
    assert.doesNotMatch(response.reply, /9\. Вариант 9/);
    assert.match(response.reply, /Больше вариантов: \/catalog/);
});

test("opening a catalog page during checkout resumes the current field and requires explicit product changes", () => {
    const largeCatalog = Array.from({ length: 20 }, (_, index) => ({ id: `item-${index + 1}`, name: `Вариант ${index + 1}`, price_kzt: 12000, description: "" }));
    const state = { ...reviewState(), step: "phone" };
    state.draft.customerPhone = "";
    const listed = turn("/catalog 2", state, { products: largeCatalog });
    assert.deepEqual(listed.state, state);
    assert.match(listed.reply, /Букет: название или номер/);
    assert.match(listed.reply, /ваш телефон для связи и подтверждения заявки/);
    assert.deepEqual(turn("9", listed.state, { products: largeCatalog }).state, state);
    const changed = turn("Букет: 9", listed.state, { products: largeCatalog });
    assert.equal(changed.state.draft.productId, "item-9");
    assert.equal(changed.state.step, "phone");
    assert.equal(changed.state.draft.customerName, state.draft.customerName);
});

test("maximum-sized review details keep the final confirmation instruction inside the Telegram limit", () => {
    const state = reviewState();
    state.draft.occasion = "П".repeat(300);
    state.draft.customerName = "А".repeat(100);
    state.draft.customerPhone = "+7" + " ".repeat(288) + "7771234567";
    state.draft.deliveryAddress = "А".repeat(500);
    state.draft.deliveryDate = "завтра " + "В".repeat(293);
    const merchant = { ...profile, orderPolicy: "У".repeat(3000) };
    const response = turn("Комментарий: " + "Н".repeat(1000), state, { profile: merchant });
    assert.equal(response.state.step, "review");
    assert.ok(response.reply.length <= 4000, `Review length is ${response.reply.length}`);
    assert.match(response.reply, /Полные правила: напишите «Условия»/);
    assert.match(response.reply, /Если всё верно, напишите «Подтверждаю»/);
    assert.ok(response.reply.endsWith("Для исправления: «Изменить адрес», «Имя: …» или «Комментарий: …»."));
    const policy = turn("Условия", response.state, { profile: merchant });
    assert.ok(policy.reply.length <= 4000);
    assert.match(policy.reply, new RegExp("У".repeat(3000)));
    assert.deepEqual(policy.state, response.state);
});

test("checkout collects the customer's contact and keeps a gift recipient in an optional comment", () => {
    let state = emptySalesState();
    for (const message of ["Маме на день рождения", "20000", "2"]) state = turn(message, state).state;
    assert.match(turn("Здравствуйте", state).reply, /Как к вам обращаться/);
    const name = turn("Айдана", state);
    assert.match(name.reply, /ваш телефон для связи и подтверждения заявки/);
    const phone = turn("+7 777 123 45 67", name.state);
    assert.match(phone.reply, /Если цветы получит другой человек/);
    assert.match(phone.reply, /Комментарий/);
    state = turn("Комментарий: Получатель цветов — мама Роза, телефон +7 777 987 65 43", phone.state).state;
    state = turn("Кызылорда, Абая 12", state).state;
    const reviewed = turn("Завтра после 14:00", state);
    assert.match(reviewed.reply, /Имя клиента: Айдана/);
    assert.match(reviewed.reply, /Телефон клиента: \+7 777 123 45 67/);
    assert.match(reviewed.reply, /Получатель цветов — мама Роза/);
    assert.equal(reviewed.state.draft.customerName, "Айдана");
    assert.equal(reviewed.state.draft.customerPhone, "+7 777 123 45 67");
    assert.equal(reviewed.order, undefined);
});
