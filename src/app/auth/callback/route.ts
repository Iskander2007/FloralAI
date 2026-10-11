import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null, origin: string) {
    if (!value) return "/dashboard";
    const destination = new URL(value, origin);
    return destination.origin === origin
        ? `${destination.pathname}${destination.search}${destination.hash}`
        : "/dashboard";
}

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const supabase = await createSupabaseServerClient();

    if (!supabase) {
        return NextResponse.redirect(
            new URL("/login?error=auth_not_configured", requestUrl.origin),
        );
    }

    if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return NextResponse.redirect(
                new URL(safeNextPath(requestUrl.searchParams.get("next"), requestUrl.origin), requestUrl.origin),
            );
        }
    }

    return NextResponse.redirect(
        new URL("/login?error=auth_callback_failed", requestUrl.origin),
    );
}
