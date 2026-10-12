import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { AssistantProduct } from "@/lib/catalog";

export const runtime = "nodejs";

type TelegramMessage = {
    chat: { id: number; type: string };
    text?: string;
};

type TelegramUpdate = {
    update_id: number;
    message?: TelegramMessage;
};

type TelegramBusiness = {
    id: string;
    owner_id: string;
    business_name: string;
};

function hasValidWebhookSecret(request: NextRequest, secret: string) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (!provided) return false;
    const expectedBytes = Buffer.from(secret);
    const providedBytes = Buffer.from(provided);
    return (
        expectedBytes.length === providedBytes.length &&
        timingSafeEqual(expectedBytes, providedBytes)
    );
}

async function sendTelegramMessage(chatId: number, text: string) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: text.slice(0, 4000),
            link_preview_options: { is_disabled: true },
        }),
        signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { ok?: boolean; description?: string };
    if (!response.ok || !result.ok) {
        throw new Error(`Telegram sendMessage failed: ${result.description ?? response.status}`);
    }
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
    if (!value || typeof value !== "object") return false;
    const update = value as Record<string, unknown>;
    if (
        !Number.isSafeInteger(update.update_id) ||
        !update.message ||
        typeof update.message !== "object"
    ) {
        return false;
    }
    const message = update.message as Record<string, unknown>;
    if (!message.chat || typeof message.chat !== "object") return false;
    const chat = message.chat as Record<string, unknown>;
    return (
        Number.isSafeInteger(chat.id) &&
        typeof chat.type === "string" &&
        (message.text === undefined || typeof message.text === "string")
    );
}

function getReply(
    message: string,
    businessName: string,
    products: AssistantProduct[],
) {
    const text = message.trim().toLocaleLowerCase();
    const russian = /[а-яё]/i.test(text);
    const kazakh = /[әіңғүұқөһ]/i.test(text);
    const isKazakh = kazakh;

    if (/^\/(?:catalog|products)(?:@\w+)?(?:\s|$)/i.test(text) ||
        /catalog|products|ассортимент|каталог|товар|букет|гүлдер тізімі/i.test(text)) {
        if (products.length === 0) {
            return isKazakh
                ? `${businessName} әзірге каталогқа гүл қоспады.`
                : russian
                  ? `${businessName} пока не добавил товары в каталог.`
                  : `${businessName} has not added any products to the catalog yet.`;
        }
        const title = isKazakh
            ? `${businessName} каталогы:`
            : russian
              ? `Каталог ${businessName}:`
              : `${businessName} product catalog:`;
        const lines = products.slice(0, 20).map((product) =>
            `• ${product.name} — ${new Intl.NumberFormat(
                isKazakh ? "kk-KZ" : russian ? "ru-RU" : "en-US",
            ).format(product.price_kzt)} ₸${product.description ? `\n  ${product.description}` : ""}`,
        );
        return `${title}\n\n${lines.join("\n\n")}`;
    }

    const matchedProduct = products.find((product) =>
        text.includes(product.name.toLocaleLowerCase()),
    );
    if (matchedProduct) {
        return `${matchedProduct.name} — ${new Intl.NumberFormat(
            isKazakh ? "kk-KZ" : russian ? "ru-RU" : "en-US",
        ).format(matchedProduct.price_kzt)} ₸${matchedProduct.description ? `\n${matchedProduct.description}` : ""}`;
    }

    if (/price|cost|how much|цен|стоим|сколько|баға/i.test(text)) {
        return isKazakh
            ? "Бағаларды көру үшін /catalog деп жазыңыз."
            : russian
              ? "Напишите /catalog, чтобы посмотреть товары и цены."
              : "Send /catalog to see products and prices.";
    }

    return isKazakh
        ? `${businessName} дүкеніне қош келдіңіз! Өнімдер мен бағаларды көру үшін /catalog деп жазыңыз.`
        : russian
          ? `Здравствуйте! Это бот магазина «${businessName}». Напишите /catalog, чтобы посмотреть букеты и цены.`
          : `Welcome to ${businessName}! Send /catalog to see available flowers and prices.`;
}

async function saveReply(
    chatId: number,
    updateId: number,
    businessId: string,
    reply: string,
) {
    const admin = createSupabaseAdminClient();
    if (!admin) throw new Error("Supabase service role is not configured");
    const { error } = await admin.from("telegram_chats").upsert(
        {
            chat_id: String(chatId),
            business_id: businessId,
            last_update_id: updateId,
            last_reply: reply,
        },
        { onConflict: "chat_id" },
    );
    if (error) throw error;
}

export async function POST(request: NextRequest) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!token || !webhookSecret) {
        return NextResponse.json({ error: "Telegram bot is not configured." }, { status: 503 });
    }
    if (!hasValidWebhookSecret(request, webhookSecret)) {
        return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
    }

    let rawBody: string;
    try {
        rawBody = await request.text();
    } catch {
        return NextResponse.json({ error: "Unable to read update." }, { status: 400 });
    }
    if (rawBody.length > 8_192) {
        return NextResponse.json({ error: "Update is too large." }, { status: 413 });
    }

    let payload: unknown;
    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
    }
    if (!isTelegramUpdate(payload)) {
        return NextResponse.json({ error: "Invalid Telegram update." }, { status: 400 });
    }

    const message = payload.message;
    if (!message || message.chat.type !== "private" || !message.text) {
        return NextResponse.json({ ok: true });
    }
    if (message.text.length > 500) {
        try {
            await sendTelegramMessage(
                message.chat.id,
                "Сообщение слишком длинное. Напишите короче.",
            );
        } catch (error) {
            console.error("Unable to reply to Telegram message.", error);
            return NextResponse.json({ error: "Unable to send Telegram reply." }, { status: 503 });
        }
        return NextResponse.json({ ok: true });
    }

    const admin = createSupabaseAdminClient();
    if (!admin) {
        console.error("Telegram webhook requires SUPABASE_SERVICE_ROLE_KEY.");
        return NextResponse.json({ error: "Telegram storage is not configured." }, { status: 503 });
    }

    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+([A-Za-z0-9-]{32,64}))?(?:\s|$)/i);

    try {
        let business: TelegramBusiness | null = null;
        if (startMatch?.[1]) {
            const { data, error } = await admin
                .from("telegram_businesses")
                .select("id, owner_id, business_name")
                .eq("start_code", startMatch[1])
                .eq("active", true)
                .maybeSingle();
            if (error) throw error;
            business = data as TelegramBusiness | null;
            if (!business) {
                await sendTelegramMessage(
                    message.chat.id,
                    "Эта ссылка магазина недействительна или бот приостановлен. Попросите у магазина новую ссылку.",
                );
                return NextResponse.json({ ok: true });
            }
        } else {
            const { data: chat, error: chatError } = await admin
                .from("telegram_chats")
                .select("business_id, last_update_id, last_reply")
                .eq("chat_id", chatId)
                .maybeSingle();
            if (chatError) throw chatError;

            if (chat && payload.update_id <= Number(chat.last_update_id)) {
                if (chat.last_reply) await sendTelegramMessage(message.chat.id, chat.last_reply);
                return NextResponse.json({ ok: true });
            }
            if (chat) {
                const { data, error } = await admin
                    .from("telegram_businesses")
                    .select("id, owner_id, business_name")
                    .eq("id", chat.business_id)
                    .eq("active", true)
                    .maybeSingle();
                if (error) throw error;
                business = data as TelegramBusiness | null;
            }
        }

        if (!business) {
            await sendTelegramMessage(
                message.chat.id,
                "Чтобы начать, откройте ссылку Telegram, которую вам прислал магазин.",
            );
            return NextResponse.json({ ok: true });
        }

        const { data: productRows, error: productsError } = await admin
            .from("catalog_products")
            .select("name, price_kzt, description")
            .eq("owner_id", business.owner_id)
            .order("created_at", { ascending: false })
            .limit(20);
        if (productsError) throw productsError;

        const products = (productRows ?? []) as AssistantProduct[];
        const reply = startMatch?.[1]
            ? getReply("/start", business.business_name, products)
            : getReply(text, business.business_name, products);
        await saveReply(message.chat.id, payload.update_id, business.id, reply);
        await sendTelegramMessage(message.chat.id, reply);
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Unable to process shared Telegram business message.", error);
        return NextResponse.json(
            { error: "Unable to process Telegram message." },
            { status: 503 },
        );
    }
}
