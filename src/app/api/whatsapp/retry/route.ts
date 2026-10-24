import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getWhatsAppConfig, safeEqual } from "@/lib/whatsapp";
import { drainWhatsAppChat, type WhatsAppConnection } from "@/lib/whatsapp-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

// Optional scheduler recovery after server termination. This endpoint never accepts
// a caller-supplied owner, destination, content or token.
export async function POST(request: Request) {
    const secret = process.env.WHATSAPP_RETRY_SECRET;
    if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const config = getWhatsAppConfig(), admin = createSupabaseAdminClient();
    if (!config || !admin) return NextResponse.json({ error: "WhatsApp not configured" }, { status: 503 });
    const pending = await admin.from("whatsapp_events").select("connection_id,customer_phone")
        .in("status", ["pending", "ready"]).order("id", { ascending: true }).limit(100);
    if (pending.error) return NextResponse.json({ error: "Queue unavailable" }, { status: 503 });
    const seen = new Set<string>();
    let processed = 0, failed = 0;
    const deadline = Date.now() + 42_000;
    for (const job of pending.data ?? []) {
        const key = `${job.connection_id}:${job.customer_phone}`;
        if (seen.has(key)) continue;
        if (Date.now() >= deadline) break;
        seen.add(key);
        const connection = await admin.from("whatsapp_connections")
            .select("id,owner_id,phone_number_id,waba_id,active,token_ciphertext,token_expires_at")
            .eq("id", job.connection_id).maybeSingle();
        if (connection.error) { failed++; continue; }
        if (!connection.data) continue;
        try {
            await drainWhatsAppChat(admin, config, connection.data as WhatsAppConnection, job.customer_phone, deadline);
            processed++;
        } catch { failed++; }
    }
    return NextResponse.json({ processed, failed }, { status: failed ? 503 : 200 });
}
