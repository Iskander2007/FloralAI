import { NextResponse } from "next/server";
import {
    answerFlowerQuestion,
    emptyFlowerOrder,
    findFlowerProduct,
    FlowerFlowStep,
    FlowerOrderDraft,
    flowerCatalog,
    flowerOrderSummary,
    formatKzt,
    isFlowerConfirmation,
    parseFlowerBudget,
    validFlowerPhone,
} from "@/lib/flower-assistant";
import { prisma } from "@/lib/prisma";

type RequestBody = {
    message: string;
    step: FlowerFlowStep;
    draft: FlowerOrderDraft;
    idempotencyKey: string;
};

const validSteps = new Set<FlowerFlowStep>([
    "occasion",
    "bouquet",
    "budget",
    "delivery",
    "customer",
    "phone",
    "address",
    "payment",
    "confirm",
    "complete",
]);

function validDraft(value: unknown): value is FlowerOrderDraft {
    if (!value || typeof value !== "object") return false;
    const draft = value as Record<string, unknown>;
    return (
        typeof draft.occasion === "string" &&
        draft.occasion.length <= 120 &&
        (draft.productId === "" ||
            flowerCatalog.some((product) => product.id === draft.productId)) &&
        (draft.budgetKzt === null ||
            (typeof draft.budgetKzt === "number" &&
                Number.isSafeInteger(draft.budgetKzt) &&
                draft.budgetKzt > 0 &&
                draft.budgetKzt <= 10_000_000)) &&
        typeof draft.deliveryDate === "string" &&
        draft.deliveryDate.length <= 120 &&
        typeof draft.customerName === "string" &&
        draft.customerName.length <= 100 &&
        typeof draft.customerPhone === "string" &&
        draft.customerPhone.length <= 30 &&
        typeof draft.deliveryAddress === "string" &&
        draft.deliveryAddress.length <= 300 &&
        (draft.paymentMethod === "" ||
            draft.paymentMethod === "cash_on_delivery" ||
            draft.paymentMethod === "bank_transfer")
    );
}

function validRequest(value: unknown): value is RequestBody {
    if (!value || typeof value !== "object") return false;
    const body = value as Record<string, unknown>;
    return (
        typeof body.message === "string" &&
        body.message.trim().length > 0 &&
        body.message.length <= 500 &&
        typeof body.step === "string" &&
        validSteps.has(body.step as FlowerFlowStep) &&
        validDraft(body.draft) &&
        typeof body.idempotencyKey === "string" &&
        /^[\da-f-]{36}$/i.test(body.idempotencyKey)
    );
}

function reply(body: RequestBody, text: string, step = body.step, draft = body.draft) {
    return NextResponse.json({ reply: text, step, draft });
}

export async function handleFlowerAssistantRequest(request: Request) {
    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ error: "Не удалось прочитать запрос." }, { status: 400 });
    }
    if (rawBody.length > 8_192) {
        return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Некорректный JSON." }, { status: 400 });
    }
    if (!validRequest(payload)) {
        return NextResponse.json({ error: "Проверьте сообщение и данные заказа." }, { status: 400 });
    }

    const body = payload;
    const message = body.message.trim();
    const question = answerFlowerQuestion(message);
    if (question) return reply(body, question);

    switch (body.step) {
        case "occasion":
            if (message.length < 2) {
                return reply(body, "Расскажите, по какому поводу выбираете цветы.");
            }
            return reply(
                body,
                `Записала: ${message}.\n\nВыберите букет:\n${flowerCatalog
                    .map(
                        (product, index) =>
                            `${index + 1}. ${product.name} — ${formatKzt(product.priceKzt)}. ${product.description}.`,
                    )
                    .join("\n")}\n\nНапишите название или номер.`,
                "bouquet",
                { ...body.draft, occasion: message },
            );

        case "bouquet": {
            const product = findFlowerProduct(message);
            if (!product) {
                return reply(body, "Не нашла такой вариант. Напишите название букета или его номер из списка.");
            }
            if (body.draft.budgetKzt && product.priceKzt > body.draft.budgetKzt) {
                return reply(
                    body,
                    `${product.name} стоит ${formatKzt(product.priceKzt)}, это выше указанного бюджета. Выберите другой букет или измените бюджет.`,
                );
            }
            const draft = { ...body.draft, productId: product.id };
            return reply(
                body,
                `${product.name} — ${formatKzt(product.priceKzt)}. Какой у вас бюджет? Можно написать «без ограничений».`,
                "budget",
                draft,
            );
        }

        case "budget": {
            const amount = parseFlowerBudget(message);
            if (amount === undefined) {
                return reply(body, "Напишите бюджет числом в тенге или укажите, что ограничений нет.");
            }
            const product = flowerCatalog.find((item) => item.id === body.draft.productId);
            if (!product) {
                return reply(body, "Давайте заново выберем букет. Напишите «начать», чтобы продолжить.", "occasion", emptyFlowerOrder);
            }
            if (amount !== null && amount < product.priceKzt) {
                return reply(
                    body,
                    `Вы указали ${formatKzt(amount)}, а выбранный букет стоит ${formatKzt(product.priceKzt)}. Выберите вариант дешевле или укажите другой бюджет.`,
                    "bouquet",
                    { ...body.draft, budgetKzt: amount },
                );
            }
            return reply(
                body,
                "На какую дату нужна доставка? Напишите дату или удобное время, магазин подтвердит возможность.",
                "delivery",
                { ...body.draft, budgetKzt: amount },
            );
        }

        case "delivery":
            if (message.length < 2) return reply(body, "Укажите желаемую дату или время доставки.");
            return reply(
                body,
                "Как зовут получателя заказа?",
                "customer",
                { ...body.draft, deliveryDate: message },
            );

        case "customer":
            if (message.length < 2 || /\d{5,}/.test(message)) {
                return reply(body, "Укажите, пожалуйста, имя получателя.");
            }
            return reply(
                body,
                "Оставьте номер телефона для подтверждения заказа.",
                "phone",
                { ...body.draft, customerName: message },
            );

        case "phone":
            if (!validFlowerPhone(message)) {
                return reply(body, "Проверьте номер телефона: нужно от 10 до 15 цифр, можно с «+».");
            }
            return reply(
                body,
                "Укажите адрес доставки и, если нужно, комментарий для курьера.",
                "address",
                { ...body.draft, customerPhone: message },
            );

        case "address":
            if (message.length < 5) return reply(body, "Укажите полный адрес доставки.");
            return reply(
                body,
                "Как удобнее оплатить?\n1. Наличными при получении\n2. Переводом после подтверждения магазином\n\nОнлайн-оплата картой пока не подключена.",
                "payment",
                { ...body.draft, deliveryAddress: message },
            );

        case "payment": {
            const paymentMethod: FlowerOrderDraft["paymentMethod"] =
                /^(1|наличн|при получ|cash)/i.test(message)
                    ? "cash_on_delivery"
                    : /^(2|перевод|банк)/i.test(message)
                      ? "bank_transfer"
                      : "";
            if (!paymentMethod) {
                return reply(body, "Выберите 1 — наличными при получении или 2 — переводом после подтверждения.");
            }
            const draft = { ...body.draft, paymentMethod };
            return reply(
                body,
                `Проверьте заказ:\n${flowerOrderSummary(draft)}\n\nЧтобы оформить, напишите «Подтверждаю». Чтобы начать заново — «Начать».`,
                "confirm",
                draft,
            );
        }

        case "confirm":
            if (/^начать(?:\s+заново)?$/i.test(message)) {
                return reply(
                    { ...body, draft: emptyFlowerOrder },
                    "Хорошо, начнём заново. По какому поводу выбираете цветы?",
                    "occasion",
                    emptyFlowerOrder,
                );
            }
            if (!isFlowerConfirmation(message)) {
                return reply(body, "Заказ ещё не оформлен. Напишите «Подтверждаю» (или “confirm”) либо «Начать» для нового заказа.");
            }
            if (
                !body.draft.productId ||
                !body.draft.paymentMethod ||
                !body.draft.customerName ||
                !body.draft.customerPhone ||
                !body.draft.deliveryAddress ||
                !body.draft.deliveryDate
            ) {
                return reply(body, "В заказе не хватает данных. Начните оформление заново.", "occasion", emptyFlowerOrder);
            }

            try {
                const existing = await prisma.flowerOrder.findUnique({
                    where: { idempotencyKey: body.idempotencyKey },
                    select: { id: true },
                });
                if (existing) {
                    return NextResponse.json({
                        reply: `Заказ уже сохранён. Номер: ${existing.id.slice(-8).toUpperCase()}.`,
                        step: "complete",
                        draft: body.draft,
                        orderId: existing.id,
                    });
                }

                const product = flowerCatalog.find((item) => item.id === body.draft.productId);
                if (!product) {
                    return NextResponse.json({ error: "Выбранный букет больше недоступен." }, { status: 400 });
                }
                const order = await prisma.flowerOrder.create({
                    data: {
                        idempotencyKey: body.idempotencyKey,
                        occasion: body.draft.occasion,
                        productId: product.id,
                        productName: product.name,
                        priceKzt: product.priceKzt,
                        budgetKzt: body.draft.budgetKzt,
                        deliveryDate: body.draft.deliveryDate,
                        customerName: body.draft.customerName,
                        customerPhone: body.draft.customerPhone,
                        deliveryAddress: body.draft.deliveryAddress,
                        paymentMethod: body.draft.paymentMethod,
                    },
                    select: { id: true },
                });
                return NextResponse.json({
                    reply: `Заказ сохранён. Номер: ${order.id.slice(-8).toUpperCase()}. Магазин свяжется с вами для подтверждения наличия, доставки и оплаты.`,
                    step: "complete",
                    draft: body.draft,
                    orderId: order.id,
                });
            } catch (error) {
                console.error("Unable to save flower order.", error);
                return NextResponse.json(
                    { error: "Не удалось сохранить заказ. Проверьте подключение базы данных и попробуйте ещё раз." },
                    { status: 503 },
                );
            }

        case "complete":
            return reply(body, "Этот заказ уже оформлен. Нажмите «Новый заказ», чтобы начать сначала.");
    }
}
