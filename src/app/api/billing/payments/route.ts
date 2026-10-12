import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const paymentColumns = "id,owner_id,owner_email,plan,billing_cycle,amount_kzt,kaspi_phone,status,bank_reference,rejection_reason,created_at,updated_at,approved_at";
const noStore = { "Cache-Control": "private, no-store" };

function databaseError(error: { code?: string }) {
    const status = error.code === "22023" ? 400 : error.code === "42501" ? 403 : error.code === "P0001" || error.code === "23505" ? 409 : 503;
    const message = status === 400 ? "Проверьте тариф, период и номер телефона Kaspi."
        : status === 403 ? "Недостаточно прав для работы с оплатой."
            : status === 409 ? "Заявка на оплату уже изменилась. Обновите страницу."
                : "Не удалось обработать оплату. Попробуйте ещё раз.";
    if (status === 503) console.error("Unable to process subscription payment request.", { code: error.code });
    return NextResponse.json({ error: message }, { status, headers: noStore });
}

function normalizePhone(value: unknown) {
    if (typeof value !== "string" || value.length > 40) return null;
    let phone = value.replace(/[\s()-]/g, "");
    if (/^[78]\d{10}$/.test(phone)) phone = `+7${phone.slice(1)}`;
    return /^\+7\d{10}$/.test(phone) ? phone : null;
}

export async function GET(request: Request) {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Хранилище подписок пока недоступно." }, { status: 503, headers: noStore });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401, headers: noStore });
    const { data: isOperator, error: operatorError } = await client.rpc("is_subscription_operator");
    if (operatorError) return databaseError(operatorError);
    if (isOperator !== true) return NextResponse.json({ error: "Раздел доступен только администратору оплаты." }, { status: 403, headers: noStore });
    const status = new URL(request.url).searchParams.get("status") ?? "open";
    if (status !== "open" && status !== "all") return NextResponse.json({ error: "Выберите открытые заявки или всю историю." }, { status: 400, headers: noStore });
    let query = client.from("subscription_payment_requests").select(paymentColumns)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(100);
    if (status === "open") query = query.in("status", ["requested", "invoice_sent", "verification_requested"]);
    const { data, error } = await query;
    if (error) return databaseError(error);
    return NextResponse.json({ payments: data ?? [], limit: 100 }, { headers: noStore });
}

export async function POST(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
        return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403, headers: noStore });
    }
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Хранилище подписок пока недоступно." }, { status: 503, headers: noStore });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "Войдите, чтобы запросить счёт Kaspi." }, { status: 401, headers: noStore });
    let body: unknown;
    try {
        const raw = await request.text();
        if (raw.length > 2048) return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413, headers: noStore });
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: "Не удалось прочитать данные оплаты." }, { status: 400, headers: noStore });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 3 || !("plan" in body) || !("cycle" in body) || !("phone" in body)
        || (body.plan !== "starter" && body.plan !== "business")
        || (body.cycle !== "monthly" && body.cycle !== "annual")) {
        return NextResponse.json({ error: "Выберите тариф, период оплаты и укажите номер Kaspi." }, { status: 400, headers: noStore });
    }
    const phone = normalizePhone(body.phone);
    if (!phone) return NextResponse.json({ error: "Укажите номер Kaspi в формате +7 700 123 45 67." }, { status: 400, headers: noStore });
    // The authenticated database function fixes the owner and price and reuses
    // an existing open request. The browser cannot choose an amount or paid state.
    const { data, error } = await client.rpc("request_subscription_payment", {
        requested_plan: body.plan,
        requested_cycle: body.cycle,
        customer_phone: phone,
    }).single();
    if (error) return databaseError(error);
    if (!data) return NextResponse.json({ error: "Не удалось создать заявку на оплату." }, { status: 503, headers: noStore });
    return NextResponse.json({ payment: data }, { headers: noStore });
}
