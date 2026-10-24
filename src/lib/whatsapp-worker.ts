import "server-only";
import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseBusinessProfile } from "@/lib/business";
import type { ChatTurn } from "@/lib/ai";
import type { SalesProduct } from "@/lib/sales-assistant";
import { answerWhatsAppMessage } from "@/lib/whatsapp-reply";
import { decryptWhatsAppToken, whatsAppGraph, type WhatsAppConfig } from "@/lib/whatsapp";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export type WhatsAppConnection = {
    id: string; owner_id: string; phone_number_id: string; waba_id: string; active: boolean;
    token_ciphertext: string; token_expires_at: string | null;
};
type Event = { id: number; message_id: string; content: string; reply: string | null; message_timestamp: string };

// The webhook waits for durable processing. On failure it returns 503 so Meta retries.
// A protected recovery endpoint can drain queued work after a crashed request.
export async function drainWhatsAppChat(admin: Admin, config: WhatsAppConfig, connection: WhatsAppConnection,
    customer: string, deadline = Date.now() + 45_000) {
    for (let count = 0; count < 10 && Date.now() < deadline; count++) {
        const lease = randomUUID();
        const claim = await admin.rpc("claim_whatsapp_turn", { p_connection: connection.id, p_customer: customer, p_lease: lease });
        if (claim.error) throw new Error("WhatsApp queue unavailable");
        const job = claim.data as { outcome: string; event?: Event };
        if (job.outcome === "busy") throw new Error("WhatsApp chat busy; retry");
        if (["empty", "inactive", "paused"].includes(job.outcome)) return;
        if (job.outcome !== "claimed" || !job.event) throw new Error("Invalid WhatsApp job");
        const event = job.event;
        try {
            let reply = event.reply;
            if (!reply) {
                const [profileResult, productResult, historyResult] = await Promise.all([
                    admin.from("business_profiles").select("profile").eq("owner_id", connection.owner_id).maybeSingle(),
                    admin.from("catalog_products").select("id,name,price_kzt,description")
                        .eq("owner_id", connection.owner_id).order("created_at", { ascending: false }).limit(100),
                    admin.from("whatsapp_events").select("content,reply").eq("connection_id", connection.id)
                        .eq("customer_phone", customer).eq("status", "sent").order("id", { ascending: false }).limit(6),
                ]);
                if (profileResult.error || productResult.error || historyResult.error) throw new Error("Business context unavailable");
                const profile = parseBusinessProfile(profileResult.data?.profile);
                if (!profile) throw new Error("Business profile unavailable");
                const history: ChatTurn[] = [...(historyResult.data ?? [])].reverse().flatMap((row) => [
                    { role: "user" as const, content: row.content }, { role: "assistant" as const, content: row.reply },
                ]);
                const answer = await answerWhatsAppMessage(event.content, profile, (productResult.data ?? []) as SalesProduct[], history);
                const prepared = await admin.rpc("prepare_whatsapp_reply", {
                    p_connection: connection.id, p_customer: customer, p_lease: lease, p_event: event.id,
                    p_reply: answer.reply, p_handoff: answer.handoff,
                });
                if (prepared.error) throw new Error("Unable to save WhatsApp reply");
                if (prepared.data !== true) return;
                reply = answer.reply;
            }
            // Recheck owner pause and token changes immediately before transport, including retries.
            const current = await admin.from("whatsapp_connections")
                .select("active,token_ciphertext,token_expires_at").eq("id", connection.id).eq("owner_id", connection.owner_id).single();
            if (current.error) throw new Error("Unable to verify connection");
            const access = await admin.rpc("business_has_paid_access", { business_owner: connection.owner_id });
            if (access.error || typeof access.data !== "boolean") throw new Error("Unable to verify subscription");
            if (!current.data.active || !access.data || Date.now() - new Date(event.message_timestamp).getTime() >= 24 * 60 * 60_000
                || current.data.token_expires_at && new Date(current.data.token_expires_at).getTime() <= Date.now()) {
                const ignored = await admin.from("whatsapp_events").update({ status: "ignored" }).eq("id", event.id).eq("connection_id", connection.id);
                if (ignored.error) throw new Error("Unable to expire WhatsApp reply");
                await admin.rpc("finish_whatsapp_turn", { p_connection: connection.id, p_customer: customer, p_lease: lease, p_event: event.id });
                return;
            }
            const token = decryptWhatsAppToken(current.data.token_ciphertext, config.encryptionKey,
                `${connection.owner_id}:${connection.phone_number_id}`);
            const sent = await whatsAppGraph<{ messages?: { id: string }[] }>(config, `${connection.phone_number_id}/messages`, token, {
                messaging_product: "whatsapp", recipient_type: "individual", to: customer,
                context: { message_id: event.message_id }, type: "text", text: { body: reply, preview_url: false },
            });
            if (!sent.messages?.[0]?.id) throw new Error("WhatsApp did not accept the reply");
            const finished = await admin.rpc("finish_whatsapp_turn", { p_connection: connection.id, p_customer: customer,
                p_lease: lease, p_event: event.id, p_outgoing: sent.messages[0].id });
            if (finished.error || finished.data !== true) throw new Error("Unable to acknowledge WhatsApp reply");
        } catch (error) {
            await admin.rpc("finish_whatsapp_turn", { p_connection: connection.id, p_customer: customer, p_lease: lease, p_event: event.id });
            throw error;
        }
    }
    throw new Error("WhatsApp work remains; retry");
}
