import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { parseBusinessProfile, type BusinessProfile } from "@/lib/business";
import { emptySalesState, parseSalesState, runSalesTurn, type SalesProduct } from "@/lib/sales-assistant";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
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
    const admin = createSupabaseAdminClient();
    if (!admin) {
        return NextResponse.json({ error: "Telegram storage is not configured." }, { status: 503 });
    }
    const chatId = String(message.chat.id);
    const text = message.text.trim();
    const startCommand = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?\s*$/i);
    try {
        if (text.length > 2000) {
            await sendTelegramMessage(message.chat.id, "Сообщение слишком длинное. Напишите, пожалуйста, короче — до 2000 символов.");
            return NextResponse.json({ ok: true });
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const { data: chatData, error: chatError } = await admin.from("telegram_chats")
                .select("business_id,last_update_id,last_reply,state,revision").eq("chat_id", chatId).maybeSingle();
            if (chatError) throw new Error("Unable to read Telegram chat");
            const chat = chatData as ChatSnapshot | null;
            if (chat && payload.update_id < Number(chat.last_update_id)) return NextResponse.json({ ok: true });
            if (chat && payload.update_id === Number(chat.last_update_id)) {
                if (chat.last_reply) await sendTelegramMessage(message.chat.id, chat.last_reply);
                return NextResponse.json({ ok: true });
            }
            let businessQuery = admin.from("telegram_businesses").select("id,owner_id,business_name").eq("active", true);
            if (startCommand?.[1]) {
                if (!/^[A-Za-z0-9-]{32,64}$/.test(startCommand[1])) {
                    await sendTelegramMessage(message.chat.id, "Ссылка магазина недействительна. Попросите у магазина новую ссылку Telegram.");
                    return NextResponse.json({ ok: true });
                }
                businessQuery = businessQuery.eq("start_code", startCommand[1]);
            } else if (chat) {
                businessQuery = businessQuery.eq("id", chat.business_id);
            } else {
                await sendTelegramMessage(message.chat.id, "Чтобы начать, откройте ссылку Telegram, которую вам прислал магазин.");
                return NextResponse.json({ ok: true });
            }
            const { data: businessData, error: businessError } = await businessQuery.maybeSingle();
            if (businessError) throw new Error("Unable to read Telegram business");
            const business = businessData as TelegramBusiness | null;
            if (!business) {
                await sendTelegramMessage(message.chat.id, "Ссылка магазина недействительна или бот приостановлен. Попросите у магазина новую ссылку.");
                return NextResponse.json({ ok: true });
            }
            const [profileResult, productResult] = await Promise.all([
                admin.from("business_profiles").select("profile").eq("owner_id", business.owner_id).maybeSingle(),
                admin.from("catalog_products").select("id,name,price_kzt,description")
                    .eq("owner_id", business.owner_id).order("created_at", { ascending: false }).limit(100),
            ]);
            if (profileResult.error || productResult.error) throw new Error("Unable to load business sales information");
            const storedProfile = profileResult.data?.profile ?? null;
            const profile = parseBusinessProfile(storedProfile) ?? fallbackProfile(business.business_name);
            const products = (productResult.data ?? []) as SalesProduct[];
            // A new deep link always starts a fresh draft; another shop's customer data cannot follow it.
            const state = !chat || startCommand || chat.business_id !== business.id
                ? emptySalesState() : parseSalesState(chat.state);
            const turn = runSalesTurn({ message: startCommand ? "/start" : text, profile, products, state });
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
                p_update_id: payload.update_id,
                p_expected_revision: chat ? chat.revision : -1,
                p_expected_business_id: chat?.business_id ?? null,
                p_business_id: business.id,
                p_message: text,
                p_state: turn.state,
                p_reply: turn.reply.slice(0, 4000),
                p_expected_profile: storedProfile,
                p_order: order,
            });
            if (commitError) throw new Error("Unable to commit Telegram sales turn");
            const committed = committedData as CommitResult;
            if (committed.outcome === "conflict" || committed.outcome === "quote_changed") continue;
            if (committed.outcome === "stale") return NextResponse.json({ ok: true });
            if (committed.outcome === "inactive") {
                await sendTelegramMessage(message.chat.id, "Магазин приостановил ассистента. Свяжитесь с магазином напрямую.");
                return NextResponse.json({ ok: true });
            }
            if (!committed.reply || !["committed", "duplicate"].includes(committed.outcome)) {
                throw new Error("Unexpected Telegram commit result");
            }
            // Sending happens only after the transaction commits. A Telegram retry reuses this exact reply.
            await sendTelegramMessage(message.chat.id, committed.reply);
            return NextResponse.json({ ok: true });
        }
        return NextResponse.json({ error: "Conversation changed; retry this update." }, { status: 503 });
    } catch {
        console.error("Unable to process Telegram sales message.");
        return NextResponse.json({ error: "Unable to process Telegram message." }, { status: 503 });
    }
}
