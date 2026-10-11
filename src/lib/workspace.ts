import { useEffect, useState, useSyncExternalStore } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type BusinessCategory =
    | "Beauty & wellness"
    | "Food & hospitality"
    | "Health & clinics"
    | "Retail & online shop"
    | "Auto & home services"
    | "Other";

export type BusinessProfile = {
    name: string;
    category: BusinessCategory;
    description: string;
    location: string;
    hours: string;
    phone: string;
    language: "English" | "Russian" | "Kazakh";
    tone: "Friendly" | "Professional" | "Premium" | "Casual";
    services: string[];
};

export type DemoWorkspace = {
    email: string;
    business: BusinessProfile | null;
    assistantPublished: boolean;
};

const WORKSPACE_KEY = "bizai.demo.workspace.v1";
const EMPTY_SNAPSHOT = "__BIZAI_EMPTY__";
const workspaceListeners = new Set<() => void>();

function subscribeToWorkspace(listener: () => void) {
    if (typeof window === "undefined") return () => undefined;
    workspaceListeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
        workspaceListeners.delete(listener);
        window.removeEventListener("storage", listener);
    };
}

function getWorkspaceSnapshot() {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(WORKSPACE_KEY) ?? EMPTY_SNAPSHOT;
}

function getServerWorkspaceSnapshot() {
    return null;
}

export function useDemoWorkspace() {
    const snapshot = useSyncExternalStore(
        subscribeToWorkspace,
        getWorkspaceSnapshot,
        getServerWorkspaceSnapshot,
    );
    if (snapshot === null || snapshot === EMPTY_SNAPSHOT) {
        return { ready: snapshot !== null, workspace: null };
    }
    try {
        return { ready: true, workspace: JSON.parse(snapshot) as DemoWorkspace };
    } catch {
        return { ready: true, workspace: null };
    }
}

export function useWorkspaceSession() {
    const local = useDemoWorkspace();
    const [authState, setAuthState] = useState<{
        ready: boolean;
        error: string | null;
    }>(() =>
        createSupabaseBrowserClient()
            ? { ready: false, error: null }
            : { ready: true, error: null },
    );

    useEffect(() => {
        const supabase = createSupabaseBrowserClient();
        if (!supabase) return;

        let cancelled = false;
        void supabase.auth.getUser().then(({ data, error }) => {
            if (cancelled) return;
            if (error) {
                setAuthState({ ready: true, error: error.message });
                return;
            }

            const email = data.user?.email;
            if (email) {
                const existing = readWorkspace();
                const sameAccount =
                    existing?.email.toLowerCase() === email.toLowerCase();
                writeWorkspace({
                    email,
                    business: sameAccount ? existing?.business ?? null : null,
                    assistantPublished: sameAccount
                        ? existing?.assistantPublished ?? false
                        : false,
                });
            }
            setAuthState({ ready: true, error: null });
        }).catch((error: unknown) => {
            if (cancelled) return;
            setAuthState({
                ready: true,
                error: error instanceof Error
                    ? error.message
                    : "Unable to verify your account session.",
            });
        });

        return () => {
            cancelled = true;
        };
    }, []);

    return {
        ready: local.ready && authState.ready,
        workspace: local.workspace,
        authError: authState.error,
    };
}

function notifyWorkspaceChange() {
    workspaceListeners.forEach((listener) => listener());
}

export function readWorkspace(): DemoWorkspace | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.localStorage.getItem(WORKSPACE_KEY);
        return raw ? (JSON.parse(raw) as DemoWorkspace) : null;
    } catch {
        return null;
    }
}

export function writeWorkspace(workspace: DemoWorkspace) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(workspace));
    notifyWorkspaceChange();
}

export function clearWorkspace() {
    if (typeof window !== "undefined") {
        window.localStorage.removeItem(WORKSPACE_KEY);
        notifyWorkspaceChange();
    }
}

export function extractBusinessDetails(description: string) {
    const text = description.trim();
    const prices = [
        ...text.matchAll(
            /([^.!?\n]{2,60}?)\s+(?:is|costs?|starts? at|от|стоит)\s+(\d[\d\s,]*)\s*(₸|тенге)?/gi,
        ),
    ].map((match) =>
        `${match[1].trim()} — ${match[2].trim()} ${match[3] ?? "₸"}`.trim(),
    );
    const time = text.match(
        /\b(?:from\s+)?\d{1,2}:?\d{0,2}\s*(?:to|–|-|—)\s*\d{1,2}:?\d{0,2}\b/i,
    )?.[0];
    const location = text
        .match(/\b(?:in|at|в|на)\s+([\p{L}][\p{L}\s-]{1,30})/iu)?.[1]
        ?.trim();
    const name = text
        .match(
            /(?:we(?:'re| are)|мы\s+|называемся\s+)([\p{L}][\p{L}\s&'-]{1,35})/iu,
        )?.[1]
        ?.trim();
    return {
        name: name?.replace(/[.,;].*$/, "").trim() ?? "",
        location: location?.replace(/[.,;].*$/, "").trim() ?? "",
        hours: time ?? "",
        services: [...new Set(prices)].slice(0, 8),
    };
}
