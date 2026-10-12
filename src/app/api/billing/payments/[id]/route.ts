import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = { "Cache-Control": "private, no-store" };

function databaseError(error: { code?: string }) {
    const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : error.code === "P0001" || error.code === "23505" ? 409 : 503;
    const message = error.code === "23505" ? "Эта операция уже использована. Проверьте номер операции в Kaspi."
        : status === 400 ? "Проверьте сумму, номер банковской операции или причину отказа."
        : status === 403 ? "Недостаточно прав для изменения этой оплаты."
            : status === 409 ? "Оплата уже изменилась или действие недоступно. Обновите список."
                : "Не удалось обновить оплату. Попробуйте ещё раз.";
    if (status === 503) console.error("Unable to change subscription payment.", { code: error.code });
    return NextResponse.json({ error: message }, { status, headers: noStore });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
        return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403, headers: noStore });
    }
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Хранилище подписок пока недоступно." }, { status: 503, headers: noStore });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "Войдите, чтобы изменить оплату." }, { status: 401, headers: noStore });
    const { id } = await context.params;
    if (!uuidPattern.test(id)) return NextResponse.json({ error: "Некорректный номер заявки на оплату." }, { status: 400, headers: noStore });
    let body: unknown;
    try {
        const raw = await request.text();
        if (raw.length > 2048) return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413, headers: noStore });
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: "Не удалось прочитать действие с оплатой." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body) || !("action" in body)) {
        return NextResponse.json({ error: "Выберите действие с оплатой." }, { status: 400, headers: noStore });
    }
    const fields = Object.keys(body);
    let amount: number | null = null;
    let reference: string | null = null;
    let reason: string | null = null;
    if (body.action === "approve") {
        if (fields.length !== 3 || !("amount" in body) || !("reference" in body)
            || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount <= 0 || body.amount > 2_147_483_647
            || typeof body.reference !== "string" || body.reference.trim().length < 1 || body.reference.trim().length > 120) {
            return NextResponse.json({ error: "Укажите фактически полученную сумму и номер операции из истории Kaspi." }, { status: 400, headers: noStore });
        }
        amount = body.amount;
        reference = body.reference.trim();
    } else if (body.action === "reject") {
        if (fields.length !== 2 || !("reason" in body) || typeof body.reason !== "string"
            || body.reason.trim().length < 1 || body.reason.trim().length > 500) {
            return NextResponse.json({ error: "Укажите причину отказа длиной до 500 символов." }, { status: 400, headers: noStore });
        }
        reason = body.reason.trim();
    } else if ((body.action !== "mark_sent" && body.action !== "mark_paid") || fields.length !== 1) {
        return NextResponse.json({ error: "Недопустимое действие с оплатой." }, { status: 400, headers: noStore });
    }
    if (body.action !== "mark_paid") {
        const { data: isOperator, error } = await client.rpc("is_subscription_operator");
        if (error) return databaseError(error);
        if (isOperator !== true) return NextResponse.json({ error: "Действие доступно только администратору оплаты." }, { status: 403, headers: noStore });
    }
    // Authorization, state transitions, receipt uniqueness and subscription
    // renewal run together in the database, using auth.uid() for this session.
    const { data, error } = await client.rpc("change_subscription_payment", {
        payment_id: id,
        requested_action: body.action,
        received_amount: amount,
        payment_reference: reference,
        rejection_reason: reason,
    }).single();
    if (error) return databaseError(error);
    if (!data) return NextResponse.json({ error: "Заявка на оплату не найдена." }, { status: 404, headers: noStore });
    return NextResponse.json({ payment: data }, { headers: noStore });
}
