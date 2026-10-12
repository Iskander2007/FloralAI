import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { billingResponse } from "@/lib/subscription";

export const runtime = "nodejs";

export async function GET() {
    const client = await createSupabaseServerClient();
    if (!client) return NextResponse.json({ error: "Хранилище подписок пока недоступно." }, { status: 503 });
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) return NextResponse.json({ error: "Войдите, чтобы посмотреть тариф и пробный доступ." }, { status: 401 });
    const [trial, subscription, payment, operator] = await Promise.all([
        client.from("business_trials").select("started_at,ends_at,selected_plan")
            .eq("owner_id", auth.user.id).maybeSingle(),
        client.from("business_subscriptions").select("owner_id,plan,period_start,period_end,last_payment_id")
            .eq("owner_id", auth.user.id).maybeSingle(),
        client.from("subscription_payment_requests")
            .select("id,owner_id,owner_email,plan,billing_cycle,amount_kzt,kaspi_phone,status,bank_reference,rejection_reason,created_at,updated_at,approved_at")
            .eq("owner_id", auth.user.id).order("created_at", { ascending: false })
            .order("id", { ascending: false }).limit(1).maybeSingle(),
        client.rpc("is_subscription_operator"),
    ]);
    const failure = [trial, subscription, payment, operator].find((result) => result.error);
    if (failure) {
        console.error("Unable to load subscription billing.", { code: failure.error?.code });
        return NextResponse.json({ error: "Не удалось загрузить подписку. Попробуйте ещё раз." }, { status: 503 });
    }
    return NextResponse.json(billingResponse(trial.data, {
        subscription: subscription.data,
        paymentRequest: payment.data,
        canManagePayments: operator.data === true,
    }), { headers: { "Cache-Control": "private, no-store" } });
}
