export type TrialRow = {
    started_at: string;
    ends_at: string;
    selected_plan: "starter" | "business";
};

export function describeTrial(row: TrialRow | null, now = Date.now()) {
    if (!row) return null;
    const remaining = new Date(row.ends_at).getTime() - now;
    return {
        startedAt: row.started_at,
        endsAt: row.ends_at,
        selectedPlan: row.selected_plan,
        state: remaining > 0 ? "trialing" as const : "expired" as const,
        daysRemaining: Math.max(0, Math.ceil(remaining / 86_400_000)),
    };
}

export type SubscriptionRow = {
    plan: "starter" | "business";
    period_start: string;
    period_end: string;
};

export function billingResponse(row: TrialRow | null, options: {
    subscription?: SubscriptionRow | null;
    paymentRequest?: unknown;
    canManagePayments?: boolean;
} = {}) {
    const paid = options.subscription;
    const now = Date.now();
    const subscription = paid ? {
        plan: paid.plan,
        periodStartsAt: paid.period_start,
        periodEndsAt: paid.period_end,
        state: new Date(paid.period_end).getTime() <= now ? "expired"
            : new Date(paid.period_start).getTime() > now ? "scheduled" : "active",
    } : null;
    return {
        trial: describeTrial(row), subscription,
        paymentRequest: options.paymentRequest ?? null,
        canManagePayments: options.canManagePayments ?? false,
        paymentsAvailable: true as const,
    };
}
