import { NextResponse } from "next/server";
import { whatsappAccess, whatsappBody, whatsappOwner } from "@/lib/whatsapp-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const auth = await whatsappOwner(request);
    if (auth.response) return auth.response;
    const connection = await auth.admin.from("whatsapp_connections").select("id").eq("owner_id", auth.ownerId).maybeSingle();
    if (connection.error) return NextResponse.json({ error: "Не удалось загрузить диалоги." }, { status: 503 });
    if (!connection.data) return NextResponse.json({ chats: [], messages: [] });
    const customer = new URL(request.url).searchParams.get("customer");
    if (customer && !/^\d{7,15}$/.test(customer)) return NextResponse.json({ error: "Неверный номер клиента." }, { status: 400 });
    const chats = await auth.admin.from("whatsapp_chats").select("customer_phone,paused,updated_at")
        .eq("connection_id", connection.data.id).order("updated_at", { ascending: false }).limit(30);
    let messages = auth.admin.from("whatsapp_events").select("id,customer_phone,content,reply,status,created_at")
        .eq("connection_id", connection.data.id).order("id", { ascending: false }).limit(30);
    if (customer) messages = messages.eq("customer_phone", customer);
    const turns = await messages;
    if (chats.error || turns.error) return NextResponse.json({ error: "Не удалось загрузить переписку." }, { status: 503 });
    return NextResponse.json({ chats: chats.data, messages: turns.data }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
    const auth = await whatsappOwner(request, true);
    if (auth.response) return auth.response;
    let body: Record<string, unknown>;
    try { body = await whatsappBody(request); }
    catch { return NextResponse.json({ error: "Неверный запрос." }, { status: 400 }); }
    if (typeof body.customer !== "string" || !/^\d{7,15}$/.test(body.customer) || typeof body.paused !== "boolean") {
        return NextResponse.json({ error: "Укажите диалог и состояние бота." }, { status: 400 });
    }
    if (!body.paused) { const denied = await whatsappAccess(auth.client); if (denied) return denied; }
    const connection = await auth.admin.from("whatsapp_connections").select("id").eq("owner_id", auth.ownerId).maybeSingle();
    if (connection.error) return NextResponse.json({ error: "Не удалось загрузить подключение." }, { status: 503 });
    if (!connection.data) return NextResponse.json({ error: "Номер не подключён." }, { status: 409 });
    const update = await auth.admin.from("whatsapp_chats").update({ paused: body.paused })
        .eq("connection_id", connection.data.id).eq("customer_phone", body.customer).select("customer_phone").maybeSingle();
    if (update.error) return NextResponse.json({ error: "Не удалось изменить состояние диалога." }, { status: 503 });
    if (!update.data) return NextResponse.json({ error: "Диалог не найден." }, { status: 404 });
    return NextResponse.json({ ok: true });
}
