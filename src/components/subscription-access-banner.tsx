"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Access = {
    trial: null | { state: string; daysRemaining: number };
    subscription: null | { state: string; periodEndsAt: string };
    canManagePayments: boolean;
};

export function SubscriptionAccessBanner() {
    const [billing, setBilling] = useState<Access | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        let busy = false;
        async function load() {
            if (busy || document.visibilityState === "hidden") return;
            busy = true;
            try {
                const response = await fetch("/api/billing", { cache: "no-store", signal: controller.signal });
                if (response.ok) {
                    const result = await response.json();
                    if (!controller.signal.aborted) setBilling(result);
                }
            } catch { /* The billing page offers a retry when the network returns. */ }
            finally { busy = false; }
        }
        void load();
        const timer = window.setInterval(load, 60_000);
        window.addEventListener("focus", load);
        document.addEventListener("visibilitychange", load);
        return () => {
            controller.abort(); window.clearInterval(timer);
            window.removeEventListener("focus", load);
            document.removeEventListener("visibilitychange", load);
        };
    }, []);
    if (!billing) return null;
    const paid = billing.subscription && billing.subscription.state !== "expired";
    const trial = billing.trial?.state === "trialing";
    const text = billing.canManagePayments ? "Счета Kaspi и подтверждение подписок доступны в разделе «Тариф и оплата»."
        : paid ? "Подписка оплачена. Управление оплатой — в разделе «Тариф и оплата»."
            : trial ? `Пробная неделя: осталось дней — ${billing.trial!.daysRemaining}. Все функции доступны, списаний нет.`
                : "Пробный доступ завершён. Для новых заказов и настройки бота оформите подписку. Сохранённые заявки доступны.";
    return <div className="integration-disclosure" role="status" style={{ marginBottom: 20 }}>
        <span>{text} <Link href="/dashboard?view=billing" onClick={(event) => {
            event.preventDefault();
            window.history.replaceState(null, "", "/dashboard?view=billing");
            window.dispatchEvent(new Event("bizai:viewchange"));
        }}>Тариф и оплата →</Link></span>
    </div>;
}
