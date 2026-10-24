import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptTelegramToken, personalTelegramSecret, telegramApi, telegramEncryptionKey } from "@/lib/telegram";
import { isLiveAIConfigured } from "@/lib/ai";

export const runtime = "nodejs";

async function owner(request: Request, mutation = false) {
    const origin = request.headers.get("origin");
    if (mutation && origin !== new URL(request.url).origin) return { response: NextResponse.json({ error: "Подключайте бота со страницы вашего магазина." }, { status: 403 }) };
    const client = await createSupabaseServerClient();
    const auth = await client?.auth.getUser();
    if (!client || auth?.error || !auth?.data.user) return { response: NextResponse.json({ error: "Войдите в аккаунт." }, { status: 401 }) };
    const admin = createSupabaseAdminClient();
    if (!admin) return { response: NextResponse.json({ error: "Хранилище Telegram пока недоступно." }, { status: 503 }) };
    return { client, admin, ownerId: auth.data.user.id };
}

export async function GET(request: Request) {
    const auth = await owner(request);
    if (auth.response) return auth.response;
    const { data, error } = await auth.admin.from("telegram_bot_credentials")
        .select("bot_id,username,business_id").eq("owner_id", auth.ownerId).maybeSingle();
    if (error) return NextResponse.json({ error: "Не удалось загрузить персонального бота." }, { status: 503 });
    return NextResponse.json({ connection: data, personalEnabled: Boolean(telegramEncryptionKey()),
        aiEnabled: isLiveAIConfigured() },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
    const auth = await owner(request, true);
    if (auth.response) return auth.response;
    const key = telegramEncryptionKey();
    let base: URL;
    try {
        base = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
        if (base.protocol !== "https:") throw new Error();
    } catch { return NextResponse.json({ error: "Для подключения нужен публичный HTTPS-адрес сайта." }, { status: 503 }); }
    if (!key) return NextResponse.json({ error: "Подключение личных ботов ещё не настроено на сервере." }, { status: 503 });
    const access = await auth.client.rpc("has_workspace_access");
    if (access.error) return NextResponse.json({ error: "Не удалось проверить доступ." }, { status: 503 });
    if (access.data !== true) return NextResponse.json({ error: "Активируйте пробный период или подписку." }, { status: 402 });
    let token: string;
    try {
        const raw = await request.text();
        if (raw.length > 2048) throw new Error();
        const body = JSON.parse(raw);
        token = typeof body?.token === "string" ? body.token.trim() : "";
        if (!/^\d{5,16}:[A-Za-z0-9_-]{30,100}$/.test(token)) throw new Error();
    } catch { return NextResponse.json({ error: "Вставьте полный токен, полученный от @BotFather." }, { status: 400 }); }
    try {
        const bot = await telegramApi<{ id: number; username: string; is_bot: boolean }>(token, "getMe");
        if (!bot.is_bot || !Number.isSafeInteger(bot.id) || bot.id <= 0 || !/^[A-Za-z0-9_]{5,32}$/.test(bot.username)) throw new Error();
        // Prevent the common bot from being claimed as one merchant's personal bot.
        if (process.env.TELEGRAM_BOT_TOKEN?.split(":")[0] === String(bot.id)) return NextResponse.json({ error: "Это общий бот FloralAI. Создайте отдельного бота для вашего магазина." }, { status: 409 });
        const encrypted = encryptTelegramToken(token, key, `${auth.ownerId}:${bot.id}`);
        const saved = await auth.admin.rpc("connect_personal_telegram", {
            p_owner_id: auth.ownerId, p_bot_id: bot.id, p_username: bot.username, p_encrypted_token: encrypted,
        });
        if (saved.error) return NextResponse.json({ error: saved.error.code === "23505"
            ? "Бот уже подключён к другому аккаунту или у магазина уже есть другой личный бот."
            : "Сначала сохраните профиль бизнеса и проверьте доступ к Telegram." }, { status: 409 });
        const business = saved.data as { id: string; start_code: string };
        const webhook = new URL("/api/telegram/webhook", base);
        webhook.searchParams.set("bot", String(bot.id));
        await telegramApi(token, "setWebhook", { url: webhook.toString(),
            secret_token: personalTelegramSecret(key, auth.ownerId, bot.id), allowed_updates: ["message"], max_connections: 1 });
        const activated = await auth.admin.from("telegram_businesses").update({ active: true })
            .eq("id", business.id).eq("owner_id", auth.ownerId).select("id").single();
        if (activated.error) throw new Error();
        return NextResponse.json({ username: bot.username, businessId: business.id });
    } catch {
        // Telegram errors may contain credentials in their URLs. Do not log the error object.
        return NextResponse.json({ error: "Telegram не подтвердил подключение. Проверьте токен и попробуйте снова." }, { status: 502 });
    }
}

export async function PATCH(request: Request) {
    const auth = await owner(request, true);
    if (auth.response) return auth.response;
    const access = await auth.client.rpc("has_workspace_access");
    if (access.error) return NextResponse.json({ error: "Не удалось проверить доступ." }, { status: 503 });
    if (access.data !== true) return NextResponse.json({ error: "Активируйте пробный период или подписку." }, { status: 402 });
    const personal = await auth.admin.from("telegram_bot_credentials").select("business_id,username").eq("owner_id", auth.ownerId).maybeSingle();
    if (personal.error || !personal.data) return NextResponse.json({ error: "Сначала подключите личного бота." }, { status: 409 });
    const changed = await auth.admin.from("telegram_businesses").update({ active: true }).eq("id", personal.data.business_id)
        .eq("owner_id", auth.ownerId).select("id").single();
    if (changed.error) return NextResponse.json({ error: "Не удалось включить бота." }, { status: 503 });
    return NextResponse.json({ username: personal.data.username });
}
