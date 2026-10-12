import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type TelegramApiResult<T> = {
    ok: boolean;
    result?: T;
    description?: string;
};

function getTelegramConfig() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!token || !secret || !appUrl) return null;

    let baseUrl: URL;
    try {
        baseUrl = new URL(appUrl);
    } catch {
        throw new Error("NEXT_PUBLIC_APP_URL must be a valid public HTTPS URL.");
    }
    if (
        baseUrl.protocol !== "https:" ||
        !/^[A-Za-z0-9_-]{1,256}$/.test(secret)
    ) {
        throw new Error("Telegram requires an HTTPS app URL and a valid webhook secret.");
    }
    return {
        token,
        secret,
        webhookUrl: new URL("/api/telegram/webhook", baseUrl).toString(),
    };
}

async function getBot(token: string) {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
    });
    const result = (await response.json()) as TelegramApiResult<{
        username?: string;
        is_bot?: boolean;
    }>;
    if (!response.ok || !result.ok || !result.result?.is_bot || !result.result.username) {
        throw new Error(result.description ?? "Telegram could not verify the bot token.");
    }
    return result.result;
}

export async function GET() {
    let config: ReturnType<typeof getTelegramConfig>;
    try {
        config = getTelegramConfig();
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid Telegram configuration." },
            { status: 500 },
        );
    }
    if (!config) {
        return NextResponse.json(
            { error: "Telegram bot environment variables are not configured." },
            { status: 503 },
        );
    }
    try {
        const bot = await getBot(config.token);
        return NextResponse.json({ username: bot.username });
    } catch (error) {
        console.error("Unable to verify the shared Telegram bot.", error);
        return NextResponse.json(
            { error: "Could not verify the Telegram bot. Check its Vercel configuration." },
            { status: 502 },
        );
    }
}

export async function POST() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) {
        return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
    }
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
        return NextResponse.json({ error: "Please sign in to connect Telegram." }, { status: 401 });
    }

    const [{ data: business, error: businessError }, { count: productCount, error: catalogError }, { error: orderStorageError }] = await Promise.all([
        supabase.from("business_profiles").select("profile").eq("owner_id", userData.user.id).maybeSingle(),
        supabase.from("catalog_products").select("id", { count: "exact", head: true }).eq("owner_id", userData.user.id),
        supabase.from("sales_orders").select("id", { head: true }).eq("owner_id", userData.user.id).limit(1),
    ]);
    if (businessError || catalogError || orderStorageError) return NextResponse.json({ error: "Хранилище заявок пока недоступно. Попробуйте подключить бота позже." }, { status: 503 });
    if (!business?.profile) return NextResponse.json({ error: "Сначала сохраните профиль бизнеса в разделе «Настройки»." }, { status: 409 });
    if (!productCount) return NextResponse.json({ error: "Добавьте хотя бы один товар с ценой в каталог, затем подключите Telegram." }, { status: 409 });

    let config: ReturnType<typeof getTelegramConfig>;
    try {
        config = getTelegramConfig();
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid Telegram configuration." },
            { status: 500 },
        );
    }
    if (!config) {
        return NextResponse.json(
            { error: "Telegram bot environment variables are not configured in Vercel." },
            { status: 503 },
        );
    }

    try {
        const bot = await getBot(config.token);
        const response = await fetch(`https://api.telegram.org/bot${config.token}/setWebhook`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                url: config.webhookUrl,
                secret_token: config.secret,
                allowed_updates: ["message"],
                max_connections: 1,
            }),
            signal: AbortSignal.timeout(10_000),
            cache: "no-store",
        });
        const result = (await response.json()) as TelegramApiResult<boolean>;
        if (!response.ok || !result.ok || !result.result) {
            throw new Error(result.description ?? "Telegram rejected the webhook configuration.");
        }
        return NextResponse.json({ username: bot.username });
    } catch (error) {
        console.error("Unable to configure the shared Telegram webhook.", error);
        return NextResponse.json(
            { error: "Could not connect Telegram. Check the bot settings and try again." },
            { status: 502 },
        );
    }
}
