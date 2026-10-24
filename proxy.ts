import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) return NextResponse.next({ request });

    let response = NextResponse.next({ request });
    const supabase = createServerClient(url, key, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet, headers) {
                for (const { name, value } of cookiesToSet) {
                    request.cookies.set(name, value);
                }
                response = NextResponse.next({ request });
                for (const { name, value, options } of cookiesToSet) {
                    response.cookies.set(name, value, options);
                }
                for (const [name, value] of Object.entries(headers)) {
                    response.headers.set(name, value);
                }
            },
        },
    });

    await supabase.auth.getClaims();
    return response;
}

export const config = {
    // Public pages must render without depending on the Auth service.
    // Protected handlers still verify the user independently of this refresh.
    matcher: [
        "/dashboard/:path*",
        "/onboarding/:path*",
        "/api/business-profile/:path*",
        "/api/chat/:path*",
        "/api/orders/:path*",
        "/api/billing/:path*",
        "/api/telegram/setup/:path*",
    ],
};
