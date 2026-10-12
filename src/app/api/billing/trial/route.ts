import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { billingResponse, type TrialRow } from "@/lib/subscription";

export const runtime = "nodejs";

export async function POST(request: Request) {
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) {
        return NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
    }
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Хранилище подписок пока недоступно." }, { status: 503 });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "Войдите, чтобы начать бесплатную неделю." }, { status: 401 });
    let body: unknown;
    try {
        const raw = await request.text();
        if (raw.length > 1024) return NextResponse.json({ error: "Запрос слишком большой." }, { status: 413 });
        body = JSON.parse(raw);
    } catch {
        return NextResponse.json({ error: "Не удалось прочитать выбранный тариф." }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || !("plan" in body)
        || (body.plan !== "starter" && body.plan !== "business")) {
        return NextResponse.json({ error: "Выберите Starter или Business." }, { status: 400 });
    }
    // The database derives the owner from auth.uid() and fixes both dates.
    // ON CONFLICT retains the first trial even for parallel/repeated requests.
    const { data, error } = await client.rpc("start_business_trial", { requested_plan: body.plan }).returns<TrialRow[]>().single();
    if (error || !data) {
        console.error("Unable to start subscription trial.", { code: error?.code });
        return NextResponse.json({ error: "Не удалось начать пробный доступ. Попробуйте ещё раз." }, { status: 503 });
    }
    return NextResponse.json(billingResponse(data), { headers: { "Cache-Control": "private, no-store" } });
}
