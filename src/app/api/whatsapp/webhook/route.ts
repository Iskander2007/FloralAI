import { NextResponse } from "next/server";
import { getWhatsAppConfig, parseWhatsAppMessages, safeEqual, validWhatsAppSignature } from "@/lib/whatsapp";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { drainWhatsAppChat, type WhatsAppConnection } from "@/lib/whatsapp-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
    // Verification can be configured before enabling customer signups.
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    const query = new URL(request.url).searchParams;
    if (!token) return new Response("WhatsApp webhook not configured", { status: 503 });
    if (query.get("hub.mode") !== "subscribe" || !safeEqual(query.get("hub.verify_token") ?? "", token)) {
        return new Response("Invalid verification token", { status: 403 });
    }
    const challenge = query.get("hub.challenge");
    if (!challenge || !/^\d{1,100}$/.test(challenge)) return new Response("Invalid challenge", { status: 400 });
    return new Response(challenge, { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
    const secret = process.env.META_APP_SECRET;
    if (!secret) return NextResponse.json({ error: "WhatsApp not configured" }, { status: 503 });
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.byteLength > 262144) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    if (!validWhatsAppSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
    let payload: unknown;
    try { payload = JSON.parse(new TextDecoder().decode(raw)); }
    catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const incoming = parseWhatsAppMessages(payload);
    if (!incoming.length) return NextResponse.json({ ok: true });
    const config = getWhatsAppConfig(), admin = createSupabaseAdminClient();
    if (!config || !admin) return NextResponse.json({ error: "WhatsApp not ready" }, { status: 503 });
    const deadline = Date.now() + 42_000;
    try {
        const valid = incoming.filter((message) => message.timestamp * 1000 > Date.now() - 24 * 60 * 60_000
            && message.timestamp * 1000 <= Date.now() + 5 * 60_000);
        if (!valid.length) return NextResponse.json({ ok: true });
        const routed = await admin.from("whatsapp_connections")
            .select("id,owner_id,waba_id,phone_number_id,active,token_ciphertext,token_expires_at")
            .in("phone_number_id", [...new Set(valid.map((message) => message.phoneId))]).eq("active", true);
        if (routed.error) throw new Error("WhatsApp routing unavailable");
        const connections = new Map((routed.data as WhatsAppConnection[]).map((connection) => [connection.phone_number_id, connection]));
        // Persist the entire batch with one insert. Large re-deliveries must not
        // consume the request budget on already completed messages.
        const rows = valid.flatMap((message) => {
            const connection = connections.get(message.phoneId);
            return connection?.waba_id === message.wabaId ? [{
                message_id: message.id, connection_id: connection.id, customer_phone: message.from,
                content: message.text, message_timestamp: new Date(message.timestamp * 1000).toISOString(),
            }] : [];
        });
        if (!rows.length) return NextResponse.json({ ok: true });
        const inserted = await admin.from("whatsapp_events").upsert(rows, { onConflict: "message_id", ignoreDuplicates: true });
        if (inserted.error) throw new Error("WhatsApp inbox unavailable");
        const waiting = await admin.from("whatsapp_events").select("connection_id,customer_phone")
            .in("message_id", rows.map((row) => row.message_id)).in("status", ["pending", "ready"]);
        if (waiting.error) throw new Error("WhatsApp queue unavailable");
        const byId = new Map([...connections.values()].map((connection) => [connection.id, connection]));
        const chats = new Map<string, { connection: WhatsAppConnection; customer: string }>();
        for (const row of waiting.data ?? []) {
            const connection = byId.get(row.connection_id);
            if (connection) chats.set(`${connection.id}:${row.customer_phone}`, { connection, customer: row.customer_phone });
        }
        for (const { connection, customer } of chats.values()) {
            if (Date.now() >= deadline) throw new Error("WhatsApp batch needs retry");
            await drainWhatsAppChat(admin, config, connection, customer, deadline);
        }
        return NextResponse.json({ ok: true });
    } catch {
        // Returning 503 asks Meta to retry. Never log request bodies, keys or customer content.
        console.error("Unable to process WhatsApp webhook; awaiting retry.");
        return NextResponse.json({ error: "Retry delivery" }, { status: 503 });
    }
}
