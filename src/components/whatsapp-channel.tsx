"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, MessageCircle, Pause, Play, RefreshCw, ShieldCheck } from "lucide-react";
import "./whatsapp-channel.css";

type Connection = {
    id: string; display_phone: string; verified_name: string; active: boolean;
    connected_at: string | null; token_expires_at: string | null;
};
type Setup = { available: boolean; coexistence: boolean; connection: Connection | null; replyMode: "ai" | "faq" };
type Prepared = { nonce: string; appId: string; configId: string; version: string };
type Chat = { customer_phone: string; paused: boolean; updated_at: string };
type Turn = { id: number; customer_phone: string; content: string; reply: string | null; status: string; created_at: string };
type FBSDK = {
    init(options: { appId: string; cookie: boolean; xfbml: boolean; version: string }): void;
    login(callback: (response: { authResponse?: { code?: string } }) => void, options: Record<string, unknown>): void;
};
const facebook = () => (window as typeof window & { FB?: FBSDK }).FB;

async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/whatsapp/${path}`, {
        method, cache: "no-store", headers: { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: signal ?? AbortSignal.timeout(65_000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Не удалось связаться с WhatsApp. Повторите попытку.");
    return result;
}

export function WhatsAppChannel() {
    const [setup, setSetup] = useState<Setup | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [mode, setMode] = useState<"cloud" | "coexistence">("cloud");
    const [pin, setPin] = useState("");
    const [prepared, setPrepared] = useState<Prepared | null>(null);
    const [sdkReady, setSdkReady] = useState(false);
    const [chats, setChats] = useState<Chat[]>([]);
    const [turns, setTurns] = useState<Turn[]>([]);
    const [selected, setSelected] = useState("");
    const [inboxBusy, setInboxBusy] = useState(false);
    const pending = useRef<Prepared | null>(null);
    const session = useRef<{ code?: string; wabaId?: string; phoneId?: string }>({});
    const launched = useRef(false);
    const submitting = useRef(false);
    const registrationPin = useRef("");
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        api<Setup>("setup", "GET", undefined, controller.signal).then(setSetup).catch((cause) => {
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить WhatsApp.");
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => { controller.abort(); pending.current = null; launched.current = false; if (timer.current) clearTimeout(timer.current); };
    }, []);

    const complete = useCallback(async () => {
        const attempt = pending.current, info = session.current;
        if (!attempt || !launched.current || submitting.current || !info.code || !info.wabaId) return;
        submitting.current = true;
        if (timer.current) clearTimeout(timer.current);
        try {
            const result = await api<{ connection: Connection }>("connect", "POST", {
                nonce: attempt.nonce, code: info.code, wabaId: info.wabaId, phoneId: info.phoneId, pin: registrationPin.current,
            });
            setSetup((current) => current ? { ...current, connection: result.connection } : current);
            setNotice("WhatsApp подключён. Напишите на этот номер с другого телефона, чтобы проверить ответы бота.");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось подключить номер."); }
        finally {
            pending.current = null; session.current = {}; launched.current = false; submitting.current = false;
            registrationPin.current = ""; setPin(""); setPrepared(null); setBusy(false);
        }
    }, []);

    useEffect(() => {
        function receive(event: MessageEvent) {
            if (!["https://www.facebook.com", "https://web.facebook.com", "https://business.facebook.com"].includes(event.origin)
                || !launched.current || !pending.current) return;
            let message;
            try { message = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
            if (!message || message.type !== "WA_EMBEDDED_SIGNUP") return;
            if (["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"].includes(message.event)
                && typeof message.data?.waba_id === "string") {
                session.current = { ...session.current, wabaId: message.data.waba_id,
                    phoneId: typeof message.data.phone_number_id === "string" ? message.data.phone_number_id : undefined };
                void complete();
            }
            if (message.event === "ERROR" || message.event === "CANCEL") {
                setError(message.event === "CANCEL" ? "Подключение отменено. Ваш номер не активирован." : "Meta не завершила подключение. Попробуйте ещё раз.");
                if (timer.current) clearTimeout(timer.current);
                launched.current = false; pending.current = null; session.current = {}; setBusy(false); setPrepared(null);
            }
        }
        window.addEventListener("message", receive);
        return () => window.removeEventListener("message", receive);
    }, [complete]);

    useEffect(() => {
        if (!setup?.connection?.id) return;
        const controller = new AbortController();
        setInboxBusy(true);
        api<{ chats: Chat[]; messages: Turn[] }>(`inbox${selected ? `?customer=${encodeURIComponent(selected)}` : ""}`, "GET", undefined, controller.signal)
            .then((result) => { setChats(result.chats); setTurns(result.messages); })
            .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить диалоги."); })
            .finally(() => { if (!controller.signal.aborted) setInboxBusy(false); });
        return () => controller.abort();
    }, [setup, selected]);

    async function prepare() {
        if (busy) return;
        if (mode === "cloud" && !/^\d{6}$/.test(pin)) { setError("Задайте шестизначный PIN и сохраните его у себя: он защищает ваш бизнес-номер."); return; }
        setBusy(true); setError(""); setNotice(""); setSdkReady(false);
        try {
            const result = await api<Prepared>("setup", "POST", { mode });
            pending.current = result; registrationPin.current = pin; session.current = {}; setPrepared(result);
            if (facebook()) { facebook()!.init({ appId: result.appId, version: result.version, cookie: false, xfbml: false }); setSdkReady(true); }
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось начать подключение."); }
        finally { setBusy(false); }
    }

    function launch() {
        const sdk = facebook(), attempt = pending.current;
        if (!sdk || !attempt || !sdkReady || busy) return;
        setBusy(true); setError(""); launched.current = true;
        timer.current = setTimeout(() => {
            if (submitting.current) return;
            pending.current = null; launched.current = false; session.current = {}; setPrepared(null); setBusy(false);
            setError("Не удалось получить подтверждение от Meta. Проверьте блокировку всплывающих окон и попробуйте снова.");
        }, 120_000);
        // Called directly from a click so browsers allow the Meta popup.
        sdk.login((response) => {
            if (pending.current?.nonce !== attempt.nonce) return;
            if (!response.authResponse?.code) {
                if (timer.current) clearTimeout(timer.current);
                pending.current = null; launched.current = false; session.current = {}; setPrepared(null); setBusy(false);
                setError("Подключение не подтверждено в Meta. Можно попробовать снова."); return;
            }
            session.current = { ...session.current, code: response.authResponse.code };
            void complete();
        }, { config_id: attempt.configId, response_type: "code", override_default_response_type: true,
            extras: { setup: {}, sessionInfoVersion: "3", ...(mode === "coexistence" ? { featureType: "whatsapp_business_app_onboarding" } : {}) } });
    }

    async function changeActive(active: boolean) {
        setBusy(true); setError(""); setNotice("");
        try {
            const result = await api<{ connection: Connection }>("setup", "PATCH", { active });
            setSetup((current) => current ? { ...current, connection: result.connection } : current);
            setNotice(active ? "Бот снова отвечает клиентам." : "Бот приостановлен. Автоматические ответы отключены.");
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось изменить состояние бота."); }
        finally { setBusy(false); }
    }

    async function toggleChat(chat: Chat) {
        setBusy(true); setError("");
        try {
            await api("inbox", "PATCH", { customer: chat.customer_phone, paused: !chat.paused });
            setSetup((current) => current ? { ...current } : current);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось изменить диалог."); }
        finally { setBusy(false); }
    }

    const connection = setup?.connection;
    const expired = !!connection?.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now();
    const connected = !!connection?.connected_at && !expired;
    return (
        <section className="dashboard-panel whatsapp-channel" aria-label="WhatsApp для вашего бизнеса" aria-busy={loading}>
            {prepared && <Script id="floralai-facebook-sdk" src="https://connect.facebook.net/en_US/sdk.js" strategy="afterInteractive"
                onReady={() => {
                    const current = pending.current;
                    if (current && facebook()) { facebook()!.init({ appId: current.appId, version: current.version, cookie: false, xfbml: false }); setSdkReady(true); }
                }} onError={() => { setError("Не удалось загрузить окно Meta. Проверьте блокировщик рекламы и повторите попытку."); setPrepared(null); pending.current = null; }} />}
            <div className="whatsapp-heading">
                <span className="channel-card-icon"><MessageCircle size={20} /></span>
                <div><h2>Ваш помощник в WhatsApp</h2><p>Отвечает клиентам от имени вашего бизнеса по сохранённым данным, услугам и каталогу.</p></div>
                <span className={`channel-state ${connected && connection?.active ? "channel-available" : ""}`}>
                    {loading ? "Загрузка…" : connected ? connection?.active ? "ПОДКЛЮЧЁН" : "НА ПАУЗЕ" : expired ? "ОБНОВИТЕ ДОСТУП" : "НЕ ПОДКЛЮЧЁН"}
                </span>
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {connection && <div className="whatsapp-number"><Check size={17} /><div><strong>{connection.display_phone}</strong><span>{connection.verified_name}</span></div>
                {connected && <button type="button" className="business-text-button" disabled={busy} onClick={() => void changeActive(!connection.active)}>
                    {connection.active ? <Pause size={15} /> : <Play size={15} />}{connection.active ? "Приостановить бота" : "Включить бота"}
                </button>}
            </div>}
            {!loading && !setup?.available && <p className="whatsapp-pending">Подключение WhatsApp через Meta ещё готовится. Пока заполните профиль бизнеса и добавьте товары или услуги — бот будет отвечать по этим данным.</p>}
            {!loading && setup?.available && (!connected || !connection?.active) && <div className="whatsapp-connect-flow">
                <ol className="whatsapp-steps"><li>Сохраните данные вашего бизнеса</li><li>Подтвердите свой бизнес-номер в Meta</li><li>Напишите боту с другого телефона</li></ol>
                <label className="whatsapp-field">Какой номер подключаем?
                    <select disabled={busy || !!prepared} value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
                        <option value="cloud">Отдельный номер для бота</option>
                        {setup.coexistence && <option value="coexistence">Текущий номер WhatsApp Business с сохранением приложения</option>}
                    </select>
                </label>
                <p className="whatsapp-help">{mode === "coexistence"
                    ? "Meta проверит, доступно ли совместное использование приложения WhatsApp Business и бота для вашего номера."
                    : "Используйте отдельный бизнес-номер. Этот вариант не сохраняет работу номера в приложении WhatsApp. Для текущего номера бизнеса нужен режим совместной работы."}</p>
                {mode === "cloud" && <label className="whatsapp-field">PIN защиты бизнес-номера
                    <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={pin} disabled={busy || !!prepared}
                        onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))} placeholder="6 цифр" />
                    <small>Задайте новый PIN или введите действующий, если номер уже зарегистрирован. Сохраните его у себя.</small>
                </label>}
                <div className="whatsapp-actions">
                    {prepared ? <><button type="button" className="button button-blue" disabled={busy || !sdkReady} onClick={launch}>{busy ? "Ожидаем подтверждение Meta…" : sdkReady ? "Продолжить в Meta" : "Загружаем Meta…"}</button>
                        <button type="button" className="business-text-button" disabled={busy} onClick={() => { pending.current = null; setPrepared(null); }}>Отмена</button></>
                        : <button type="button" className="button button-blue" disabled={busy} onClick={() => void prepare()}><MessageCircle size={16} />{busy ? "Подготовка…" : "Подключить WhatsApp"}</button>}
                </div>
            </div>}
            <p className="whatsapp-security"><ShieldCheck size={16} />Каждый бизнес подключает собственный номер. Доступ можно приостановить в любой момент. Пока поддерживаются текстовые сообщения.</p>
            {setup?.available && <p className="whatsapp-help">{setup.replyMode === "ai"
                ? "Бот ведёт диалог по информации вашего бизнеса. Оформление заказов, запись и оплата в WhatsApp пока требуют участия сотрудника."
                : "Сейчас доступны ответы на частые вопросы: адрес, график, услуги, каталог и доставка. Оформление заказов и запись подтверждает сотрудник."}</p>}
            {connected && <div className="whatsapp-inbox">
                <div className="whatsapp-inbox-heading"><h3>Диалоги WhatsApp</h3><button type="button" className="business-text-button" disabled={inboxBusy} onClick={() => setSetup((current) => current ? { ...current } : current)}><RefreshCw size={14} />Обновить</button></div>
                <p className="whatsapp-help">Если клиент напишет «оператор», бот уступит разговор сотруднику. После ответа можно включить бота снова.</p>
                {chats.length === 0 ? <p className="whatsapp-empty">Пока нет сообщений. Отправьте вопрос на подключённый номер с другого телефона.</p> : <>
                    <div className="whatsapp-chat-tabs"><button type="button" aria-pressed={!selected} onClick={() => setSelected("")}>Все диалоги</button>{chats.map((chat) => <button type="button" key={chat.customer_phone} aria-pressed={selected === chat.customer_phone} onClick={() => setSelected(chat.customer_phone)}>+{chat.customer_phone}{chat.paused ? " · нужен сотрудник" : ""}</button>)}</div>
                    {selected && chats.filter((chat) => chat.customer_phone === selected).map((chat) => <button type="button" className="business-text-button" key={chat.customer_phone} disabled={busy} onClick={() => void toggleChat(chat)}>{chat.paused ? "Вернуть диалог боту" : "Отвечу сам — приостановить бота"}</button>)}
                    <div className="whatsapp-messages" aria-label="Последние сообщения">{[...turns].reverse().map((turn) => <article key={turn.id}>
                        <strong>+{turn.customer_phone}</strong><p>{turn.content}</p>
                        {turn.reply && <div className="whatsapp-reply"><b>{turn.status === "sent" ? "Бот" : "Ответ ещё не отправлен"}</b><p>{turn.reply}</p></div>}
                    </article>)}</div>
                </>}
            </div>}
        </section>
    );
}
