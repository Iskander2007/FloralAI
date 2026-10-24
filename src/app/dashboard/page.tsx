"use client";

import {
    Activity,
    ArrowDownToLine,
    ArrowRight,
    ArrowUpRight,
    BadgeCheck,
    Bot,
    BookOpen,
    CalendarDays,
    Check,
    ChevronDown,
    CircleHelp,
    CreditCard,
    Flower2,
    Globe2,
    LayoutDashboard,
    LogOut,
    MessageCircle,
    MessageSquare,
    Plus,
    Search,
    Send,
    Settings,
    Sparkles,
    Users,
    X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { AppearanceControls } from "@/components/appearance-controls";
import {
    clearWorkspace,
    DemoWorkspace,
    useWorkspaceSession,
    writeWorkspace,
    saveBusinessProfile,
} from "@/lib/workspace";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { ProductCatalog } from "@/components/product-catalog";
import { TelegramChannel } from "@/components/telegram-channel";
import { WhatsAppChannel } from "@/components/whatsapp-channel";
import { BusinessProfileEditor } from "@/components/business-profile-editor";
import { SalesOrders } from "@/components/sales-orders";
import { SubscriptionBilling } from "@/components/subscription-billing";
import { SubscriptionAccessBanner } from "@/components/subscription-access-banner";
import { emptySalesState, type SalesState } from "@/lib/sales-assistant";
import type { ChatTurn } from "@/lib/ai";
import "../floral-theme.css";
import "../business-tools.css";

type View =
    | "overview"
    | "assistant"
    | "conversations"
    | "orders"
    | "knowledge"
    | "catalog"
    | "analytics"
    | "integrations"
    | "settings"
    | "billing";
const navigation: {
    id: View;
    label: string;
    icon: typeof LayoutDashboard;
    group: string;
}[] = [
        {
            id: "overview",
            label: "Overview",
            icon: LayoutDashboard,
            group: "WORKSPACE",
        },
        { id: "assistant", label: "AI assistant", icon: Bot, group: "WORKSPACE" },
        {
            id: "conversations",
            label: "Conversations",
            icon: MessageSquare,
            group: "WORKSPACE",
        },
        { id: "orders", label: "Заявки", icon: CalendarDays, group: "WORKSPACE" },
        { id: "catalog", label: "Product catalog", icon: Flower2, group: "BUILD" },
        {
            id: "knowledge",
            label: "Business knowledge",
            icon: BookOpen,
            group: "BUILD",
        },
        { id: "analytics", label: "Analytics", icon: Activity, group: "BUILD" },
        { id: "integrations", label: "Channels", icon: Globe2, group: "BUILD" },
        { id: "settings", label: "Settings", icon: Settings, group: "ACCOUNT" },
        {
            id: "billing",
            label: "Plan & billing",
            icon: CreditCard,
            group: "ACCOUNT",
        },
    ];

function subscribeToDashboardView(onChange: () => void) {
    window.addEventListener("popstate", onChange);
    window.addEventListener("bizai:viewchange", onChange);
    return () => {
        window.removeEventListener("popstate", onChange);
        window.removeEventListener("bizai:viewchange", onChange);
    };
}

function getDashboardView(): View {
    const requested = new URLSearchParams(window.location.search).get("view");
    if (requested === "leads") return "orders";
    return navigation.find((item) => item.id === requested)?.id ?? "overview";
}

function getServerDashboardView(): View {
    return "overview";
}

function TestChat({ workspace }: { workspace: DemoWorkspace }) {
    const { t } = useLanguage();
    const business = workspace.business;
    const [history, setHistory] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [salesState, setSalesState] = useState<SalesState>(emptySalesState);

    async function send(event?: FormEvent, suggestion?: string) {
        event?.preventDefault();
        const message = (suggestion ?? input).trim();
        if (!message || !business || busy) return;
        setInput("");
        setError("");
        setHistory((current) => [...current, { role: "user", content: message }]);
        setBusy(true);
        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message,
                    state: salesState,
                }),
            });
            const result = (await response.json()) as { reply?: string; state?: SalesState; error?: string };
            if (!response.ok || !result.reply) throw new Error(result.error ?? "Не удалось получить ответ.");
            if (result.state) setSalesState(result.state);
            setHistory((current) => [
                ...current,
                { role: "assistant", content: result.reply! },
            ]);
        } catch (error) {
            setError(error instanceof Error && !(error instanceof TypeError)
                ? error.message : "Не удалось получить ответ. Проверьте соединение и попробуйте снова.");
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="test-chat">
            <div className="test-chat-head">
                <span className="assistant-avatar">
                    <Sparkles size={15} />
                </span>
                <div>
                    <b>{business?.name || t("Your assistant")}</b>
                    <small>
                        <i className="online-dot" /> {t("Private test session")}
                    </small>
                </div>
                <span className="test-label">{t("TEST MODE")}</span>
            </div>
            <div className="test-chat-messages">
                <div className="test-message assistant-message">
                    {t("Hi, I’m your friendly assistant")} {t("for")}{" "}
                    {business?.name || t("your business")}.{" "}
                    {t("Ask me about your services, prices or hours.")}
                </div>
                {history.map((turn, index) => (
                    <div
                        key={index}
                        className={`test-message ${turn.role === "user" ? "user-message" : "assistant-message"}`}
                    >
                        {turn.content}
                    </div>
                ))}
                {busy && (
                    <div className="test-message assistant-message typing-bubble">
                        <i />
                        <i />
                        <i />
                    </div>
                )}
                {error && (
                    <div className="test-error" role="alert">
                        {error}{" "}
                        <button
                            type="button"
                            onClick={() => send(undefined, history.at(-1)?.content)}
                        >
                            {t("Try again")}
                        </button>
                    </div>
                )}
            </div>
            <div className="test-suggestions">
                {[
                    "Показать каталог",
                    "Какие часы работы?",
                    "Хочу заказать букет",
                ].map((item) => (
                    <button
                        key={item}
                        type="button"
                        onClick={() => send(undefined, item)}
                        disabled={busy}
                    >
                        {t(item)}
                    </button>
                ))}
            </div>
            <form className="test-composer" onSubmit={(event) => send(event)}>
                <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={t("Ask about your business...")}
                    maxLength={1000}
                    aria-label={t("Test your assistant")}
                />
                <button
                    type="submit"
                    disabled={!input.trim() || busy}
                    aria-label={t("Send message")}
                >
                    <Send size={15} />
                </button>
            </form>
        </div>
    );
}

function EmptyState({
    icon: Icon = MessageCircle,
    title,
    copy,
    action,
    onAction,
}: {
    icon?: typeof MessageCircle;
    title: string;
    copy: string;
    action?: string;
    onAction?: () => void;
}) {
    const { t } = useLanguage();
    return (
        <div className="empty-state">
            <span className="empty-icon">
                <Icon size={19} />
            </span>
            <h3>{t(title)}</h3>
            <p>{t(copy)}</p>
            {action && (
                <button
                    className="button button-outline"
                    type="button"
                    onClick={onAction}
                >
                    {t(action)} <ArrowRight size={14} />
                </button>
            )}
        </div>
    );
}

export default function DashboardPage() {
    const router = useRouter();
    const { t } = useLanguage();
    const { ready, workspace, authError, profileSyncError } = useWorkspaceSession();
    const view = useSyncExternalStore(
        subscribeToDashboardView,
        getDashboardView,
        getServerDashboardView,
    );
    const [mobileNav, setMobileNav] = useState(false);
    const [knowledgeText, setKnowledgeText] = useState("");
    const [addingKnowledge, setAddingKnowledge] = useState(false);
    const [notice, setNotice] = useState("");
    const [knowledgeSaving, setKnowledgeSaving] = useState(false);

    function selectView(next: View) {
        setMobileNav(false);
        window.history.replaceState(null, "", `/dashboard?view=${next}`);
        window.dispatchEvent(new Event("bizai:viewchange"));
    }

    async function saveKnowledge() {
        if (!workspace?.business || knowledgeSaving) return;
        setKnowledgeSaving(true);
        try {
            await saveBusinessProfile({ ...workspace.business, description: knowledgeText });
            setAddingKnowledge(false);
            setNotice("Информация сохранена в аккаунте и доступна Telegram-боту.");
        } catch (error) {
            setNotice(error instanceof Error ? error.message : "Не удалось сохранить информацию.");
        } finally { setKnowledgeSaving(false); }
    }

    async function signOut() {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
            const { error } = await supabase.auth.signOut();
            if (error) {
                setNotice("Could not sign out. Please try again.");
                return;
            }
        }
        clearWorkspace();
        router.push("/");
    }

    const business = workspace?.business;
    const active = navigation.find((item) => item.id === view) ?? navigation[0];

    if (!ready)
        return (
            <div className="dashboard-loading">
                <span className="loading-mark">
                    <Sparkles size={17} />
                </span>
                <p>{t("Opening your workspace...")}</p>
            </div>
        );
    if (authError)
        return (
            <main className="dashboard-loading">
                <p role="alert">{t("Unable to verify your account session.")}</p>
            </main>
        );
    if (!workspace)
        return (
            <main className="dashboard-loading">
                <span className="loading-mark">
                    <Sparkles size={17} />
                </span>
                <h1>{t("Start with your business.")}</h1>
                <p>{t("Create a local demo workspace to explore the dashboard.")}</p>
                <Link className="button button-blue" href="/signup">
                    {t("Create your AI assistant")} <ArrowRight size={15} />
                </Link>
            </main>
        );

    return (
        <div className="dashboard-shell">
            <aside className={`dashboard-sidebar ${mobileNav ? "sidebar-open" : ""}`}>
                <div className="sidebar-brand-row">
                    <Link href="/" className="brand">
                        <span className="brand-mark">
                            <Sparkles size={16} />
                        </span>
                        <span translate="no" className="brand-name">
                            Floral<span>AI</span>
                        </span>
                    </Link>
                    <button
                        className="sidebar-close"
                        type="button"
                        onClick={() => setMobileNav(false)}
                        aria-label={t("Close navigation")}
                    >
                        <X size={18} />
                    </button>
                </div>
                <button className="workspace-switcher" type="button">
                    <span className="workspace-avatar">
                        {business?.name.slice(0, 1) || "B"}
                    </span>
                    <span>
                        <b>{business?.name || "Your business"}</b>
                        <small>FloralAI</small>
                    </span>
                    <ChevronDown size={14} />
                </button>
                <nav className="dashboard-nav" aria-label={t("Workspace navigation")}>
                    {["WORKSPACE", "BUILD", "ACCOUNT"].map((group) => (
                        <div className="nav-group" key={group}>
                            <span className="nav-group-label">{t(group)}</span>
                            {navigation
                                .filter((item) => item.group === group)
                                .map(({ id, label, icon: Icon }) => (
                                    <button
                                        key={id}
                                        className={`dashboard-nav-item ${view === id ? "active" : ""}`}
                                        onClick={() => selectView(id)}
                                        type="button"
                                    >
                                        <Icon size={16} />
                                        <span>{t(label)}</span>
                                        {id === "conversations" && <i className="nav-count">0</i>}
                                    </button>
                                ))}
                        </div>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="plan-usage">
                        <div>
                            <span>Тариф и оплата</span>
                        </div>
                        <small>Пробная неделя и счета Kaspi</small>
                        <Link
                            href="/dashboard?view=billing"
                            onClick={() => selectView("billing")}
                        >
                            {t("Explore plans")} <ArrowUpRight size={12} />
                        </Link>
                    </div>
                    <div className="sidebar-user">
                        <span className="user-avatar">
                            {workspace.email.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                            <b>{workspace.email.split("@")[0]}</b>
                            <small>{t("Demo account")}</small>
                        </span>
                        <button
                            type="button"
                            aria-label={t("Sign out")}
                            onClick={() => void signOut()}
                        >
                            <LogOut size={15} />
                        </button>
                    </div>
                </div>
            </aside>

            <div className="dashboard-main">
                <header className="dashboard-topbar">
                    <button
                        type="button"
                        className="dashboard-menu"
                        onClick={() => setMobileNav(true)}
                        aria-label={t("Open navigation")}
                    >
                        <span />
                        <span />
                        <span />
                    </button>
                    <div className="breadcrumb">
                        <span>{t("Workspace")}</span>
                        <i>/</i>
                        <b>{t(active.label)}</b>
                    </div>
                    <div className="topbar-actions">
                        <AppearanceControls />
                        <span className="preview-pill">
                            <i /> Рабочий кабинет
                        </span>
                        <button
                            className="topbar-help"
                            type="button"
                            title={t("Help center coming soon")}
                        >
                            <CircleHelp size={17} />
                        </button>
                        <span className="user-avatar top-avatar">
                            {workspace.email.slice(0, 1).toUpperCase()}
                        </span>
                    </div>
                </header>
                <main className="dashboard-content">
                    {view !== "billing" && <SubscriptionAccessBanner />}
                    {view === "billing" ? <SubscriptionBilling /> : !business ? (
                        <section className="dashboard-welcome">
                            <div className="dashboard-empty-hero">
                                <div className="assistant-avatar large">
                                    <Sparkles size={19} />
                                </div>
                                <span className="eyebrow">{t("YOUR WORKSPACE IS READY")}</span>
                                <h1>
                                {t("Let’s meet your")}
                                    <br />
                                <span>{t("business first.")}</span>
                                </h1>
                                <p>{t("Tell us a little about what you do. We’ll use it to create a private AI assistant you can test right here.")}</p>
                                <Link className="button button-blue" href="/signup">
                                    {t("Create your AI assistant")} <ArrowRight size={15} />
                                </Link>
                                <small>{t("No channels connected. Nothing is live.")}</small>
                            </div>
                            <div className="dashboard-onboarding-art">
                                <div className="art-circle art-circle-one" />
                                <div className="art-circle art-circle-two" />
                                <span className="art-bot">
                                    <Bot size={27} />
                                </span>
                                <div className="art-note art-note-one">
                                    <Sparkles size={13} /> {t("Your business, understood")}
                                </div>
                                <div className="art-note art-note-two">
                                    <MessageCircle size={13} /> {t("Ready for a first chat")}
                                </div>
                            </div>
                        </section>
                    ) : (
                        <>
                            {notice && (
                                <div className="dashboard-toast">
                                    <Check size={14} /> {t(notice)}
                                </div>
                            )}
                            {profileSyncError && <p className="auth-error" role="alert">{profileSyncError} Проверьте сохранение в разделе «Настройки».</p>}
                            {view === "orders" && <SalesOrders />}
                            {view === "overview" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("WORKSPACE OVERVIEW")}</div>
                                            <h1>
                                                {t("Good morning")}
                                                <span>, {workspace.email.split("@")[0]}.</span>
                                            </h1>
                                            <p>
                                                {t("Here's what's happening with")} {business.name}{" "}
                                                {t("today.")}
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="button button-blue"
                                            onClick={() => selectView("assistant")}
                                        >
                                            <Sparkles size={15} /> {t("Test your AI")}
                                        </button>
                                    </div>
                                    <div className="assistant-status">
                                        <div className="status-left">
                                            <span className="status-icon">
                                                <Bot size={17} />
                                            </span>
                                            <div>
                                                <b>{business.name} {t("assistant")}</b>
                                                <span>
                                                    <i className="status-dot" /> Готов к проверке · Telegram в разделе «Каналы»
                                                </span>
                                            </div>
                                        </div>
                                        <div className="status-actions">
                                            <button
                                                type="button"
                                                onClick={() => selectView("assistant")}
                                            >
                                                {t("Test assistant")} <ArrowRight size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => selectView("settings")}
                                                aria-label={t("Assistant settings")}
                                            >
                                                <Settings size={15} />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="metrics-grid">
                                        {[
                                            {
                                                label: "Conversations",
                                                value: "0",
                                                icon: MessageSquare,
                                            },
                                            { label: "Leads captured", value: "0", icon: Users },
                                            { label: "Appointments", value: "0", icon: CalendarDays },
                                            { label: "Resolved by AI", value: "—", icon: Activity },
                                        ].map(({ label, value, icon: Icon }) => (
                                            <article className="metric-card" key={label}>
                                                <div>
                                                    <span>{t(label)}</span>
                                                    <Icon size={16} />
                                                </div>
                                                <strong>{value}</strong>
                                                <small>{t("Starts once your assistant is connected")}</small>
                                            </article>
                                        ))}
                                    </div>
                                    <section className="dashboard-panel overview-chart">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>{t("Conversations")}</h2>
                                                <p>{t("Customer conversations over time")}</p>
                                            </div>
                                            <button type="button" className="select-period">
                                                {t("Last 7 days")} <ChevronDown size={13} />
                                            </button>
                                        </div>
                                        <div className="empty-chart">
                                            <div className="chart-grid">
                                                <span>40</span>
                                                <span>30</span>
                                                <span>20</span>
                                                <span>10</span>
                                                <span>0</span>
                                            </div>
                                            <div className="chart-empty-copy">
                                                <span className="chart-icon">
                                                    <Activity size={18} />
                                                </span>
                                                <b>{t("Your chart starts with your first conversation.")}</b>
                                                <small>Статистика пока не подключена. Заявки доступны в разделе «Заявки».</small>
                                            </div>
                                            <div className="chart-days">
                                                <span>{t("MON")}</span>
                                                <span>{t("TUE")}</span>
                                                <span>{t("WED")}</span>
                                                <span>{t("THU")}</span>
                                                <span>{t("FRI")}</span>
                                                <span>{t("SAT")}</span>
                                                <span>{t("SUN")}</span>
                                            </div>
                                        </div>
                                    </section>
                                    <div className="dashboard-two-col">
                                        <section className="dashboard-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>{t("Recent conversations")}</h2>
                                                    <p>{t("Latest messages from your channels")}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => selectView("conversations")}
                                                    className="panel-link"
                                                >
                                                    {t("View all")} <ArrowRight size={13} />
                                                </button>
                                            </div>
                                            <EmptyState
                                                title="No conversations yet"
                                                copy="Once your AI starts talking with customers, conversations will show up here."
                                                action="Test your AI"
                                                onAction={() => selectView("assistant")}
                                            />
                                        </section>
                                        <section className="dashboard-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>{t("Quick actions")}</h2>
                                                    <p>{t("Keep building your assistant")}</p>
                                                </div>
                                            </div>
                                            <div className="quick-actions">
                                                {[
                                                    {
                                                        icon: BookOpen,
                                                        label: "Add business knowledge",
                                                        view: "knowledge" as View,
                                                    },
                                                    {
                                                        icon: Bot,
                                                        label: "Test your assistant",
                                                        view: "assistant" as View,
                                                    },
                                                    {
                                                        icon: Globe2,
                                                        label: "Connect a channel",
                                                        view: "integrations" as View,
                                                    },
                                                    {
                                                        icon: Users,
                                                        label: "Invite your team",
                                                        view: "settings" as View,
                                                    },
                                                ].map(({ icon: Icon, label, view: target }) => (
                                                    <button
                                                        type="button"
                                                        key={label}
                                                        onClick={() => selectView(target)}
                                                    >
                                                        <span>
                                                            <Icon size={15} />
                                                        </span>
                                                        {t(label)}
                                                        <ArrowRight size={13} />
                                                    </button>
                                                ))}
                                            </div>
                                        </section>
                                    </div>
                                </>
                            )}

                            {view === "assistant" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("PRIVATE TEST SPACE")}</div>
                                            <h1>{t("Meet your assistant.")}</h1>
                                            <p>
                                                Проверьте подбор товаров и сбор контактов. Тестовый чат не создаёт заявки; заявки клиентов сохраняются через подключённый Telegram-бот.
                                            </p>
                                        </div>
                                        <span className="draft-status">
                                            <i /> Тест без создания заявок
                                        </span>
                                    </div>
                                    <div className="assistant-builder-grid">
                                        <section className="dashboard-panel assistant-settings-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>Как работает ваш ассистент</h2>
                                                    <p>
                                                        Использует сохранённый профиль бизнеса и товары из каталога.
                                                    </p>
                                                </div>
                                            </div>
                                            <label className="field-label" htmlFor="assistant-name">
                                                {t("Assistant name")}
                                            </label>
                                            <input
                                                className="dashboard-input"
                                                id="assistant-name"
                                                defaultValue={`${business.name} ${t("assistant")}`}
                                                readOnly
                                            />
                                            <p className="field-label">Ассистент общается на русском: уточняет повод и бюджет, помогает выбрать букет и собирает контакты.</p>
                                            <div className="guardrail-note">
                                                <BadgeCheck size={15} />
                                                <span>
                                                    <b>{t("Grounded in your business")}</b>
                                                    <small>
                                                        {t("If your assistant doesn’t know, it’ll say so instead of guessing.")}
                                                    </small>
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="button button-outline full-button"
                                                onClick={() => selectView("knowledge")}
                                            >
                                                {t("Review business knowledge")} <ArrowRight size={14} />
                                            </button>
                                        </section>
                                        <TestChat workspace={workspace} />
                                    </div>
                                </>
                            )}

                            {view === "conversations" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("CUSTOMER MESSAGES")}</div>
                                            <h1>{t("Conversations")}</h1>
                                            <p>
                                                {t("Every conversation in one place, with a human handoff when it matters.")}
                                            </p>
                                        </div>
                                        <button
                                            className="button button-outline"
                                            type="button"
                                            disabled
                                        >
                                            <Search size={14} /> {t("Search")}
                                        </button>
                                    </div>
                                    <div className="dashboard-panel list-panel">
                                        <div className="conversation-filters">
                                            <button className="filter-active" type="button">
                                                {t("All")} <span>0</span>
                                            </button>
                                            <button type="button">
                                                {t("Needs attention")} <span>0</span>
                                            </button>
                                            <button type="button">
                                                {t("Resolved")} <span>0</span>
                                            </button>
                                        </div>
                                        <EmptyState
                                            title="No conversations yet"
                                            copy="When customers message your assistant, the conversation and handoff status will appear here."
                                            action="Test your AI"
                                            onAction={() => selectView("assistant")}
                                        />
                                    </div>
                                </>
                            )}

                            {view === "knowledge" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("WHAT YOUR AI KNOWS")}</div>
                                            <h1>{t("Business knowledge")}</h1>
                                            <p>{t("Answers come from information you choose to share.")}</p>
                                        </div>
                                        <div className="heading-actions">
                                            <button
                                                type="button"
                                                className="button button-outline"
                                                disabled
                                                title={t("Document upload is not configured")}
                                            >
                                                <ArrowDownToLine size={14} /> {t("Upload document")}
                                            </button>
                                            <button
                                                type="button"
                                                className="button button-blue"
                                                onClick={() => {
                                                    setKnowledgeText(business.description);
                                                    setAddingKnowledge(true);
                                                }}
                                            >
                                                <Plus size={15} /> {t("Add information")}
                                            </button>
                                        </div>
                                    </div>
                                    <div className="knowledge-summary">
                                        <span className="knowledge-summary-icon">
                                            <BookOpen size={17} />
                                        </span>
                                        <div>
                                            <b>{business.name}</b>
                                            <span>Профиль бизнеса · сохранён в аккаунте</span>
                                        </div>
                                        <span className="knowledge-ready">
                                            <Check size={12} /> {t("APPROVED")}
                                        </span>
                                    </div>
                                    <div className="dashboard-panel knowledge-editor">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>{t("About your business")}</h2>
                                                <p>
                                                    После сохранения эта информация доступна Telegram-боту и тестовому чату.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                className="quiet-button"
                                                onClick={() =>
                                                    setAddingKnowledge((current) => !current)
                                                }
                                            >
                                                {t(addingKnowledge ? "Cancel" : "Edit")}
                                            </button>
                                        </div>
                                        {addingKnowledge ? (
                                            <>
                                                <textarea
                                                    className="knowledge-textarea"
                                                    value={knowledgeText}
                                                    onChange={(event) =>
                                                        setKnowledgeText(event.target.value)
                                                    }
                                                    rows={8}
                                                    maxLength={4000}
                                                    placeholder={t("Describe your business, services, prices, opening hours and policies...")}
                                                />
                                                <div className="knowledge-save-row">
                                                    <small>
                                                        {knowledgeText.length} / 4,000 {t("characters")}
                                                    </small>
                                                    <button
                                                        type="button"
                                                        onClick={saveKnowledge}
                                                        disabled={knowledgeSaving}
                                                        className="button button-blue"
                                                    >
                                                        {t("Save information")} <Check size={14} />
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <p className="knowledge-description">
                                                {business.description ||
                                                    t("No description added yet. Add your services, opening hours, policies and prices so your assistant can give useful answers.")}
                                            </p>
                                        )}

                                        <div className="knowledge-meta">
                                            <span>
                                                <BadgeCheck size={14} /> {t("Uses approved business information only")}
                                            </span>
                                            <span>Данные сохранённого профиля</span>
                                        </div>
                                    </div>
                                    <div className="knowledge-categories">
                                        {[
                                            t("Services & prices"),
                                            t("Opening hours"),
                                            t("Frequently asked questions"),
                                            t("Business policies"),
                                        ].map((item) => (
                                            <div key={item}>
                                                <span className="category-icon">
                                                    <BookOpen size={15} />
                                                </span>
                                                <span>
                                                    <b>{item}</b>
                                                    <small>{t("Part of your business profile")}</small>
                                                </span>
                                                <Check size={14} />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {view === "catalog" && <ProductCatalog />}

                            {view === "analytics" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("A CLEARER PICTURE")}</div>
                                            <h1>{t("Analytics")}</h1>
                                            <p>
                                                {t("Track the conversations that help your business grow.")}
                                            </p>
                                        </div>
                                        <button className="select-period" type="button" disabled>
                                            {t("Last 30 days")} <ChevronDown size={13} />
                                        </button>
                                    </div>
                                    <div className="metrics-grid">
                                        {[
                                            { label: "Conversations", value: "0" },
                                            { label: "Leads", value: "0" },
                                            { label: "Conversion rate", value: "—" },
                                            { label: "Avg. response", value: "—" },
                                        ].map((item) => (
                                            <article className="metric-card" key={item.label}>
                                                <div>
                                                    <span>{item.label}</span>
                                                    <Activity size={15} />
                                                </div>
                                                <strong>{item.value}</strong>
                                                <small>{t("Available when a channel is connected")}</small>
                                            </article>
                                        ))}
                                    </div>
                                    <div className="dashboard-panel analytics-empty">
                                        <EmptyState
                                            icon={Activity}
                                            title="Your analytics start with a real conversation"
                                            copy="We don’t fill this view with sample numbers. Connect a channel when you’re ready to see your business activity."
                                            action="Explore channels"
                                            onAction={() => selectView("integrations")}
                                        />
                                    </div>
                                </>
                            )}

                            {view === "integrations" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">
                                                {t("MEET CUSTOMERS WHERE THEY ARE")}
                                            </div>
                                            <h1>{t("Channels")}</h1>
                                            <p>
                                                {t("Choose where your assistant can talk with customers.")}
                                            </p>
                                        </div>
                                    </div>
                                    <WhatsAppChannel />
                                    <div className="channel-cards">
                                        {[
                                            {
                                                name: "Website chat",
                                                detail: t("Embed a small chat on your website"),
                                                icon: Globe2,
                                                state: "AVAILABLE TO PREVIEW",
                                            },
                                            {
                                                name: "Instagram",
                                                detail: t("Reply to Instagram direct messages"),
                                                icon: MessageCircle,
                                                state: "COMING SOON",
                                            },
                                            {
                                                name: "Facebook",
                                                detail: t("Respond to messages from your page"),
                                                icon: MessageCircle,
                                                state: "COMING SOON",
                                            },
                                            {
                                                name: "Kaspi Pay",
                                                detail: t("Payment connection for Kazakhstan"),
                                                icon: CreditCard,
                                                state: "PLANNED",
                                            },
                                        ].map(({ name, detail, icon: Icon, state }) => (
                                            <article className="channel-card" key={name}>
                                                <span className="channel-card-icon">
                                                    <Icon size={18} />
                                                </span>
                                                <div>
                                                    <b>{name}</b>
                                                    <p>{detail}</p>
                                                </div>
                                                <span
                                                    className={`channel-state ${state === "AVAILABLE TO PREVIEW" ? "channel-available" : ""}`}
                                                >
                                                    {t(state)}
                                                </span>
                                                <button
                                                    type="button"
                                                    className="channel-connect"
                                                    disabled={state !== "AVAILABLE TO PREVIEW"}
                                                    onClick={() =>
                                                        setNotice(
                                                            "Виджет доступен для предпросмотра. Встраивание на другие сайты пока не подключено.",
                                                        )
                                                    }
                                                >
                                                    {state === "AVAILABLE TO PREVIEW" ? t("Set up") : ""}
                                                </button>
                                            </article>
                                        ))}
                                    </div>
                                    <TelegramChannel
                                        businessName={business?.name ?? ""}
                                    />
                                    <div className="integration-disclosure">
                                        <Sparkles size={15} /> Telegram-бот сохраняет заявки в кабинете. WhatsApp подключается к собственному номеру бизнеса через Meta; состояние подключения показано выше.
                                    </div>
                                </>
                            )}

                            {view === "settings" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">
                                                {t("THE DETAILS THAT MAKE IT YOURS")}
                                            </div>
                                            <h1>{t("Settings")}</h1>
                                            <p>
                                                {t("Manage your business profile and assistant preferences.")}
                                            </p>
                                        </div>
                                    </div>
                                    <BusinessProfileEditor
                                        profile={business}
                                        onSaved={(profile) => {
                                            if (workspace) writeWorkspace({ ...workspace, business: profile });
                                            setNotice("Профиль бизнеса сохранён в аккаунте.");
                                        }}
                                    />
                                    <section className="dashboard-panel settings-panel">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>{t("Team access")}</h2>
                                                <p>{t("Invite a teammate to help with conversations.")}</p>
                                            </div>
                                            <button
                                                type="button"
                                                className="button button-outline"
                                                disabled
                                                title={t("Team invitations are not configured")}
                                            >
                                                <Plus size={14} /> {t("Invite member")}
                                            </button>
                                        </div>
                                        <EmptyState
                                            icon={Users}
                                            title="Just you for now"
                                            copy="Приглашения сотрудников пока недоступны."
                                        />
                                    </section>
                                </>
                            )}

                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
