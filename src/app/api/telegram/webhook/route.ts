import { timingSafeEqual, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
    emptyFlowerOrder,
    FlowerFlowStep,
    FlowerOrderDraft,
} from "@/lib/flower-assistant";
import { handleFlowerAssistantRequest } from "@/lib/flower-api";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TelegramMessage = {
    chat: { id: number; type: string };
    text?: string;
};

type TelegramUpdate = {
    update_id: number;
    message?: TelegramMessage;
};

type AssistantResult = {
    reply?: string;
    step?: FlowerFlowStep;
    draft?: FlowerOrderDraft;
    error?: string;
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
        body: JSON.stringify({ chat_id: chatId, text }),
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
    if (!Number.isSafeInteger(update.update_id) || !update.message || typeof update.message !== "object") {
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
            await sendTelegramMessage(message.chat.id, "Сообщение слишком длинное. Напишите короче.");
        } catch (error) {
            console.error("Unable to reply to Telegram message.", error);
            return NextResponse.json({ error: "Unable to send Telegram reply." }, { status: 503 });
        }
        return NextResponse.json({ ok: true });
    }

    const chatId = String(message.chat.id);
    try {
        const session = await prisma.flowerChatSession.upsert({
            where: { chatId },
            create: {
                chatId,
                draftJson: JSON.stringify(emptyFlowerOrder),
                idempotencyKey: randomUUID(),
            },
            update: {},
        });
        if (payload.update_id < session.lastUpdateId) {
            return NextResponse.json({ ok: true });
        }
        if (payload.update_id === session.lastUpdateId) {
            if (session.lastReply) await sendTelegramMessage(message.chat.id, session.lastReply);
            return NextResponse.json({ ok: true });
        }

        const text = message.text.trim();
        if (/^\/(?:start|reset)(?:@\w+)?(?:\s|$)/i.test(text)) {
            const firstReply =
                "Здравствуйте! Я помогу выбрать букет и оформить заявку. По какому поводу нужны цветы?";
            await prisma.flowerChatSession.update({
                where: { id: session.id },
                data: {
                    step: "occasion",
                    draftJson: JSON.stringify(emptyFlowerOrder),
                    idempotencyKey: randomUUID(),
                    lastUpdateId: payload.update_id,
                    lastReply: firstReply,
                },
            });
            await sendTelegramMessage(message.chat.id, firstReply);
            return NextResponse.json({ ok: true });
        }

        let draft: FlowerOrderDraft;
        try {
            draft = JSON.parse(session.draftJson) as FlowerOrderDraft;
        } catch (error) {
            console.error("Invalid stored Telegram flower session.", error);
            draft = emptyFlowerOrder;
        }

        const assistantRequest = new Request(new URL("/api/flower-assistant", request.url), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: text,
                step: session.step,
                draft,
                idempotencyKey: session.idempotencyKey,
            }),
        });
        const assistantResponse = await handleFlowerAssistantRequest(assistantRequest);
        const result = (await assistantResponse.json()) as AssistantResult;
        const assistantReply =
            result.reply ??
            result.error ??
            "Не получилось обработать сообщение. Попробуйте ещё раз.";

        await prisma.flowerChatSession.update({
            where: { id: session.id },
            data: {
                step: assistantResponse.ok && result.step ? result.step : session.step,
                draftJson:
                    assistantResponse.ok && result.draft
                        ? JSON.stringify(result.draft)
                        : session.draftJson,
                lastUpdateId: payload.update_id,
                lastReply: assistantReply,
            },
        });
        await sendTelegramMessage(message.chat.id, assistantReply);
        return NextResponse.json({ ok: true });
    } catch (error) {
        console.error("Unable to process Telegram flower message.", error);
        return NextResponse.json(
            { error: "Unable to process Telegram message." },
            { status: 503 },
        );
    }
}
