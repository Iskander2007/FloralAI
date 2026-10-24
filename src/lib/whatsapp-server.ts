import "server-only";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function whatsappOwner(request: Request, mutation = false) {
    if (mutation && request.headers.get("origin") !== new URL(request.url).origin) {
        return { response: NextResponse.json({ error: "Запрос должен быть отправлен с сайта FloralAI." }, { status: 403 }) };
    }
    const client = await createSupabaseServerClient();
    if (!client) return { response: NextResponse.json({ error: "Войдите в аккаунт для подключения WhatsApp." }, { status: 401 }) };
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return { response: NextResponse.json({ error: "Войдите в аккаунт для подключения WhatsApp." }, { status: 401 }) };
    const admin = createSupabaseAdminClient();
    if (!admin) return { response: NextResponse.json({ error: "Подключение WhatsApp ещё готовится. Попробуйте позже." }, { status: 503 }) };
    return { ownerId: data.user.id, client, admin };
}

export async function whatsappAccess(client: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
    const { data, error } = await client.rpc("has_workspace_access");
    if (error || typeof data !== "boolean") return NextResponse.json({ error: "Не удалось проверить подписку." }, { status: 503 });
    if (!data) return NextResponse.json({ error: "Для работы бота активируйте пробный период или подписку.", code: "SUBSCRIPTION_REQUIRED" }, { status: 402 });
    return null;
}

export async function whatsappBody(request: Request) {
    const raw = await request.text();
    if (raw.length > 16384) throw new Error("Request too large");
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid body");
    return body as Record<string, unknown>;
}

export const whatsappPublicColumns = "id,display_phone,verified_name,active,connected_at,token_expires_at";
