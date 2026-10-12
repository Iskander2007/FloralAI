"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { CalendarDays, Check, CreditCard, Gift, LoaderCircle, RefreshCw } from "lucide-react";
import { annualDiscount, plans, trialDays } from "@/lib/plans";
import { SubscriptionPayments } from "@/components/subscription-payments";
import "@/app/subscription-billing.css";

type PaidPlan = "starter" | "business";
type BillingCycle = "monthly" | "annual";
export type SubscriptionPayment = {
    id: string;
    plan: PaidPlan;
    billing_cycle: BillingCycle;
    amount_kzt: number;
    kaspi_phone: string;
    status: "requested" | "invoice_sent" | "verification_requested" | "approved" | "rejected";
    bank_reference: string | null;
    rejection_reason: string | null;
    created_at: string;
    updated_at: string;
    approved_at: string | null;
};
type BillingState = {
    trial: null | {
        startedAt: string;
        endsAt: string;
        state: "trialing" | "expired";
        daysRemaining: number;
        selectedPlan: PaidPlan;
    };
    subscription: null | {
        plan: PaidPlan;
        periodStartsAt: string;
        periodEndsAt: string;
        state: "scheduled" | "active" | "expired";
    };
    paymentRequest: SubscriptionPayment | null;
    paymentsAvailable: boolean;
    canManagePayments: boolean;
};

const availableFeatures = [
    "Профиль бизнеса и быстрые шаблоны настройки",
    "Каталог цветов с фотографиями и ценами",
    "Telegram-бот для общения и оформления заказов",
    "Заявки на сайте и управление их статусами",
];

const paymentLabels: Record<SubscriptionPayment["status"], string> = {
    requested: "Ждёт выставления счёта",
    invoice_sent: "Счёт выставлен",
    verification_requested: "Проверяем оплату",
    approved: "Оплата подтверждена",
    rejected: "Заявка отклонена",
};

export function subscriptionDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda",
    }).format(date);
}

export function subscriptionMoney(value: number) {
    return `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
}

function remainingDays(days: number) {
    const count = Math.max(0, Math.ceil(days));
    const lastTwo = count % 100;
    const last = count % 10;
    const word = lastTwo >= 11 && lastTwo <= 14 ? "дней" : last === 1 ? "день" : last >= 2 && last <= 4 ? "дня" : "дней";
    return `${count} ${word}`;
}

async function readJson<T>(response: Response): Promise<T> {
    if (response.status === 401) throw new Error("Войдите в аккаунт владельца, чтобы управлять подпиской.");
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось обновить данные подписки.");
    return result as T;
}

const readableError = (cause: unknown, fallback: string) => cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError) ? cause.message : fallback;

export function SubscriptionBilling() {
    const [billing, setBilling] = useState<BillingState | null>(null);
    const [loading, setLoading] = useState(true);
    const [startingPlan, setStartingPlan] = useState<PaidPlan | null>(null);
    const [paymentBusy, setPaymentBusy] = useState<"request" | "mark_paid" | null>(null);
    const [selectedPlan, setSelectedPlan] = useState<PaidPlan>("starter");
    const [cycle, setCycle] = useState<BillingCycle>("monthly");
    const [phone, setPhone] = useState("");
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);
    const requestRef = useRef<AbortController | null>(null);
    const mutationRef = useRef(false);
    const selectionInitialized = useRef(false);

    useEffect(() => {
        let active = true;
        async function load() {
            if (!active || requestRef.current || mutationRef.current) return;
            const controller = new AbortController();
            requestRef.current = controller;
            try {
                const result = await readJson<BillingState>(await fetch("/api/billing", { cache: "no-store", signal: controller.signal }));
                if (active && !controller.signal.aborted) {
                    setBilling(result);
                    setError("");
                    if (!selectionInitialized.current) {
                        setSelectedPlan(result.paymentRequest?.plan || result.subscription?.plan || result.trial?.selectedPlan || "starter");
                        if (result.paymentRequest) {
                            setPhone(result.paymentRequest.kaspi_phone);
                            setCycle(result.paymentRequest.billing_cycle);
                        }
                        selectionInitialized.current = true;
                    }
                }
            } catch (cause) {
                if (active && !controller.signal.aborted) setError(readableError(cause, "Не удалось загрузить подписку. Проверьте соединение и попробуйте ещё раз."));
            } finally {
                if (active && !controller.signal.aborted && requestRef.current === controller) {
                    requestRef.current = null;
                    setLoading(false);
                }
            }
        }
        void load();
        const refresh = () => { if (document.visibilityState === "visible") void load(); };
        const timer = window.setInterval(refresh, 30_000);
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
            requestRef.current?.abort();
            requestRef.current = null;
        };
    }, [refreshKey]);

    async function startTrial(plan: PaidPlan) {
        if (!billing || billing.trial || loading || mutationRef.current) return;
        mutationRef.current = true;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setStartingPlan(plan);
        setError("");
        let succeeded = false;
        try {
            const result = await readJson<BillingState>(await fetch("/api/billing/trial", {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan }), signal: controller.signal,
            }));
            if (!controller.signal.aborted) {
                setBilling(result);
                succeeded = true;
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(readableError(cause, "Не удалось начать пробный период. Попробуйте ещё раз."));
        } finally {
            if (!controller.signal.aborted) {
                requestRef.current = null;
                mutationRef.current = false;
                setStartingPlan(null);
                if (succeeded) setRefreshKey((value) => value + 1);
            }
        }
    }

    async function paymentAction(action: "request" | "mark_paid", normalizedPhone?: string) {
        if (!billing || loading || mutationRef.current || (action === "mark_paid" && !billing.paymentRequest)) return;
        mutationRef.current = true;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setPaymentBusy(action);
        setError("");
        setNotice("");
        let succeeded = false;
        try {
            const result = await readJson<{ payment: SubscriptionPayment }>(await fetch(action === "request" ? "/api/billing/payments" : `/api/billing/payments/${billing.paymentRequest!.id}`, {
                method: action === "request" ? "POST" : "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(action === "request" ? { plan: selectedPlan, cycle, phone: normalizedPhone } : { action: "mark_paid" }),
                signal: controller.signal,
            }));
            if (!controller.signal.aborted) {
                setBilling((previous) => previous ? { ...previous, paymentRequest: result.payment } : previous);
                setNotice(action === "request" ? "Запрос сохранён. Дождитесь счёта в приложении Kaspi.kz." : "Сообщение об оплате отправлено на проверку. Подписка активируется после подтверждения поступления денег.");
                succeeded = true;
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(readableError(cause, "Не удалось отправить запрос. Попробуйте ещё раз."));
        } finally {
            if (!controller.signal.aborted) {
                requestRef.current = null;
                mutationRef.current = false;
                setPaymentBusy(null);
                if (succeeded) setRefreshKey((value) => value + 1);
            }
        }
    }

    function requestInvoice(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const compactPhone = phone.replace(/[\s()-]/g, "");
        const normalizedPhone = /^[78]\d{10}$/.test(compactPhone) ? `+7${compactPhone.slice(1)}` : compactPhone;
        if (!/^\+7\d{10}$/.test(normalizedPhone)) {
            setError("Укажите номер Kaspi в формате +7 777 123 45 67.");
            return;
        }
        void paymentAction("request", normalizedPhone);
    }

    const trial = billing?.trial;
    const subscription = billing?.subscription;
    const payment = billing?.paymentRequest;
    const openPayment = payment && !["approved", "rejected"].includes(payment.status);
    const displayedPlan = openPayment ? payment.plan : selectedPlan;
    const busy = loading || startingPlan !== null || paymentBusy !== null;
    const amount = cycle === "annual" ? Math.round(plans[selectedPlan].monthlyPriceKzt * 12 * (1 - annualDiscount)) : plans[selectedPlan].monthlyPriceKzt;
    const reload = () => { setLoading(true); setError(""); setRefreshKey((value) => value + 1); };

    return (
        <div className="subscription-billing" aria-busy={busy}>
            <div className="subscription-intro">
                <div className="subscription-intro-icon"><Gift size={23} aria-hidden="true" /></div>
                <div><h2>{trialDays} дней бесплатно со всеми доступными функциями</h2><p>Настройте бизнес, подключите Telegram и принимайте заказы. Для пробного доступа карта не нужна.</p></div>
                <span className="subscription-discount">Тарифы −50%</span>
            </div>

            {error && <div className="subscription-error" role="alert"><p>{error}</p><button type="button" onClick={reload} disabled={busy}><RefreshCw size={15} aria-hidden="true" /> Обновить данные</button></div>}
            {notice && <div className="subscription-success" role="status">{notice}</div>}

            {loading && !billing ? <div className="subscription-status" role="status"><LoaderCircle className="subscription-spinner" size={19} aria-hidden="true" /> Загружаем данные подписки…</div> : null}

            {subscription && <section className="subscription-trial-state" aria-live="polite">
                <div className="subscription-state-heading"><CreditCard size={21} aria-hidden="true" /><h3>{subscription.state === "active" ? "Подписка активна" : subscription.state === "scheduled" ? "Подписка оплачена" : "Оплаченный период завершился"}</h3><span>{plans[subscription.plan].name}</span></div>
                <dl><div><dt>Начало оплаченного периода</dt><dd>{subscriptionDate(subscription.periodStartsAt)}</dd></div><div><dt>Оплачено до</dt><dd>{subscriptionDate(subscription.periodEndsAt)}</dd></div><div><dt>Продление</dt><dd>По новому счёту, без автосписаний</dd></div></dl>
                <p>{subscription.state === "scheduled" ? "Оплаченный период начнётся после текущего доступа. Бесплатная неделя сохраняется полностью." : subscription.state === "expired" ? "Для продолжения работы запросите новый счёт ниже. Сохранённые заявки можно просматривать." : "Все доступные функции открыты до конца оплаченного периода."}</p>
            </section>}

            {trial && (trial.state === "trialing" || !subscription || subscription.state === "expired") ? <section className={`subscription-trial-state${trial.state === "expired" ? " subscription-trial-ended" : ""}`} aria-live="polite">
                <div className="subscription-state-heading"><CalendarDays size={21} aria-hidden="true" /><h3>{trial.state === "trialing" ? "Пробный период активен" : "Пробная неделя завершилась"}</h3><span>{trial.state === "trialing" ? `Осталось: ${remainingDays(trial.daysRemaining)}` : "Оформите подписку"}</span></div>
                <dl><div><dt>Начало</dt><dd>{subscriptionDate(trial.startedAt)}</dd></div><div><dt>Окончание</dt><dd>{subscriptionDate(trial.endsAt)}</dd></div><div><dt>Тариф для знакомства</dt><dd>{plans[trial.selectedPlan].name}</dd></div></dl>
                <p>{trial.state === "trialing" ? "Все доступные функции открыты. Если оплатите сейчас, оплаченный период начнётся после бесплатной недели." : "Чтобы продолжить настройку бизнеса и работу бота, запросите и оплатите счёт Kaspi. Сохранённые заявки можно просматривать."}</p>
            </section> : billing && !trial && !subscription ? <section className="subscription-trial-state"><div className="subscription-state-heading"><Gift size={21} aria-hidden="true" /><h3>Начните с бесплатной недели</h3></div><p>Один пробный период для вашего аккаунта. Оплата и данные карты не нужны.</p><button type="button" className="subscription-start" onClick={() => void startTrial(selectedPlan)} disabled={busy} style={{ marginTop: 18 }}>{startingPlan ? <><LoaderCircle className="subscription-spinner" size={17} aria-hidden="true" /> Открываем доступ…</> : `Начать ${trialDays} дней бесплатно`}</button></section> : null}

            <div className="subscription-plans">
                {(["starter", "business"] as const).map((key) => <section className={`subscription-plan${displayedPlan === key ? " subscription-plan-featured" : ""}`} key={key}>
                    <div className="subscription-plan-title"><h3>{plans[key].name}</h3>{displayedPlan === key && <span>Выбран</span>}</div>
                    <p className="subscription-plan-caption">{key === "starter" ? "Для одного бизнеса" : "Для растущего бизнеса"}</p>
                    <div className="subscription-price"><strong>{subscriptionMoney(plans[key].monthlyPriceKzt)}</strong><span>/ месяц</span></div>
                    <p className="subscription-price-note">Цена снижена на 50%. При оплате за год — ещё −20%.</p>
                    <ul>{availableFeatures.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" /><span>{feature}</span></li>)}</ul>
                    <button className="subscription-start" type="button" aria-pressed={displayedPlan === key} disabled={busy || !!openPayment} onClick={() => setSelectedPlan(key)}>{displayedPlan === key ? `Выбран ${plans[key].name}` : `Выбрать ${plans[key].name}`}</button>
                </section>)}
            </div>

            {payment && <section className="subscription-request" aria-live="polite">
                <div className="subscription-request-top"><div><h4>Счёт № {payment.id.slice(0, 8).toUpperCase()}</h4><p>{plans[payment.plan].name} · {payment.billing_cycle === "annual" ? "12 месяцев" : "1 месяц"} · {subscriptionMoney(payment.amount_kzt)}</p></div><span className="subscription-request-badge" data-status={payment.status}>{paymentLabels[payment.status]}</span></div>
                <div className="subscription-request-details"><span>Номер Kaspi: <strong>{payment.kaspi_phone}</strong></span><span>Запрос: <strong>{subscriptionDate(payment.created_at)}</strong></span></div>
                <p className="subscription-request-note">{payment.status === "requested" ? "Владелец FloralAI выставит счёт на этот номер. Дождитесь сообщения в приложении Kaspi.kz → Сообщения."
                    : payment.status === "invoice_sent" ? `Откройте Kaspi.kz → Сообщения и оплатите счёт на ${subscriptionMoney(payment.amount_kzt)}. После оплаты сообщите об этом кнопкой ниже.`
                        : payment.status === "verification_requested" ? "Владелец FloralAI проверяет поступление денег. Нажатие «Я оплатил» само по себе не подтверждает платёж."
                            : payment.status === "approved" ? "Поступление денег подтверждено. Даты оплаченного периода указаны выше."
                                : payment.rejection_reason || "Счёт отклонён. Вы можете отправить новый запрос ниже."}</p>
                {payment.status === "invoice_sent" && <div className="subscription-request-actions"><button type="button" className="subscription-start" onClick={() => void paymentAction("mark_paid")} disabled={busy}>{paymentBusy === "mark_paid" ? <><LoaderCircle className="subscription-spinner" size={17} aria-hidden="true" /> Отправляем…</> : "Я оплатил — отправить на проверку"}</button></div>}
            </section>}

            {!openPayment && <section className="subscription-invoice-panel">
                <div className="subscription-section-heading"><div><h3>Оплатить подписку через Kaspi</h3><p>Счёт выставляется вручную на ваш номер Kaspi. Данные карты и автосписания не используются.</p></div><CreditCard size={23} aria-hidden="true" /></div>
                <ol className="subscription-workflow"><li>Отправьте запрос на счёт.</li><li>Оплатите счёт в приложении Kaspi.kz.</li><li>Сообщите об оплате и дождитесь проверки.</li></ol>
                <form className="subscription-manual-form" onSubmit={requestInvoice}>
                    <div className="subscription-form-fields"><label className="subscription-field">Период оплаты<select value={cycle} onChange={(event) => setCycle(event.target.value as BillingCycle)} disabled={busy}><option value="monthly">1 месяц</option><option value="annual">12 месяцев · скидка 20%</option></select></label><label className="subscription-field">Номер телефона Kaspi<input type="tel" inputMode="tel" autoComplete="tel" placeholder="+7 777 123 45 67" value={phone} onChange={(event) => setPhone(event.target.value)} maxLength={25} required disabled={busy} /><small>На этот номер придёт счёт в приложении Kaspi.kz.</small></label></div>
                    <div className="subscription-total"><span>{plans[selectedPlan].name} · {cycle === "annual" ? "12 месяцев" : "1 месяц"}</span><strong>{subscriptionMoney(amount)}</strong></div>
                    <button type="submit" className="subscription-start" disabled={busy || !billing || !billing.paymentsAvailable}>{paymentBusy === "request" ? <><LoaderCircle className="subscription-spinner" size={17} aria-hidden="true" /> Отправляем запрос…</> : "Запросить счёт Kaspi"}</button>
                    <p className="subscription-request-note">Отправка запроса не списывает деньги. Подписка активируется только после подтверждения оплаты владельцем FloralAI.</p>
                </form>
            </section>}

            {billing?.canManagePayments && <SubscriptionPayments onChange={() => setRefreshKey((value) => value + 1)} />}
        </div>
    );
}
