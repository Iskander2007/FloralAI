import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseBusinessProfile } from "@/lib/business";
import { parseSalesState, runSalesTurn, type SalesProduct } from "@/lib/sales-assistant";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Войдите в аккаунт для проверки ассистента." }, { status: 401 });
    const { data: userData, error: authError } = await client.auth.getUser();
    if (authError || !userData.user) return NextResponse.json({ error: "Войдите в аккаунт для проверки ассистента." }, { status: 401 });
    let payload: unknown;
    try {
        const raw = await request.text();
        if (raw.length > 16_384) return NextResponse.json({ error: "Сообщение слишком большое." }, { status: 413 });
        payload = JSON.parse(raw);
    } catch { return NextResponse.json({ error: "Не удалось прочитать сообщение." }, { status: 400 }); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return NextResponse.json({ error: "Не удалось прочитать сообщение." }, { status: 400 });
    const body = payload as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message || message.length > 1000) return NextResponse.json({ error: "Напишите сообщение от 1 до 1000 символов." }, { status: 400 });
    const [{ data: row, error: profileError }, { data: products, error: productsError }] = await Promise.all([
        client.from("business_profiles").select("profile").eq("owner_id", userData.user.id).maybeSingle(),
        client.from("catalog_products").select("id,name,price_kzt,description").eq("owner_id", userData.user.id).order("created_at", { ascending: false }).limit(100),
    ]);
    if (profileError || productsError) return NextResponse.json({ error: "Не удалось загрузить сохранённые данные бизнеса. Попробуйте позже." }, { status: 503 });
    const profile = parseBusinessProfile(row?.profile);
    if (!profile) return NextResponse.json({ error: "Сначала сохраните профиль бизнеса в разделе «Настройки»." }, { status: 409 });
    const turn = runSalesTurn({ message, profile, products: (products ?? []) as SalesProduct[], state: parseSalesState(body.state) });
    // This is an owner-only preview: it uses real approved information but creates no customer orders.
    if (turn.order) {
        turn.reply = "Тестовая заявка собрана. В Telegram она появится в разделе «Заявки»; этот тест не создаёт настоящую заявку.\n\n" + turn.reply;
        turn.state.orderId = "test";
    }
    return NextResponse.json({ reply: turn.reply, state: turn.state, preview: true });
}
