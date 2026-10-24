import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseBusinessProfile, type BusinessProfile } from "@/lib/business";
import { emptySalesState, parseSalesState, type SalesProduct, type SalesTurn } from "@/lib/sales-assistant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runTelegramTurn, telegramHistory } from "@/lib/telegram-assistant";
import { decryptTelegramToken, personalTelegramSecret, telegramEncryptionKey } from "@/lib/telegram";

export const runtime = "nodejs";
export const maxDuration = 60;

type CatalogPhoto = { photo: string; caption: string };

function catalogPhotoBase() {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return null;
    try {
        const base = new URL(url);
        return base.protocol === "https:" ? `${base.origin}/storage/v1/object/public/product-images/` : null;
    } catch { return null; }
}

function catalogPhotos(turn: SalesTurn, ownerId: string): CatalogPhoto[] {
    const base = catalogPhotoBase();
    if (!base) return [];
    return (turn.catalogItems ?? []).flatMap(({ product, number }) => {
        const path = product.image_path;
        // Only this merchant's uploaded catalog photos; never arbitrary external URLs.
        if (!path || !path.startsWith(`${ownerId}/`) || !/^[a-f0-9-]+\/[a-f0-9-]+\.(?:jpe?g|png|webp|gif)$/i.test(path)) return [];
        return [{ photo: base + path, caption: `${number}. ${product.name.replace(/\s+/g, " ").slice(0, 120)} — ${new Intl.NumberFormat("ru-RU").format(product.price_kzt)} ₸${product.description ? `\n${product.description.slice(0, 300)}` : ""}` }];
    });
}

function storedCatalogPhotos(state: unknown): CatalogPhoto[] {
    const base = catalogPhotoBase();
    if (!base || !state || typeof state !== "object") return [];
    const photos = (state as Record<string, unknown>).telegramCatalog;
    if (!Array.isArray(photos) || photos.length > 8) return [];
    return photos.filter((photo): photo is CatalogPhoto => photo && typeof photo.photo === "string"
        && photo.photo.startsWith(base) && /^[a-f0-9-]+\/[a-f0-9-]+\.(?:jpe?g|png|webp|gif)$/i.test(photo.photo.slice(base.length))
        && typeof photo.caption === "string" && photo.caption.length <= 1024);
}

async function sendTelegramReply(chatId: number, text: string, state?: unknown, token = process.env.TELEGRAM_BOT_TOKEN) {
    const photos = storedCatalogPhotos(state);
    let photoUnavailable = false;
    if (photos.length) {
        const method = photos.length === 1 ? "sendPhoto" : "sendMediaGroup";
        const body = photos.length === 1 ? { chat_id: chatId, ...photos[0] }
            : { chat_id: chatId, media: photos.map(({ photo, caption }) => ({ type: "photo", media: photo, caption })) };
        const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
        });
        const result = await response.json() as { ok?: boolean };
        if (!response.ok || !result.ok) {
            // A removed/unsupported photo must not block checkout. Retry transient Telegram failures.
            if (response.status === 400) photoUnavailable = true;
            else throw new Error("Telegram catalog delivery failed");
        }
    }
    await sendTelegramMessage(chatId, photoUnavailable ? `${text.slice(0, 3850)}\n\nФото сейчас недоступны. Можно выбрать букет по названию или номеру.` : text, token);
}

type TelegramMessage = { chat: { id: number; type: string }; text?: string };
type TelegramUpdate = { update_id: number; message?: TelegramMessage };
type TelegramBusiness = { id: string; owner_id: string; business_name: string };
type ChatSnapshot = {
    business_id: string;
    last_update_id: number | string;
    last_reply: string;
    state: unknown;
    revision: number | string;
};
type CommitResult = {
    outcome: "committed" | "duplicate" | "stale" | "conflict" | "quote_changed" | "inactive";
    reply?: string;
};

function hasValidWebhookSecret(request: NextRequest, secret: string) {
    const provided = request.headers.get("x-telegram-bot-api-secret-token");
    if (!provided) return false;
    const expectedBytes = Buffer.from(secret);
    const providedBytes = Buffer.from(provided);
    return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

async function sendTelegramMessage(chatId: number, text: string, token = process.env.TELEGRAM_BOT_TOKEN) {
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
    const result = (await response.json()) as { ok?: boolean };
    // Never include the request URL/token or customer text in logs.
    if (!response.ok || !result.ok) throw new Error("Telegram reply was rejected");
}

function isTelegramUpdate(value: unknown): value is TelegramUpdate {
    if (!value || typeof value !== "object") return false;
    const update = value as Record<string, unknown>;
    if (!Number.isSafeInteger(update.update_id) || Number(update.update_id) < 0) return false;
    // Telegram can deliver other update types; acknowledging them prevents endless retries.
    if (update.message === undefined) return true;
    if (!update.message || typeof update.message !== "object") return false;
    const message = update.message as Record<string, unknown>;
    if (!message.chat || typeof message.chat !== "object") return false;
    const chat = message.chat as Record<string, unknown>;
    return Number.isSafeInteger(chat.id) && typeof chat.type === "string"
        && (message.text === undefined || typeof message.text === "string");
}

function fallbackProfile(name: string): BusinessProfile {
    return {
        name, category: "Retail & online shop", description: "", location: "", hours: "", phone: "",
        language: "Russian", tone: "Friendly", services: [], deliveryFeeKzt: null, acceptOrdersOffline: false,
    };
}

export async function POST(request: NextRequest) {
    const aiDeadline = Date.now() + 25_000;
    let token = process.env.TELEGRAM_BOT_TOKEN;
    let webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    let personalBusinessId: string | null = null;
    let botId = 0;
    const botParam = new URL(request.url).searchParams.get("bot");
    const admin = createSupabaseAdminClient();
    if (botParam !== null) {
        if (!/^[1-9]\d{4,15}$/.test(botParam) || !Number.isSafeInteger(Number(botParam))) return NextResponse.json({ error: "Invalid bot." }, { status: 400 });
        const key = telegramEncryptionKey();
        if (!admin || !key) return NextResponse.json({ error: "Telegram storage is not configured." }, { status: 503 });
        try {
            const { data: credential, error } = await admin.from("telegram_bot_credentials")
                .select("owner_id,business_id,encrypted_token").eq("bot_id", botParam).maybeSingle();
            if (error) throw new Error();
            if (!credential) return NextResponse.json({ error: "Unknown bot." }, { status: 404 });
            webhookSecret = personalTelegramSecret(key, credential.owner_id, botParam);
            if (!hasValidWebhookSecret(request, webhookSecret)) return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
            token = decryptTelegramToken(credential.encrypted_token, key, `${credential.owner_id}:${botParam}`);
            personalBusinessId = credential.business_id;
            botId = Number(botParam);
        } catch { return NextResponse.json({ error: "Unable to load Telegram connection." }, { status: 503 }); }
    }
    if (!token || !webhookSecret) {
        return NextResponse.json({ error: "Telegram bot is not configured." }, { status: 503 });
    }
    if (!hasValidWebhookSecret(request, webhookSecret)) {
        return NextResponse.json({ error: "Invalid webhook secret." }, { status: 401 });
    }
    let payload: unknown;
    try {
        const rawBody = await request.text();
        if (rawBody.length > 16_384) {
            return NextResponse.json({ error: "Update is too large." }, { status: 413 });
        }
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid Telegram JSON." }, { status: 400 });
    }
    if (!isTelegramUpdate(payload)) {
        return NextResponse.json({ error: "Invalid Telegram update." }, { status: 400 });
    }
    const message = payload.message;
    if (!message || message.chat.type !== "private" || !message.text?.trim()) {
        return NextResponse.json({ ok: true });
    }
    if (!admin) {
        return NextResponse.json({ error: "Telegram storage is not configured." }, { status: 503 });
    }
    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const startCommand = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i);
    const sendMessage = (id: number, reply: string) => sendTelegramMessage(id, reply, token);
    const sendReply = (id: number, reply: string, state?: unknown) => sendTelegramReply(id, reply, state, token);
    try {
        if (text.length > 2000) {
            await sendMessage(message.chat.id, "Сообщение слишком длинное. Напишите, пожалуйста, короче — до 2000 символов.");
            return NextResponse.json({ ok: true });
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const { data: chatData, error: chatError } = await admin.from("telegram_chats")
                .select("business_id,last_update_id,last_reply,state,revision").eq("bot_id", botId).eq("chat_id", chatId).maybeSingle();
            if (chatError) throw new Error("Unable to read Telegram chat");
            const chat = chatData as ChatSnapshot | null;
            if (chat && payload.update_id < Number(chat.last_update_id)) return NextResponse.json({ ok: true });
            if (chat && payload.update_id === Number(chat.last_update_id)) {
                if (chat.last_reply) await sendReply(message.chat.id, chat.last_reply, chat.state);
                return NextResponse.json({ ok: true });
            }
            let businessQuery = admin.from("telegram_businesses").select("id,owner_id,business_name").eq("active", true);
            if (personalBusinessId) {
                businessQuery = businessQuery.eq("id", personalBusinessId);
            } else if (startCommand?.[1]) {
                if (!/^[A-Za-z0-9-]{32,64}$/.test(startCommand[1])) {
                    await sendMessage(message.chat.id, "Ссылка магазина недействительна. Попросите у магазина новую ссылку Telegram.");
                    return NextResponse.json({ ok: true });
                }
                businessQuery = businessQuery.eq("start_code", startCommand[1]);
            } else if (chat) {
                businessQuery = businessQuery.eq("id", chat.business_id);
            } else {
                await sendMessage(message.chat.id, "Чтобы начать, откройте ссылку Telegram, которую вам прислал магазин.");
                return NextResponse.json({ ok: true });
            }
            const { data: businessData, error: businessError } = await businessQuery.maybeSingle();
            if (businessError) throw new Error("Unable to read Telegram business");
            const business = businessData as TelegramBusiness | null;
            if (!business) {
                await sendMessage(message.chat.id, "Ссылка магазина недействительна или бот приостановлен. Попросите у магазина новую ссылку.");
                return NextResponse.json({ ok: true });
            }
            if (!personalBusinessId) {
                const personal = await admin.from("telegram_bot_credentials").select("bot_id").eq("business_id", business.id).maybeSingle();
                if (personal.error) throw new Error("Unable to check Telegram connection");
                if (personal.data) {
                    await sendMessage(message.chat.id, "У этого магазина теперь собственный Telegram-бот. Попросите у магазина актуальную ссылку.");
                    return NextResponse.json({ ok: true });
                }
            }
            const access = await admin.rpc("business_has_paid_access", { business_owner: business.owner_id });
            if (access.error || typeof access.data !== "boolean") throw new Error("Unable to check business subscription");
            if (!access.data) {
                await sendMessage(message.chat.id, "Магазин временно не принимает новые заявки через бота. Свяжитесь с магазином напрямую.");
                return NextResponse.json({ ok: true });
            }
            const [profileResult, productResult] = await Promise.all([
                admin.from("business_profiles").select("profile").eq("owner_id", business.owner_id).maybeSingle(),
                admin.from("catalog_products").select("id,name,price_kzt,description,image_path")
                    .eq("owner_id", business.owner_id).order("created_at", { ascending: false }).limit(100),
            ]);
            if (profileResult.error || productResult.error) throw new Error("Unable to load business sales information");
            const storedProfile = profileResult.data?.profile ?? null;
            const profile = parseBusinessProfile(storedProfile) ?? fallbackProfile(business.business_name);
            const products = (productResult.data ?? []) as SalesProduct[];
            // A new deep link always starts a fresh draft; another shop's customer data cannot follow it.
            const state = !chat || startCommand || chat.business_id !== business.id
                ? emptySalesState() : parseSalesState(chat.state);
            const resetHistory = /^\/(?:new|cancel)(?:@\w+)?$|^(?:начать(?: заново)?|новый заказ|отмена|отменить)$/i.test(text);
            const history = !chat || startCommand || resetHistory || chat.business_id !== business.id ? [] : telegramHistory(chat.state);
            if (history.at(-1)?.role === "assistant" && chat?.last_reply) history[history.length - 1] = { role: "assistant", content: chat.last_reply };
            const turn = await runTelegramTurn({ message: startCommand ? "/start" : text, profile, products, state, history, aiDeadline });
            // Persist captions/URLs with the turn so retries keep the same catalog and prices.
            const telegramState = { ...turn.state, telegramCatalog: catalogPhotos(turn, business.owner_id),
                assistantHistory: [...history, { role: "user", content: text }, { role: "assistant", content: turn.reply.slice(0, 4000) }].slice(-10) };
            const order = turn.order ? {
                id: randomUUID(),
                product_id: turn.order.product.id,
                expected_product_name: turn.order.product.name,
                expected_price_kzt: turn.order.product.price_kzt,
                expected_delivery_fee_kzt: turn.order.deliveryFeeKzt,
                draft: turn.order.draft,
            } : null;
            const { data: committedData, error: commitError } = await admin.rpc("commit_telegram_sales_turn", {
                p_chat_id: chatId,
                p_bot_id: botId,
                p_update_id: payload.update_id,
                p_expected_revision: chat ? chat.revision : -1,
                p_expected_business_id: chat?.business_id ?? null,
                p_business_id: business.id,
                p_message: text,
                p_state: telegramState,
                p_reply: turn.reply.slice(0, 4000),
                p_expected_profile: storedProfile,
                p_order: order,
            });
            if (commitError) throw new Error("Unable to commit Telegram sales turn");
            const committed = committedData as CommitResult;
            if (committed.outcome === "conflict" || committed.outcome === "quote_changed") continue;
            if (committed.outcome === "stale") return NextResponse.json({ ok: true });
            if (committed.outcome === "inactive") {
                await sendMessage(message.chat.id, "Магазин приостановил ассистента. Свяжитесь с магазином напрямую.");
                return NextResponse.json({ ok: true });
            }
            if (!committed.reply || !["committed", "duplicate"].includes(committed.outcome)) {
                throw new Error("Unexpected Telegram commit result");
            }
            // Sending happens only after the transaction commits. A Telegram retry reuses this exact reply.
            if (committed.outcome === "duplicate") {
                const { data: replay, error: replayError } = await admin.from("telegram_chats")
                    .select("last_update_id,state").eq("bot_id", botId).eq("chat_id", chatId).maybeSingle();
                if (replayError) throw new Error("Unable to read committed catalog");
                await sendReply(message.chat.id, committed.reply, Number(replay?.last_update_id) === payload.update_id ? replay?.state : undefined);
            } else {
                await sendReply(message.chat.id, committed.reply, telegramState);
            }
            return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ error: "Conversation changed; retry this update." }, { status: 503 });
    } catch {
        console.error("Unable to process Telegram sales message.");
        return NextResponse.json({ error: "Unable to process Telegram message." }, { status: 503 });
    }
}
