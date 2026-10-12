"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, ClipboardList, MapPin, Phone, RefreshCw, Truck, UserRound } from "lucide-react";

type OrderStatus = "awaiting_confirmation" | "confirmed" | "cancelled" | "fulfilled";

type SalesOrder = {
    id: string;
    created_at: string;
    status: OrderStatus;
    customer_name: string | null;
    customer_phone: string | null;
    delivery_address: string | null;
    delivery_date: string | null;
    occasion: string | null;
    note: string | null;
    product_name: string | null;
    product_price_kzt: number | null;
    delivery_fee_kzt: number | null;
    total_kzt: number | null;
};

const statusLabels: Record<OrderStatus, string> = {
    awaiting_confirmation: "Новая заявка",
    confirmed: "Подтверждена",
    cancelled: "Отменена",
    fulfilled: "Завершена",
};

function money(value: number | null, unknownLabel = "Уточняется") {
    return value == null ? unknownLabel : `${new Intl.NumberFormat("ru-RU").format(value)} ₸`;
}

function createdAt(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda",
    }).format(date);
}

export function SalesOrders() {
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);

    const refresh = useCallback(() => {
        setLoading(true);
        setNextCursor(null);
        setError("");
        setRefreshKey((value) => value + 1);
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        async function load() {
            try {
                const response = await fetch("/api/orders", { cache: "no-store", signal: controller.signal });
                const result = await response.json() as { orders?: SalesOrder[]; nextCursor?: string | null; error?: string };
                if (!response.ok || !Array.isArray(result.orders)) {
                    throw new Error(result.error || "Не удалось загрузить заявки.");
                }
                if (!controller.signal.aborted) {
                    setOrders(result.orders);
                    setNextCursor(typeof result.nextCursor === "string" ? result.nextCursor : null);
                }
            } catch (loadError) {
                if (!controller.signal.aborted) setError(loadError instanceof Error && !(loadError instanceof TypeError) && !(loadError instanceof SyntaxError)
                    ? loadError.message
                    : "Не удалось загрузить заявки. Проверьте соединение и попробуйте ещё раз.");
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        }
        void load();
        return () => controller.abort();
    }, [refreshKey]);

    async function loadMore() {
        if (!nextCursor || loading || loadingMore || pendingId) return;
        setLoadingMore(true);
        setError("");
        try {
            const response = await fetch(`/api/orders?after=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
            const result = await response.json() as { orders?: SalesOrder[]; nextCursor?: string | null; error?: string };
            if (!response.ok || !Array.isArray(result.orders)) {
                throw new Error(result.error || "Не удалось загрузить следующие заявки.");
            }
            const additionalOrders = result.orders;
            setOrders((current) => {
                const seen = new Set(current.map((order) => order.id));
                const additional = additionalOrders.filter((order) => {
                    if (seen.has(order.id)) return false;
                    seen.add(order.id);
                    return true;
                });
                return [...current, ...additional];
            });
            setNextCursor(typeof result.nextCursor === "string" ? result.nextCursor : null);
        } catch (loadError) {
            setError(loadError instanceof Error && !(loadError instanceof TypeError) && !(loadError instanceof SyntaxError)
                ? loadError.message
                : "Не удалось загрузить следующие заявки. Проверьте соединение и попробуйте ещё раз.");
        } finally {
            setLoadingMore(false);
        }
    }

    async function updateStatus(id: string, status: OrderStatus) {
        if (loading || loadingMore || pendingId) return;
        setPendingId(id);
        setError("");
        setNotice("");
        try {
            const response = await fetch("/api/orders", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, status }),
            });
            const result = await response.json() as { order?: SalesOrder; error?: string };
            if (!response.ok) throw new Error(result.error || "Не удалось изменить статус заявки.");
            if (result.order) {
                setOrders((current) => current.map((order) => order.id === id ? result.order! : order));
            } else {
                refresh();
            }
            setNotice(status === "confirmed" ? "Заявка подтверждена и принята в работу." : status === "fulfilled" ? "Заявка отмечена завершённой." : "Заявка отменена.");
        } catch (updateError) {
            setError(updateError instanceof Error && !(updateError instanceof TypeError) && !(updateError instanceof SyntaxError)
                ? updateError.message
                : "Не удалось изменить статус заявки. Проверьте соединение и попробуйте ещё раз.");
        } finally {
            setPendingId(null);
        }
    }

    return (
        <section className="sales-orders" aria-label="Заявки клиентов" aria-busy={loading || loadingMore || Boolean(pendingId)}>
            <div className="sales-orders-heading">
                <div><h2>Заявки из Telegram</h2><p>Ассистент сохраняет выбранные товары, пожелания и контакты клиентов. Проверьте детали, свяжитесь с клиентом и подтвердите заявку.</p></div>
                <button className="business-secondary-button" type="button" onClick={refresh} disabled={loading || loadingMore || Boolean(pendingId)}><RefreshCw size={15} aria-hidden="true" />Обновить</button>
            </div>
            <div aria-live="polite">
                {error && <p className="business-feedback business-feedback-error" role="alert">{error}</p>}
                {notice && <p className="business-feedback business-feedback-success"><Check size={16} aria-hidden="true" />{notice}</p>}
            </div>
            {loading && <p className="sales-orders-loading" role="status">Загружаем заявки…</p>}
            {!loading && !error && orders.length === 0 && <div className="sales-orders-empty"><ClipboardList size={30} aria-hidden="true" /><h3>Заявок пока нет</h3><p>Подключите Telegram, заполните данные бизнеса и каталог. Когда клиент оставит заявку через ассистента, она появится здесь.</p></div>}
            <div className="sales-orders-list">
                {orders.map((order) => {
                    const closed = order.status === "cancelled" || order.status === "fulfilled";
                    const busy = pendingId === order.id;
                    const phoneLink = order.customer_phone?.replace(/[^\d+]/g, "");
                    return (
                        <article className="sales-order-card" key={order.id}>
                            <div className="sales-order-top"><div><h3>{order.product_name || "Заявка клиента"}</h3><span>№ {order.id.slice(0, 8)} · {createdAt(order.created_at)}</span></div><span className={`sales-order-status sales-order-status-${order.status}`}>{statusLabels[order.status] ?? "Требует проверки"}</span></div>
                            <div className="sales-order-details">
                                <div className="sales-order-contact"><p><UserRound size={16} aria-hidden="true" /><span>{order.customer_name || "Имя не указано"}</span></p><p><Phone size={16} aria-hidden="true" />{phoneLink ? <a href={`tel:${phoneLink}`}>{order.customer_phone}</a> : <span>Телефон не указан</span>}</p><p><MapPin size={16} aria-hidden="true" /><span>{order.delivery_address || "Адрес нужно уточнить"}</span></p><p><Truck size={16} aria-hidden="true" /><span>{order.delivery_date || "Дата и время доставки не указаны"}</span></p>{order.occasion && <p className="sales-order-additional"><b>Повод:</b> {order.occasion}</p>}{order.note && <p className="sales-order-additional"><b>Пожелания:</b> {order.note}</p>}</div>
                                <div className="sales-order-price"><dl><div><dt>Товар</dt><dd>{money(order.product_price_kzt)}</dd></div><div><dt>Доставка</dt><dd>{money(order.delivery_fee_kzt, "Уточнит магазин")}</dd></div><div className="sales-order-total"><dt>Итого</dt><dd>{money(order.total_kzt, "Уточнит магазин")}</dd></div></dl><p>Цены сохранены при оформлении заявки.</p></div>
                            </div>
                            {!closed && <div className="sales-order-actions">
                                {order.status !== "confirmed" && <button className="business-primary-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "confirmed")}><Check size={15} aria-hidden="true" />{busy ? "Сохраняем…" : "Подтвердить заявку"}</button>}
                                {order.status === "confirmed" && <button className="business-primary-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "fulfilled")}><Check size={15} aria-hidden="true" />{busy ? "Сохраняем…" : "Завершить"}</button>}
                                <button className="business-secondary-button business-cancel-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "cancelled")}>{busy ? "Сохраняем…" : "Отменить"}</button>
                            </div>}
                        </article>
                    );
                })}
            </div>
            {nextCursor && <button className="business-secondary-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
        </section>
    );
}
