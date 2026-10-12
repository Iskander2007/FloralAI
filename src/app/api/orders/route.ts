import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const orderColumns = "id,owner_id,business_id,chat_id,source_update_id,created_at,updated_at,status,customer_name,customer_phone,delivery_address,delivery_date,occasion,note,product_id,product_name,product_price_kzt,delivery_fee_kzt,total_kzt";
const pageSize = 50;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type OrderCursor = { created_at: string; id: string };

function parseCursor(encoded: string): OrderCursor | null {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(encoded)) return null;
    try {
        const bytes = Buffer.from(encoded, "base64url");
        if (bytes.toString("base64url") !== encoded) return null;
        const cursor: unknown = JSON.parse(bytes.toString("utf8"));
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) return null;
        const { created_at, id } = cursor as Record<string, unknown>;
        if (Object.keys(cursor).length !== 2 || typeof id !== "string" || !uuidPattern.test(id)
            || typeof created_at !== "string"
            || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(created_at)) return null;
        const timestamp = new Date(created_at);
        if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString().slice(0, 19) !== created_at.slice(0, 19)) return null;
        // Preserve PostgreSQL microseconds instead of rounding through JavaScript Date.
        return { created_at, id };
    } catch {
        return null;
    }
}
const statusTransitions: Record<string, readonly string[]> = {
    awaiting_confirmation: ["confirmed", "cancelled"],
    confirmed: ["fulfilled", "cancelled"],
    cancelled: [],
    fulfilled: [],
};

export async function GET(request?: Request) {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
        return NextResponse.json({ error: "Хранилище заказов не настроено." }, { status: 503 });
    }
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
        return NextResponse.json({ error: "Войдите, чтобы посмотреть заказы." }, { status: 401 });
    }
    const encodedCursor = request ? new URL(request.url).searchParams.get("after") : null;
    const cursor = encodedCursor === null ? null : parseCursor(encodedCursor);
    if (encodedCursor !== null && !cursor) {
        return NextResponse.json({ error: "Неверный указатель страницы. Обновите список заявок." }, { status: 400 });
    }
    let query = supabase.from("sales_orders")
        .select(orderColumns)
        .eq("owner_id", data.user.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(pageSize + 1);
    if (cursor) {
        query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
    }
    const { data: rows, error } = await query;
    if (error) {
        console.error("Unable to load business orders.", { code: error.code });
        return NextResponse.json({ error: "Не удалось загрузить заказы." }, { status: 503 });
    }
    const orders = (rows ?? []).slice(0, pageSize);
    const last = orders.at(-1);
    const nextCursor = rows && rows.length > pageSize && last
        ? Buffer.from(JSON.stringify({ created_at: last.created_at, id: last.id })).toString("base64url")
        : null;
    return NextResponse.json({ orders, nextCursor }, {
        headers: { "Cache-Control": "private, no-store" },
    });
}

export async function PATCH(request: NextRequest) {
    const origin = request.headers.get("origin");
    if (origin && origin !== request.nextUrl.origin) {
        return NextResponse.json({ error: "Запрос отправлен с другого сайта." }, { status: 403 });
    }
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
        return NextResponse.json({ error: "Хранилище заказов не настроено." }, { status: 503 });
    }
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) {
        return NextResponse.json({ error: "Войдите, чтобы изменить заказ." }, { status: 401 });
    }
    let body: unknown;
    try {
        const text = await request.text();
        if (text.length > 1024) {
            return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
        }
        body = JSON.parse(text);
    } catch {
        return NextResponse.json({ error: "Неверный формат запроса." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
        return NextResponse.json({ error: "Укажите заказ и статус." }, { status: 400 });
    }
    const { id, status } = body as Record<string, unknown>;
    if (typeof id !== "string" || !uuidPattern.test(id)
        || typeof status !== "string" || !Object.hasOwn(statusTransitions, status)) {
        return NextResponse.json({ error: "Укажите корректный заказ и статус." }, { status: 400 });
    }
    const { data: current, error: readError } = await supabase.from("sales_orders")
        .select("id,status").eq("id", id).eq("owner_id", data.user.id).maybeSingle();
    if (readError) {
        console.error("Unable to read business order.", { code: readError.code });
        return NextResponse.json({ error: "Не удалось прочитать заказ." }, { status: 503 });
    }
    if (!current) return NextResponse.json({ error: "Заказ не найден." }, { status: 404 });
    if (status !== current.status && !statusTransitions[current.status]?.includes(status)) {
        return NextResponse.json({ error: "Этот переход статуса недоступен." }, { status: 409 });
    }
    const { data: order, error } = await supabase.from("sales_orders")
        .update({ status }).eq("id", id).eq("owner_id", data.user.id).eq("status", current.status)
        .select(orderColumns).maybeSingle();
    if (error) {
        console.error("Unable to update business order status.", { code: error.code });
        return NextResponse.json({ error: "Не удалось изменить статус." }, { status: 503 });
    }
    if (!order) {
        return NextResponse.json({ error: "Статус уже изменился. Обновите список заказов." }, { status: 409 });
    }
    return NextResponse.json({ order }, { headers: { "Cache-Control": "private, no-store" } });
}
