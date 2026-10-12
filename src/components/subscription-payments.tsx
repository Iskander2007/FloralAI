"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle, RefreshCw, Send } from "lucide-react";
import { plans } from "@/lib/plans";
import type { SubscriptionPayment } from "@/components/subscription-billing";
import "@/app/subscription-billing.css";

type ManagedPayment = SubscriptionPayment & { owner_email: string; owner_id: string };
type PaymentAction = { action: "mark_sent" } | { action: "approve"; amount: number; reference: string } | { action: "reject"; reason: string };

const statusLabels: Record<SubscriptionPayment["status"], string> = {
    requested: "Нужен счёт",
    invoice_sent: "Счёт выставлен",
    verification_requested: "Нужна проверка оплаты",
    approved: "Подтверждён",
    rejected: "Отклонён",
};

function money(value: number) { return `${new Intl.NumberFormat("ru-RU").format(value)} ₸`; }
function date(value: string) {
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" }).format(new Date(value));
}

async function readJson<T>(response: Response): Promise<T> {
    if (response.status === 401) throw new Error("Войдите в аккаунт для управления счетами.");
    if (response.status === 403) throw new Error("У этого аккаунта нет доступа к управлению оплатой.");
    const result = await response.json();
    if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Не удалось обновить счёт.");
    return result as T;
}

const readableError = (cause: unknown, fallback: string) => cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError) ? cause.message : fallback;

function PaymentQueueCard({ payment, busy, pending, onAction }: { payment: ManagedPayment; busy: boolean; pending: boolean; onAction: (id: string, action: PaymentAction) => Promise<void> }) {
    const [reference, setReference] = useState("");
    const [receivedAmount, setReceivedAmount] = useState(String(payment.amount_kzt));
    const [verified, setVerified] = useState(false);
    const [showRejection, setShowRejection] = useState(false);
    const [reason, setReason] = useState("");
    const [validationError, setValidationError] = useState("");
    const open = payment.status !== "approved" && payment.status !== "rejected";

    function approve(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const amount = Number(receivedAmount);
        if (!Number.isSafeInteger(amount) || amount !== payment.amount_kzt) {
            setValidationError(`Для подтверждения должно поступить ровно ${money(payment.amount_kzt)}.`);
            return;
        }
        if (!reference.trim() || !verified) {
            setValidationError("Укажите номер операции и подтвердите, что проверили поступление денег.");
            return;
        }
        setValidationError("");
        void onAction(payment.id, { action: "approve", amount, reference: reference.trim() });
    }

    function reject(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (reason.trim().length < 3) { setValidationError("Напишите причину отклонения, чтобы клиент мог её увидеть."); return; }
        setValidationError("");
        void onAction(payment.id, { action: "reject", reason: reason.trim() });
    }

    return <article className="subscription-request" aria-busy={pending}>
        <div className="subscription-request-top"><div><h4>№ {payment.id.slice(0, 8).toUpperCase()} · {payment.owner_email || payment.owner_id}</h4><p>{plans[payment.plan].name} · {payment.billing_cycle === "annual" ? "12 месяцев" : "1 месяц"} · {money(payment.amount_kzt)}</p></div><span className="subscription-request-badge" data-status={payment.status}>{statusLabels[payment.status]}</span></div>
        <div className="subscription-request-details"><span>Kaspi: <strong>{payment.kaspi_phone}</strong></span><span>Запрошен: <strong>{date(payment.created_at)}</strong></span>{payment.approved_at && <span>Подтверждён: <strong>{date(payment.approved_at)}</strong></span>}</div>
        {payment.bank_reference && <p className="subscription-request-note">Номер банковской операции: {payment.bank_reference}</p>}
        {payment.rejection_reason && <p className="subscription-request-note">Причина отклонения: {payment.rejection_reason}</p>}
        {payment.status === "requested" && <><p className="subscription-request-note">Выставьте в приложении Kaspi.kz счёт на {money(payment.amount_kzt)} по номеру {payment.kaspi_phone}. Затем отметьте его ниже. Сайт сам не отправляет счёт в Kaspi.</p><div className="subscription-request-actions"><button className="subscription-start" type="button" disabled={busy} onClick={() => void onAction(payment.id, { action: "mark_sent" })}>{pending ? <LoaderCircle className="subscription-spinner" size={16} aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} Счёт выставлен в Kaspi</button></div></>}
        {(payment.status === "invoice_sent" || payment.status === "verification_requested") && <form className="subscription-operator-form" onSubmit={approve}>
            <p className="subscription-request-note">{payment.status === "verification_requested" ? "Клиент сообщил об оплате. " : "Счёт отмечен как выставленный. "}Проверьте поступление на свой счёт Kaspi перед подтверждением. Чек или сообщение клиента не заменяют проверку поступления.</p>
            <div className="subscription-form-fields"><label className="subscription-field">Фактически получено, ₸<input type="number" inputMode="numeric" min="1" step="1" required value={receivedAmount} onChange={(event) => setReceivedAmount(event.target.value)} disabled={busy} /></label><label className="subscription-field">Номер операции в Kaspi<input type="text" required maxLength={120} placeholder="Из истории поступлений Kaspi" value={reference} onChange={(event) => setReference(event.target.value)} disabled={busy} /><small>Уникальный номер поступления, без данных карты.</small></label></div>
            <label className="subscription-confirm"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)} required disabled={busy} /><span>Я проверил поступление {money(payment.amount_kzt)} на счёт Kaspi и сверил плательщика с этой заявкой.</span></label>
            <div className="subscription-request-actions"><button type="submit" className="subscription-start" disabled={busy || !verified || !reference.trim()}>{pending ? <LoaderCircle className="subscription-spinner" size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />} Подтвердить оплату и подписку</button></div>
        </form>}
        {validationError && <p className="subscription-error" role="alert">{validationError}</p>}
        {open && <div className="subscription-request-actions"><button type="button" className="subscription-secondary" disabled={busy} aria-expanded={showRejection} onClick={() => setShowRejection((value) => !value)}>{showRejection ? "Скрыть отклонение" : "Отклонить запрос"}</button></div>}
        {open && showRejection && <form className="subscription-operator-form" onSubmit={reject}><label className="subscription-field">Причина для клиента<input type="text" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={200} required disabled={busy} placeholder="Например: счёт не оплачен, запросите новый" /></label><div className="subscription-request-actions"><button type="submit" className="subscription-secondary" disabled={busy || reason.trim().length < 3}>Отклонить и сообщить причину</button></div></form>}
    </article>;
}

export function SubscriptionPayments({ onChange }: { onChange?: () => void }) {
    const [payments, setPayments] = useState<ManagedPayment[]>([]);
    const [filter, setFilter] = useState<"open" | "all">("open");
    const [loading, setLoading] = useState(true);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [limit, setLimit] = useState(100);
    const requestRef = useRef<AbortController | null>(null);
    const mutationRef = useRef(false);

    useEffect(() => {
        let active = true;
        async function load() {
            if (!active || requestRef.current || mutationRef.current) return;
            const controller = new AbortController();
            requestRef.current = controller;
            try {
                const result = await readJson<{ payments: ManagedPayment[]; limit: number }>(await fetch(`/api/billing/payments?status=${filter}`, { cache: "no-store", signal: controller.signal }));
                if (active && !controller.signal.aborted) {
                    setPayments(result.payments);
                    setLimit(result.limit);
                    setError("");
                }
            } catch (cause) {
                if (active && !controller.signal.aborted) setError(readableError(cause, "Не удалось загрузить очередь счетов. Попробуйте ещё раз."));
            } finally {
                if (active && !controller.signal.aborted && requestRef.current === controller) {
                    requestRef.current = null;
                    setLoading(false);
                }
            }
        }
        void load();
        const refresh = () => { if (document.visibilityState === "visible") void load(); };
        const timer = window.setInterval(refresh, 15_000);
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
    }, [filter, refreshKey]);

    async function updatePayment(id: string, action: PaymentAction) {
        if (mutationRef.current || loading) return;
        mutationRef.current = true;
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setPendingId(id);
        setError("");
        setNotice("");
        let succeeded = false;
        try {
            const { payment } = await readJson<{ payment: ManagedPayment }>(await fetch(`/api/billing/payments/${id}`, {
                method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), signal: controller.signal,
            }));
            if (!controller.signal.aborted) {
                setPayments((previous) => previous.flatMap((item) => item.id !== id ? [item] : filter === "open" && ["approved", "rejected"].includes(payment.status) ? [] : [{ ...item, ...payment }]));
                setNotice(action.action === "approve" ? "Оплата подтверждена. Оплаченный период сохранён; бесплатная неделя не сокращается." : action.action === "mark_sent" ? "Счёт отмечен как выставленный. Клиент увидит новый статус." : "Запрос отклонён. Клиент увидит причину и сможет запросить новый счёт.");
                succeeded = true;
            }
        } catch (cause) {
            if (!controller.signal.aborted) setError(readableError(cause, "Не удалось изменить статус счёта. Попробуйте ещё раз."));
        } finally {
            if (!controller.signal.aborted) {
                requestRef.current = null;
                mutationRef.current = false;
                setPendingId(null);
                if (succeeded) {
                    setRefreshKey((value) => value + 1);
                    onChange?.();
                }
            }
        }
    }

    const busy = loading || pendingId !== null;
    return <section className="subscription-billing subscription-admin">
        <div className="subscription-admin-header"><div><h2>Управление оплатой FloralAI</h2><p>Запросы подписчиков на счета Kaspi. Выставляйте счета в Kaspi вручную, затем отмечайте статус здесь. Подтверждайте оплату после проверки поступления.</p></div><button type="button" className="subscription-secondary" disabled={busy} onClick={() => { setLoading(true); setError(""); setRefreshKey((value) => value + 1); }}><RefreshCw size={15} aria-hidden="true" /> Обновить</button></div>
        <div className="subscription-filter-list" aria-label="Фильтр счетов"><button type="button" aria-pressed={filter === "open"} disabled={busy} onClick={() => { if (filter !== "open") { setLoading(true); setPayments([]); setFilter("open"); } }}>Требуют действий</button><button type="button" aria-pressed={filter === "all"} disabled={busy} onClick={() => { if (filter !== "all") { setLoading(true); setPayments([]); setFilter("all"); } }}>Все счета</button></div>
        {error && <div className="subscription-error" role="alert"><p>{error}</p></div>}
        {notice && <div className="subscription-success" role="status">{notice}</div>}
        {loading ? <div className="subscription-status" role="status"><LoaderCircle className="subscription-spinner" size={18} aria-hidden="true" /> Загружаем счета…</div> : payments.length === 0 && !error ? <p className="subscription-status">{filter === "open" ? "Счетов, требующих действий, пока нет." : "Запросов на оплату пока нет."}</p> : null}
        <div className="subscription-request-list">{payments.map((payment) => <PaymentQueueCard key={payment.id} payment={payment} busy={busy} pending={pendingId === payment.id} onAction={updatePayment} />)}</div>
        {payments.length >= limit && <p className="subscription-request-note">Показаны последние {limit} счетов. В разделе «Требуют действий» отображаются незавершённые запросы.</p>}
    </section>;
}
