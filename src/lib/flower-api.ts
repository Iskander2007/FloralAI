import { NextResponse } from "next/server";
import {
    answerFlowerQuestion,
    emptyFlowerOrder,
    findFlowerProduct,
    flowerProductDescription,
    flowerProductName,
    flowerText,
    FlowerFlowStep,
    FlowerLocale,
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
    locale: FlowerLocale;
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
        typeof body.locale === "string" &&
        (body.locale === "en" || body.locale === "ru" || body.locale === "kk") &&
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
    const locale = body.locale;
    const question = answerFlowerQuestion(message, locale);
    if (question) return reply(body, question);

    switch (body.step) {
        case "occasion":
            if (message.length < 2) {
                return reply(body, flowerText(locale, "occasion-prompt"));
            }
            return reply(
                body,
                `${locale === "en" ? "Noted" : locale === "kk" ? "Қабылдадым" : "Записала"}: ${message}.\n\n${flowerText(locale, "choose-bouquet")}\n${flowerCatalog
                    .map(
                        (product, index) =>
                            `${index + 1}. ${flowerProductName(product.id, locale)} — ${formatKzt(product.priceKzt, locale)}. ${flowerProductDescription(product.id, locale)}.`,
                    )
                    .join("\n")}\n\n${flowerText(locale, "enter-bouquet")}`,
                "bouquet",
                { ...body.draft, occasion: message },
            );

        case "bouquet": {
            const product = findFlowerProduct(message, locale);
            if (!product) {
                return reply(body, flowerText(locale, "unknown-bouquet"));
            }
            if (body.draft.budgetKzt && product.priceKzt > body.draft.budgetKzt) {
                return reply(
                    body,
                    locale === "en"
                        ? `${flowerProductName(product.id, locale)} costs ${formatKzt(product.priceKzt, locale)}, which is above your budget. Choose another bouquet or change your budget.`
                        : locale === "kk"
                          ? `${flowerProductName(product.id, locale)} ${formatKzt(product.priceKzt, locale)} тұрады, бұл бюджетіңізден жоғары. Басқа гүл шоғын таңдаңыз немесе бюджетіңізді өзгертіңіз.`
                          : `${flowerProductName(product.id, locale)} стоит ${formatKzt(product.priceKzt, locale)}, это выше указанного бюджета. Выберите другой букет или измените бюджет.`,
                );
            }
            const draft = { ...body.draft, productId: product.id };
            return reply(
                body,
                `${flowerProductName(product.id, locale)} — ${formatKzt(product.priceKzt, locale)}. ${flowerText(locale, "ask-budget")}`,
                "budget",
                draft,
            );
        }

        case "budget": {
            const amount = parseFlowerBudget(message);
            if (amount === undefined) {
                return reply(body, flowerText(locale, "budget-prompt"));
            }
            const product = flowerCatalog.find((item) => item.id === body.draft.productId);
            if (!product) {
                return reply(body, flowerText(locale, "restart-bouquet"), "occasion", emptyFlowerOrder);
            }
            if (amount !== null && amount < product.priceKzt) {
                return reply(
                    body,
                    flowerText(locale, "budget-too-low", {
                        amount: formatKzt(amount, locale),
                        price: formatKzt(product.priceKzt, locale),
                    }),
                    "bouquet",
                    { ...body.draft, budgetKzt: amount },
                );
            }
            return reply(
                body,
                flowerText(locale, "delivery-date"),
                "delivery",
                { ...body.draft, budgetKzt: amount },
            );
        }

        case "delivery":
            if (message.length < 2) return reply(body, flowerText(locale, "delivery-date-required"));
            return reply(
                body,
                flowerText(locale, "recipient-name"),
                "customer",
                { ...body.draft, deliveryDate: message },
            );

        case "customer":
            if (message.length < 2 || /\d{5,}/.test(message)) {
                return reply(body, flowerText(locale, "recipient-name-required"));
            }
            return reply(
                body,
                flowerText(locale, "phone-prompt"),
                "phone",
                { ...body.draft, customerName: message },
            );

        case "phone":
            if (!validFlowerPhone(message)) {
                return reply(body, flowerText(locale, "phone-invalid"));
            }
            return reply(
                body,
                flowerText(locale, "address-prompt"),
                "address",
                { ...body.draft, customerPhone: message },
            );

        case "address":
            if (message.length < 5) return reply(body, flowerText(locale, "address-required"));
            return reply(
                body,
                flowerText(locale, "payment-options"),
                "payment",
                { ...body.draft, deliveryAddress: message },
            );

        case "payment": {
            const paymentMethod: FlowerOrderDraft["paymentMethod"] =
                /^(1|наличн|при получ|cash)/i.test(message)
                    ? "cash_on_delivery"
                    : /^(2|перевод|банк|transfer|аудар)/i.test(message)
                      ? "bank_transfer"
                      : "";
            if (!paymentMethod) {
                return reply(body, flowerText(locale, "payment-required"));
            }
            const draft = { ...body.draft, paymentMethod };
            return reply(
                body,
                `${flowerText(locale, "order-review")}\n${flowerOrderSummary(draft, locale)}\n\n${flowerText(locale, "confirm-order")}`,
                "confirm",
                draft,
            );
        }

        case "confirm":
            if (/^(начать(?:\s+заново)?|start(?:\s+over|\s+again)?|бастау)$/i.test(message)) {
                return reply(
                    { ...body, draft: emptyFlowerOrder },
                    flowerText(locale, "start-over"),
                    "occasion",
                    emptyFlowerOrder,
                );
            }
            if (!isFlowerConfirmation(message)) {
                return reply(body, flowerText(locale, "not-confirmed"));
            }
            if (
                !body.draft.productId ||
                !body.draft.paymentMethod ||
                !body.draft.customerName ||
                !body.draft.customerPhone ||
                !body.draft.deliveryAddress ||
                !body.draft.deliveryDate
            ) {
                return reply(body, flowerText(locale, "incomplete-order"), "occasion", emptyFlowerOrder);
            }

            try {
                const existing = await prisma.flowerOrder.findUnique({
                    where: { idempotencyKey: body.idempotencyKey },
                    select: { id: true },
                });
                if (existing) {
                    return NextResponse.json({
                        reply: flowerText(locale, "order-already-saved", {
                            id: existing.id.slice(-8).toUpperCase(),
                        }),
                        step: "complete",
                        draft: body.draft,
                        orderId: existing.id,
                    });
                }

                const product = flowerCatalog.find((item) => item.id === body.draft.productId);
                if (!product) {
                    return NextResponse.json(
                        { error: flowerText(locale, "bouquet-unavailable") },
                        { status: 400 },
                    );
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
                    reply: flowerText(locale, "order-saved", {
                        id: order.id.slice(-8).toUpperCase(),
                    }),
                    step: "complete",
                    draft: body.draft,
                    orderId: order.id,
                });
            } catch (error) {
                console.error("Unable to save flower order.", error);
                return NextResponse.json(
                    { error: flowerText(locale, "save-order-failed") },
                    { status: 503 },
                );
            }

        case "complete":
            return reply(body, flowerText(locale, "already-placed"));
    }
}
