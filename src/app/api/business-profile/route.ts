import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseBusinessProfile } from "@/lib/business";

export const runtime = "nodejs";

async function authenticatedClient() {
    const client = await createSupabaseServerClient();
    if (!client) return null;
    const { data, error } = await client.auth.getUser();
    return !error && data.user ? { client, user: data.user } : null;
}

export async function GET() {
    const auth = await authenticatedClient();
    if (!auth) return NextResponse.json({ error: "Войдите в аккаунт, чтобы открыть профиль бизнеса." }, { status: 401 });
    const { data, error } = await auth.client.from("business_profiles")
        .select("profile, updated_at").eq("owner_id", auth.user.id).maybeSingle();
    if (error) {
        console.error("Unable to load business profile", error.code);
        return NextResponse.json({ error: "Не удалось загрузить сохранённый профиль бизнеса. Попробуйте позже." }, { status: 503 });
    }
    return NextResponse.json({ profile: data?.profile ?? null, updatedAt: data?.updated_at ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    const auth = await authenticatedClient();
    if (!auth) return NextResponse.json({ error: "Войдите в аккаунт, чтобы сохранить бизнес." }, { status: 401 });
    const { data: hasAccess, error: accessError } = await auth.client.rpc("has_workspace_access");
    if (accessError || typeof hasAccess !== "boolean") {
        return NextResponse.json({ error: "Не удалось проверить доступ. Попробуйте позже." }, { status: 503 });
    }
    if (!hasAccess) return NextResponse.json({
        error: "Пробный период завершён. Оформите подписку в разделе «Тариф и оплата».",
        code: "SUBSCRIPTION_REQUIRED",
    }, { status: 402 });
    let body: unknown;
    try {
        const raw = await request.text();
        if (raw.length > 49_152) return NextResponse.json({ error: "Описание слишком большое." }, { status: 413 });
        body = JSON.parse(raw);
    } catch { return NextResponse.json({ error: "Не удалось прочитать данные бизнеса." }, { status: 400 }); }
    const profile = parseBusinessProfile(body && typeof body === "object" && "profile" in body ? body.profile : null);
    if (!profile) return NextResponse.json({ error: "Проверьте название, данные бизнеса и стоимость доставки. Поля не должны превышать допустимую длину." }, { status: 400 });
    const { data, error } = await auth.client.from("business_profiles")
        .upsert({ owner_id: auth.user.id, profile }, { onConflict: "owner_id" })
        .select("profile, updated_at").single();
    if (error) {
        console.error("Unable to save business profile", error.code);
        return NextResponse.json({ error: "Не удалось сохранить бизнес в аккаунте. Данные формы остаются на экране; попробуйте позже." }, { status: 503 });
    }
    return NextResponse.json({ profile: data.profile, updatedAt: data.updated_at });
}
