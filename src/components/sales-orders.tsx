"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    confirmed: "В процессе",
    cancelled: "Отменена",
    fulfilled: "Выполнена",
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

type OrderFilter = "all" | OrderStatus;
const orderFilters: { value: OrderFilter; label: string }[] = [
    { value: "all", label: "Все" }, { value: "awaiting_confirmation", label: "Новые" },
    { value: "confirmed", label: "В процессе" }, { value: "fulfilled", label: "Выполненные" },
    { value: "cancelled", label: "Отменённые" },
];
type OrderPage = { orders: SalesOrder[]; nextCursor: string | null };
const compareOrderPosition = (left: SalesOrder, right: SalesOrder) => left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id);

async function fetchOrderPage(filter: OrderFilter, cursor: string | null, signal: AbortSignal): Promise<OrderPage> {
    const parameters = new URLSearchParams();
    if (filter !== "all") parameters.set("status", filter);
    if (cursor) parameters.set("after", cursor);
    const response = await fetch(`/api/orders${parameters.size ? `?${parameters}` : ""}`, { cache: "no-store", signal });
    const result = await response.json() as { orders?: SalesOrder[]; nextCursor?: string | null; error?: string };
    if (!response.ok || !Array.isArray(result.orders)) throw new Error(result.error || "Не удалось загрузить заявки.");
    return { orders: result.orders, nextCursor: typeof result.nextCursor === "string" ? result.nextCursor : null };
}

const readableError = (error: unknown, fallback: string) => error instanceof Error && !(error instanceof TypeError) && !(error instanceof SyntaxError) ? error.message : fallback;

export function SalesOrders() {
    const [orders, setOrders] = useState<SalesOrder[]>([]);
    const [filter, setFilter] = useState<OrderFilter>("all");
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [pendingId, setPendingId] = useState<string | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [refreshKey, setRefreshKey] = useState(0);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const requestRef = useRef<AbortController | null>(null);
    const mutationRef = useRef<AbortController | null>(null);
    const listRef = useRef<{ orders: SalesOrder[]; cursor: string | null; olderPages: boolean }>({ orders: [], cursor: null, olderPages: false });

    const refresh = useCallback(() => {
        if (mutationRef.current) return;
        requestRef.current?.abort();
        requestRef.current = null;
        listRef.current = { orders: [], cursor: null, olderPages: false };
        setLoading(true);
        setLoadingMore(false);
        setRefreshing(false);
        setNextCursor(null);
        setError("");
        setRefreshKey((value) => value + 1);
    }, []);

    function changeFilter(next: OrderFilter) {
        if (filter === next || mutationRef.current) return;
        refresh();
        setOrders([]);
        setNotice("");
        setFilter(next);
    }

    useEffect(() => {
        let active = true;
        async function load(background = false) {
            if (!active || requestRef.current || mutationRef.current) return;
            const controller = new AbortController();
            requestRef.current = controller;
            if (background) setRefreshing(true);
            try {
                const previous = listRef.current;
                const boundary = previous.olderPages ? previous.orders.at(-1) : undefined;
                const first = await fetchOrderPage(filter, null, controller.signal);
                const fresh = [...first.orders];
                let page = first;
                const seen = new Set<string>();
                // Refresh the displayed range, including older pages, without losing scroll position.
                while (boundary && page.nextCursor && (!fresh.length || compareOrderPosition(fresh.at(-1)!, boundary) > 0)) {
                    if (seen.has(page.nextCursor)) throw new Error("Не удалось обновить страницы заявок.");
                    seen.add(page.nextCursor);
                    page = await fetchOrderPage(filter, page.nextCursor, controller.signal);
                    fresh.push(...page.orders);
                }
                if (!active || controller.signal.aborted || requestRef.current !== controller) return;
                const displayed = boundary ? fresh.filter((order) => compareOrderPosition(order, boundary) >= 0) : fresh;
                const unique = [...new Map(displayed.map((order) => [order.id, order])).values()];
                const hasOlder = page.nextCursor !== null || (boundary && fresh.some((order) => compareOrderPosition(order, boundary) < 0));
                const cursor = boundary
                    ? hasOlder ? btoa(JSON.stringify({ created_at: boundary.created_at, id: boundary.id })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : null
                    : first.nextCursor;
                listRef.current = { orders: unique, cursor, olderPages: previous.olderPages };
                setOrders(unique);
                setNextCursor(cursor);
                setLastUpdated(new Date());
                setError("");
                if (background) {
                    const previousIds = new Set(previous.orders.map((order) => order.id));
                    const added = unique.filter((order) => !previousIds.has(order.id) && (!previous.orders[0] || compareOrderPosition(order, previous.orders[0]) > 0)).length;
                    if (added) setNotice(`Новых заявок: ${added}. Они добавлены в начало списка.`);
                }
            } catch (loadError) {
                if (active && !controller.signal.aborted) setError(readableError(loadError, "Не удалось обновить заявки. Проверьте соединение; повторим автоматически."));
            } finally {
                if (active && requestRef.current === controller) {
                    requestRef.current = null;
                    setLoading(false);
                    setRefreshing(false);
                }
            }
        }
        void load();
        const poll = () => { if (document.visibilityState === "visible") void load(true); };
        const timer = window.setInterval(poll, 12_000);
        window.addEventListener("focus", poll);
        document.addEventListener("visibilitychange", poll);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener("focus", poll);
            document.removeEventListener("visibilitychange", poll);
            requestRef.current?.abort();
            requestRef.current = null;
        };
    }, [filter, refreshKey]);

    useEffect(() => () => { mutationRef.current?.abort(); }, []);

    async function loadMore() {
        if (!nextCursor || loading || requestRef.current || mutationRef.current) return;
        const controller = new AbortController();
        requestRef.current = controller;
        setLoadingMore(true);
        setError("");
        try {
            const page = await fetchOrderPage(filter, nextCursor, controller.signal);
            if (controller.signal.aborted || requestRef.current !== controller) return;
            const merged = [...new Map([...listRef.current.orders, ...page.orders].map((order) => [order.id, order])).values()];
            listRef.current = { orders: merged, cursor: page.nextCursor, olderPages: true };
            setOrders(merged);
            setNextCursor(page.nextCursor);
        } catch (loadError) {
            if (!controller.signal.aborted) setError(readableError(loadError, "Не удалось загрузить следующие заявки. Попробуйте ещё раз."));
        } finally {
            if (requestRef.current === controller) { requestRef.current = null; setLoadingMore(false); }
        }
    }

    async function updateStatus(id: string, status: OrderStatus) {
        if (loading || loadingMore || mutationRef.current) return;
        requestRef.current?.abort();
        requestRef.current = null;
        const controller = new AbortController();
        mutationRef.current = controller;
        setPendingId(id);
        setRefreshing(false);
        setError("");
        setNotice("");
        try {
            const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, status }), signal: controller.signal });
            const result = await response.json() as { order?: SalesOrder; error?: string };
            if (!response.ok || !result.order) throw new Error(result.error || "Не удалось изменить статус заявки.");
            if (controller.signal.aborted) return;
            const changed = result.order;
            const updated = listRef.current.orders.flatMap((order) => order.id !== id ? [order] : filter === "all" || changed.status === filter ? [changed] : []);
            listRef.current = { ...listRef.current, orders: updated };
            setOrders(updated);
            setLastUpdated(new Date());
            setNotice(status === "confirmed" ? "Заявка принята в работу. Статус: «В процессе»." : status === "fulfilled" ? "Заявка выполнена." : "Заявка отменена.");
        } catch (updateError) {
            if (!controller.signal.aborted) setError(readableError(updateError, "Не удалось изменить статус заявки. Проверьте соединение и попробуйте ещё раз."));
        } finally {
            if (mutationRef.current === controller) { mutationRef.current = null; setPendingId(null); }
        }
    }

    return (
        <section className="sales-orders" aria-label="Заявки клиентов" aria-busy={loading || loadingMore || Boolean(pendingId)}>
            <div className="sales-orders-heading">
                <div><h2>Заявки из Telegram</h2><p>После подтверждения клиентом заявка появится здесь. Нажмите «Приступить», затем отметьте выполненный заказ.</p></div>
                <button className="business-secondary-button" type="button" onClick={refresh} disabled={loading || loadingMore || Boolean(pendingId)}><RefreshCw size={15} aria-hidden="true" />Обновить</button>
            </div>
            <div className="sales-orders-toolbar">
                <div className="sales-orders-filters" role="group" aria-label="Статус заявок">
                    {orderFilters.map((item) => <button type="button" key={item.value} className="business-option" aria-pressed={filter === item.value} disabled={Boolean(pendingId)} onClick={() => changeFilter(item.value)}>{item.label}</button>)}
                </div>
                <p className="sales-orders-sync">{refreshing ? "Обновляем…" : "Автообновление каждые 12 секунд"}{lastUpdated && !refreshing && <span>Обновлено в {lastUpdated.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Qyzylorda" })}</span>}</p>
            </div>
            <div aria-live="polite">
                {error && <p className="business-feedback business-feedback-error" role="alert">{error}</p>}
                {notice && <p className="business-feedback business-feedback-success"><Check size={16} aria-hidden="true" />{notice}</p>}
            </div>
            {loading && <p className="sales-orders-loading" role="status">Загружаем заявки…</p>}
            {!loading && !error && orders.length === 0 && <div className="sales-orders-empty"><ClipboardList size={30} aria-hidden="true" /><h3>{filter === "all" ? "Заявок пока нет" : "Заявок с этим статусом пока нет"}</h3><p>{filter === "all" ? "Подключите Telegram. Когда клиент проверит детали и напишет «Подтверждаю», заявка появится здесь автоматически." : "Выберите другой статус или откройте все заявки."}</p></div>}
            <div className="sales-orders-list">
                {orders.map((order) => {
                    const closed = order.status === "cancelled" || order.status === "fulfilled";
                    const busy = pendingId === order.id;
                    const phoneLink = order.customer_phone?.replace(/[^\d+]/g, "");
                    return (
                        <article className="sales-order-card" key={order.id}>
                            <div className="sales-order-top"><div><h3>Заявка № {order.id.slice(0, 8).toUpperCase()}</h3><span>{order.product_name || "Заказ клиента"} · {createdAt(order.created_at)}</span></div><span className={`sales-order-status sales-order-status-${order.status}`}>{statusLabels[order.status] ?? "Требует проверки"}</span></div>
                            <div className="sales-order-details">
                                <div className="sales-order-contact"><p><UserRound size={16} aria-hidden="true" /><span>{order.customer_name || "Имя не указано"}</span></p><p><Phone size={16} aria-hidden="true" />{phoneLink ? <a href={`tel:${phoneLink}`}>{order.customer_phone}</a> : <span>Телефон не указан</span>}</p><p><MapPin size={16} aria-hidden="true" /><span>{order.delivery_address || "Адрес нужно уточнить"}</span></p><p><Truck size={16} aria-hidden="true" /><span>{order.delivery_date || "Дата и время доставки не указаны"}</span></p>{order.occasion && <p className="sales-order-additional"><b>Повод:</b> {order.occasion}</p>}{order.note && <p className="sales-order-additional"><b>Пожелания:</b> {order.note}</p>}</div>
                                <div className="sales-order-price"><dl><div><dt>Товар</dt><dd>{money(order.product_price_kzt)}</dd></div><div><dt>Доставка</dt><dd>{money(order.delivery_fee_kzt, "Уточнит магазин")}</dd></div><div className="sales-order-total"><dt>Итого</dt><dd>{money(order.total_kzt, "Уточнит магазин")}</dd></div></dl><p>Цены сохранены при оформлении заявки.</p></div>
                            </div>
                            {!closed && <div className="sales-order-actions">
                                {order.status !== "confirmed" && <button className="business-primary-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "confirmed")}><Check size={15} aria-hidden="true" />{busy ? "Сохраняем…" : "Приступить"}</button>}
                                {order.status === "confirmed" && <button className="business-primary-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "fulfilled")}><Check size={15} aria-hidden="true" />{busy ? "Сохраняем…" : "Отметить выполненной"}</button>}
                                <button className="business-secondary-button business-cancel-button" type="button" disabled={loading || loadingMore || Boolean(pendingId)} onClick={() => void updateStatus(order.id, "cancelled")}>{busy ? "Сохраняем…" : "Отменить"}</button>
                            </div>}
                        </article>
                    );
                })}
            </div>
            {nextCursor && <button className="business-secondary-button" type="button" disabled={loading || loadingMore || refreshing || Boolean(pendingId)} onClick={() => void loadMore()}>{loadingMore ? "Загружаем…" : "Показать ещё"}</button>}
        </section>
    );
}
