"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseConfig } from "./config";
import { fetchWithTimeout } from "../fetch-with-timeout";

export function createSupabaseBrowserClient() {
    const config = getSupabaseConfig();
    return config
        ? createBrowserClient(config.url, config.key, {
            global: {
                fetch(input, init) {
                    const url = input instanceof Request ? input.url : String(input);
                    // Bound Auth requests without imposing a short upload deadline
                    // on catalog images or changing other database requests.
                    return url.startsWith(`${config.url.replace(/\/$/, "")}/auth/v1/`)
                        ? fetchWithTimeout(input, init)
                        : fetch(input, init);
                },
            },
        })
        : null;
}
