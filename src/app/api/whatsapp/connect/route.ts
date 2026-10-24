import { NextResponse } from "next/server";
import { digestNonce, encryptWhatsAppToken, getWhatsAppConfig, whatsAppGraph } from "@/lib/whatsapp";
import { whatsappAccess, whatsappBody, whatsappOwner, whatsappPublicColumns } from "@/lib/whatsapp-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
    const auth = await whatsappOwner(request, true);
    if (auth.response) return auth.response;
    const denied = await whatsappAccess(auth.client);
    if (denied) return denied;
    const config = getWhatsAppConfig();
    if (!config) return NextResponse.json({ error: "Подключение WhatsApp ещё не настроено." }, { status: 503 });
    let body: Record<string, unknown>;
    try { body = await whatsappBody(request); }
    catch { return NextResponse.json({ error: "Не удалось прочитать ответ подключения." }, { status: 400 }); }
    if (typeof body.code !== "string" || !body.code || body.code.length > 4096
        || typeof body.nonce !== "string" || !/^[a-f0-9]{64}$/.test(body.nonce)
        || typeof body.wabaId !== "string" || !/^\d{1,30}$/.test(body.wabaId)
        || body.phoneId !== undefined && (typeof body.phoneId !== "string" || !/^\d{1,30}$/.test(body.phoneId))) {
        return NextResponse.json({ error: "Meta не вернула данные номера. Повторите подключение." }, { status: 400 });
    }
    const attempt = await auth.admin.from("whatsapp_signup_attempts").delete()
        .eq("owner_id", auth.ownerId).eq("nonce_hash", digestNonce(body.nonce))
        .gt("expires_at", new Date().toISOString()).select("mode").maybeSingle();
    if (attempt.error) return NextResponse.json({ error: "Не удалось проверить подключение." }, { status: 503 });
    if (!attempt.data) return NextResponse.json({ error: "Попытка подключения истекла или уже использована. Начните заново." }, { status: 409 });
    if (attempt.data.mode === "cloud" && (typeof body.pin !== "string" || !/^\d{6}$/.test(body.pin))) {
        return NextResponse.json({ error: "Задайте шестизначный PIN для защиты номера." }, { status: 400 });
    }
    try {
        // Authorization code exchange is server-only. App secret and access tokens never reach the browser.
        const tokenResponse = await fetch(`https://graph.facebook.com/${config.version}/oauth/access_token`, {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, code: body.code }),
            cache: "no-store", signal: AbortSignal.timeout(12_000),
        });
        const tokenResult = await tokenResponse.json();
        if (!tokenResponse.ok || typeof tokenResult.access_token !== "string") throw new Error("Token exchange failed");
        const token: string = tokenResult.access_token;
        const debug = await whatsAppGraph<{ data: { is_valid: boolean; app_id: string; expires_at?: number; scopes?: string[] } }>(
            config, `debug_token?input_token=${encodeURIComponent(token)}`, `${config.appId}|${config.appSecret}`,
        );
        if (!debug.data.is_valid || debug.data.app_id !== config.appId
            || !debug.data.scopes?.includes("whatsapp_business_messaging") || !debug.data.scopes?.includes("whatsapp_business_management")) {
            throw new Error("Invalid token permissions");
        }
        const waba = await whatsAppGraph<{ id: string }>(config, `${body.wabaId}?fields=id`, token);
        if (waba.id !== body.wabaId) throw new Error("Account access not granted");
        type Phone = { id: string; display_phone_number: string; verified_name?: string };
        let phone: Phone | undefined, after: string | undefined;
        for (let page = 0; page < 10; page++) {
            const phones: { data: Phone[]; paging?: { cursors?: { after?: string }; next?: string } } = await whatsAppGraph(config,
                `${body.wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, token);
            // FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING may only supply a WABA. Never guess among multiple numbers.
            if (!body.phoneId && (phones.data.length !== 1 || phones.paging?.next)) throw new Error("Select one phone number");
            phone = phones.data.find((item) => body.phoneId ? item.id === body.phoneId : true);
            if (phone || !phones.paging?.next) break;
            after = phones.paging.cursors?.after;
            if (!after) break;
        }
        if (!phone) throw new Error("Number does not belong to the authorized account");
        const existing = await auth.admin.from("whatsapp_connections").select("id,phone_number_id,waba_id")
            .eq("owner_id", auth.ownerId).maybeSingle();
        if (existing.error) throw new Error("Storage unavailable");
        if (existing.data && (existing.data.phone_number_id !== phone.id || existing.data.waba_id !== body.wabaId)) {
            return NextResponse.json({ error: "Для этого бизнеса уже подключён другой номер. Сейчас поддерживается один номер на бизнес." }, { status: 409 });
        }
        const expiry = debug.data.expires_at ? new Date(debug.data.expires_at * 1000).toISOString() : null;
        if (expiry && new Date(expiry).getTime() <= Date.now()) throw new Error("Expired token");
        // Reserve the number before changing its Meta subscription. Unique constraint prevents cross-owner reassignment.
        const reserved = await auth.admin.from("whatsapp_connections").upsert({
            owner_id: auth.ownerId, waba_id: body.wabaId, phone_number_id: phone.id,
            display_phone: phone.display_phone_number, verified_name: phone.verified_name ?? "",
            token_ciphertext: encryptWhatsAppToken(token, config.encryptionKey, `${auth.ownerId}:${phone.id}`),
            token_expires_at: expiry, active: false, connected_at: null,
        }, { onConflict: "owner_id" }).select("id").single();
        if (reserved.error) throw new Error("Number reservation failed");
        const subscribed = await whatsAppGraph<{ success: boolean | string }>(config, `${body.wabaId}/subscribed_apps`, token, {});
        if (subscribed.success !== true && subscribed.success !== "true") throw new Error("Subscription failed");
        if (attempt.data.mode === "cloud") {
            const registered = await whatsAppGraph<{ success: boolean | string }>(config, `${phone.id}/register`, token,
                { messaging_product: "whatsapp", pin: body.pin });
            if (registered.success !== true && registered.success !== "true") throw new Error("Registration failed");
        }
        const connected = await auth.admin.from("whatsapp_connections").update({ active: true, connected_at: new Date().toISOString() })
            .eq("id", reserved.data.id).eq("owner_id", auth.ownerId).select(whatsappPublicColumns).single();
        if (connected.error) throw new Error("Activation failed");
        return NextResponse.json({ connection: connected.data });
    } catch {
        return NextResponse.json({ error: "Не удалось завершить подключение. Проверьте разрешения Meta и PIN номера, затем повторите попытку. Бот не активирован." }, { status: 502 });
    }
}
