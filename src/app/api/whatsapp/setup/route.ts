import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getWhatsAppConfig, digestNonce } from "@/lib/whatsapp";
import { whatsappAccess, whatsappBody, whatsappOwner, whatsappPublicColumns } from "@/lib/whatsapp-server";
import { parseBusinessProfile } from "@/lib/business";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const auth = await whatsappOwner(request);
    if (auth.response) return auth.response;
    const config = getWhatsAppConfig();
    const { data: connection, error } = await auth.admin.from("whatsapp_connections")
        .select(whatsappPublicColumns).eq("owner_id", auth.ownerId).maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось загрузить подключение WhatsApp." }, { status: 503 });
    return NextResponse.json({ available: !!config, connection, coexistence: config?.coexistence ?? false,
        replyMode: process.env.USE_MOCK_AI === "false" && process.env.OPENAI_API_KEY ? "ai" : "faq" }, {
        headers: { "Cache-Control": "private, no-store" },
    });
}

export async function POST(request: Request) {
    const auth = await whatsappOwner(request, true);
    if (auth.response) return auth.response;
    const denied = await whatsappAccess(auth.client);
    if (denied) return denied;
    const config = getWhatsAppConfig();
    if (!config) return NextResponse.json({ error: "Подключение через Meta ещё готовится. Повторите попытку позже." }, { status: 503 });
    let body: Record<string, unknown>;
    try { body = await whatsappBody(request); }
    catch { return NextResponse.json({ error: "Неверный запрос подключения." }, { status: 400 }); }
    const mode = body.mode;
    if (mode !== "cloud" && mode !== "coexistence" || mode === "coexistence" && !config.coexistence) {
        return NextResponse.json({ error: "Этот способ подключения пока недоступен." }, { status: 400 });
    }
    const profile = await auth.client.from("business_profiles").select("profile").eq("owner_id", auth.ownerId).maybeSingle();
    if (profile.error) return NextResponse.json({ error: "Не удалось проверить профиль бизнеса." }, { status: 503 });
    if (!parseBusinessProfile(profile.data?.profile)) return NextResponse.json({ error: "Сначала сохраните название и данные бизнеса в настройках." }, { status: 409 });
    const nonce = randomBytes(32).toString("hex");
    // One short-lived attempt per owner. A new start invalidates the previous popup.
    const { error } = await auth.admin.from("whatsapp_signup_attempts").upsert({
        owner_id: auth.ownerId, nonce_hash: digestNonce(nonce), mode, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }, { onConflict: "owner_id" });
    if (error) return NextResponse.json({ error: "Не удалось начать подключение. Попробуйте позже." }, { status: 503 });
    return NextResponse.json({ nonce, appId: config.appId, configId: config.configId, version: config.version }, {
        headers: { "Cache-Control": "private, no-store" },
    });
}

export async function PATCH(request: Request) {
    const auth = await whatsappOwner(request, true);
    if (auth.response) return auth.response;
    let body: Record<string, unknown>;
    try { body = await whatsappBody(request); }
    catch { return NextResponse.json({ error: "Неверный запрос." }, { status: 400 }); }
    if (typeof body.active !== "boolean") return NextResponse.json({ error: "Укажите состояние бота." }, { status: 400 });
    if (body.active) {
        const denied = await whatsappAccess(auth.client);
        if (denied) return denied;
        if (!getWhatsAppConfig()) return NextResponse.json({ error: "Подключение WhatsApp пока недоступно." }, { status: 503 });
    }
    const current = await auth.admin.from("whatsapp_connections").select("id,token_ciphertext,token_expires_at,connected_at")
        .eq("owner_id", auth.ownerId).maybeSingle();
    if (current.error) return NextResponse.json({ error: "Не удалось загрузить подключение." }, { status: 503 });
    if (!current.data) return NextResponse.json({ error: "Сначала подключите номер через Meta." }, { status: 409 });
    if (body.active && (!current.data.connected_at || !current.data.token_ciphertext
        || current.data.token_expires_at && new Date(current.data.token_expires_at).getTime() <= Date.now())) {
        return NextResponse.json({ error: "Обновите подключение номера через Meta." }, { status: 409 });
    }
    const result = await auth.admin.from("whatsapp_connections").update({ active: body.active })
        .eq("owner_id", auth.ownerId).eq("id", current.data.id).select(whatsappPublicColumns).single();
    if (result.error) return NextResponse.json({ error: "Не удалось изменить состояние бота." }, { status: 503 });
    return NextResponse.json({ connection: result.data });
}
