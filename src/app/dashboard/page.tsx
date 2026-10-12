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
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
    BusinessProfile,
    clearWorkspace,
    DemoWorkspace,
    useWorkspaceSession,
    writeWorkspace,
} from "@/lib/workspace";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { AssistantProduct } from "@/lib/catalog";
import { ProductCatalog } from "@/components/product-catalog";
import { TelegramChannel } from "@/components/telegram-channel";
import type { ChatTurn } from "@/lib/ai";
import "../floral-theme.css";

type View =
    | "overview"
    | "assistant"
    | "conversations"
    | "leads"
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
        { id: "leads", label: "Leads", icon: Users, group: "WORKSPACE" },
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
    return navigation.find((item) => item.id === requested)?.id ?? "overview";
}

function getServerDashboardView(): View {
    return "overview";
}

function TestChat({ workspace }: { workspace: DemoWorkspace }) {
    const { locale, t } = useLanguage();
    const business = workspace.business;
    const [history, setHistory] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);
    const [catalogError, setCatalogError] = useState("");
    const [products, setProducts] = useState<AssistantProduct[]>([]);

    useEffect(() => {
        let cancelled = false;
        async function loadProducts() {
            const client = createSupabaseBrowserClient();
            if (!client) return;
            const { data, error: catalogError } = await client
                .from("catalog_products")
                .select("name, price_kzt, description")
                .order("created_at", { ascending: false })
                .limit(30);
            if (catalogError) {
                console.error("Unable to load products for the assistant test.", catalogError);
                if (!cancelled) setCatalogError("Could not load catalog products.");
                return;
            }
            if (!cancelled) setProducts((data ?? []) as AssistantProduct[]);
        }
        void loadProducts();
        return () => {
            cancelled = true;
        };
    }, []);

    async function send(event?: FormEvent, suggestion?: string) {
        event?.preventDefault();
        const message = (suggestion ?? input).trim();
        if (!message || !business || busy) return;
        setInput("");
        setError(false);
        setHistory((current) => [...current, { role: "user", content: message }]);
        setBusy(true);
        try {
            const response = await fetch("/api/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message,
                    history: history.slice(-10),
                    context: {
                        businessName: business.name,
                        businessDescription: business.description,
                        services: business.services,
                        tone: business.tone,
                        language: locale === "ru" ? "Russian" : locale === "kk" ? "Kazakh" : "English",
                        products,
                    },
                }),
            });
            const result = (await response.json()) as { reply?: string };
            if (!response.ok || !result.reply) throw new Error("Request failed");
            setHistory((current) => [
                ...current,
                { role: "assistant", content: result.reply! },
            ]);
        } catch {
            setError(true);
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
                {catalogError && (
                    <div className="test-error" role="alert">
                        {t(catalogError)}
                    </div>
                )}
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
                        {t("Something went wrong.")}{" "}
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
                    "How much does it cost?",
                    "What are your hours?",
                    "I’d like to book",
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
    const { locale, t } = useLanguage();
    const numberLocale =
        locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";
    const { ready, workspace, authError } = useWorkspaceSession();
    const view = useSyncExternalStore(
        subscribeToDashboardView,
        getDashboardView,
        getServerDashboardView,
    );
    const [mobileNav, setMobileNav] = useState(false);
    const [knowledgeText, setKnowledgeText] = useState("");
    const [addingKnowledge, setAddingKnowledge] = useState(false);
    const [notice, setNotice] = useState("");

    function selectView(next: View) {
        setMobileNav(false);
        window.history.replaceState(null, "", `/dashboard?view=${next}`);
        window.dispatchEvent(new Event("bizai:viewchange"));
    }

    function saveKnowledge() {
        if (!workspace?.business) return;
        const updated = {
            ...workspace,
            business: { ...workspace.business, description: knowledgeText },
        };
        writeWorkspace(updated);
        setAddingKnowledge(false);
        setNotice("Business knowledge saved in this browser.");
        window.setTimeout(() => setNotice(""), 2600);
    }

    function updateBusiness<K extends keyof BusinessProfile>(
        key: K,
        value: BusinessProfile[K],
    ) {
        if (!workspace?.business) return;
        writeWorkspace({
            ...workspace,
            business: { ...workspace.business, [key]: value },
        });
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
                        <small>{t("Free workspace")}</small>
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
                            <span>{t("FREE PLAN")}</span>
                            <span>0 / 100</span>
                        </div>
                        <div className="usage-track">
                            <i />
                        </div>
                        <small>{t("conversations this month")}</small>
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
                        <b>{active.label}</b>
                    </div>
                    <div className="topbar-actions">
                        <LanguageSwitcher />
                        <span className="preview-pill">
                            <i /> {t("DEMO MODE")}
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
                    {!business ? (
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
                                                    <i className="status-dot" /> {t("Ready to test · not published")}
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
                                                    <span>{label}</span>
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
                                                <small>{t("No activity is tracked in demo mode.")}</small>
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
                                                        {label}
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
                                                {t("Try a few questions before you decide what to change.")}
                                            </p>
                                        </div>
                                        <span className="draft-status">
                                            <i /> {t("DRAFT · NOT PUBLISHED")}
                                        </span>
                                    </div>
                                    <div className="assistant-builder-grid">
                                        <section className="dashboard-panel assistant-settings-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>{t("How should your AI behave?")}</h2>
                                                    <p>
                                                        {t("Only uses the approved details in your business profile.")}
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
                                            />
                                            <label className="field-label" htmlFor="assistant-tone">
                                                {t("Tone of voice")}
                                            </label>
                                            <select
                                                className="dashboard-input"
                                                id="assistant-tone"
                                                defaultValue={business.tone}
                                            >
                                                <option value="Friendly">{t("Friendly")}</option>
                                                <option value="Professional">{t("Professional")}</option>
                                                <option value="Premium">{t("Premium")}</option>
                                                <option value="Casual">{t("Casual")}</option>
                                            </select>
                                            <label
                                                className="field-label"
                                                htmlFor="assistant-language"
                                            >
                                                {t("Language")}
                                            </label>
                                            <select
                                                className="dashboard-input"
                                                id="assistant-language"
                                                defaultValue={business.language}
                                            >
                                                <option value="English">{t("English")}</option>
                                                <option value="Russian">{t("Russian")}</option>
                                                <option value="Kazakh">{t("Kazakh")}</option>
                                            </select>
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

                            {view === "leads" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("CUSTOMER INTEREST")}</div>
                                            <h1>{t("Leads")}</h1>
                                            <p>{t("People who asked to hear from your business.")}</p>
                                        </div>
                                        <button
                                            className="button button-outline"
                                            type="button"
                                            disabled
                                        >
                                            <ArrowDownToLine size={14} /> {t("Export CSV")}
                                        </button>
                                    </div>
                                    <div className="dashboard-panel list-panel">
                                        <div className="list-toolbar">
                                            <div className="fake-search">
                                                <Search size={14} />
                                                <span>{t("Search leads...")}</span>
                                            </div>
                                            <button className="select-period" type="button">
                                                {t("All statuses")} <ChevronDown size={13} />
                                            </button>
                                        </div>
                                        <div className="lead-table">
                                            <div className="lead-row lead-head">
                                                <span>{t("NAME")}</span>
                                                <span>{t("PHONE")}</span>
                                                <span>{t("SOURCE")}</span>
                                                <span>{t("STATUS")}</span>
                                                <span>{t("CREATED")}</span>
                                            </div>
                                        </div>
                                        <EmptyState
                                            icon={Users}
                                            title="No leads yet"
                                            copy="When your assistant collects a name or contact request, you’ll find it here. No sample data is shown."
                                            action="Preview the assistant"
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
                                            <span>{t("Business profile · Edited in this browser")}</span>
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
                                                    {t("This information is available to your assistant in test mode.")}
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
                                            <span>{t("Updated in this browser")}</span>
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
                                    <div className="channel-cards">
                                        {[
                                            {
                                                name: "Website chat",
                                                detail: t("Embed a small chat on your website"),
                                                icon: Globe2,
                                                state: "AVAILABLE TO PREVIEW",
                                            },
                                            {
                                                name: "WhatsApp",
                                                detail: t("Connect your business WhatsApp number"),
                                                icon: MessageCircle,
                                                state: "NOT CONNECTED",
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
                                                            "Widget settings are in preview; website embedding is not active yet.",
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
                                        <Sparkles size={15} /> {t("Telegram is the free shared channel. WhatsApp and other channels need separate provider setup.")}
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
                                        <button
                                            type="button"
                                            className="button button-blue"
                                            onClick={() =>
                                                setNotice(
                                                    t("Settings are saved automatically in this browser."),
                                                )
                                            }
                                        >
                                            <Check size={14} /> {t("Save changes")}
                                        </button>
                                    </div>
                                    <section className="dashboard-panel settings-panel">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>{t("Business profile")}</h2>
                                                <p>
                                                    {t("Shown to your assistant as approved business information.")}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="settings-fields">
                                            <label>
                                                {t("Business name")}
                                                <input
                                                    className="dashboard-input"
                                                    value={business.name}
                                                    onChange={(event) =>
                                                        updateBusiness("name", event.target.value)
                                                    }
                                                />
                                            </label>
                                            <label>
                                                {t("Business type")}
                                                <select
                                                    className="dashboard-input"
                                                    value={business.category}
                                                    onChange={(event) =>
                                                        updateBusiness(
                                                            "category",
                                                            event.target.value as BusinessProfile["category"],
                                                        )
                                                    }
                                                >
                                                    <option value="Beauty & wellness">{t("Beauty & wellness")}</option>
                                                    <option value="Food & hospitality">{t("Food & hospitality")}</option>
                                                    <option value="Health & clinics">{t("Health & clinics")}</option>
                                                    <option value="Retail & online shop">{t("Retail & online shop")}</option>
                                                    <option value="Auto & home services">{t("Auto & home services")}</option>
                                                    <option value="Other">{t("Other")}</option>
                                                </select>
                                            </label>
                                            <label>
                                                {t("Location")}
                                                <input
                                                    className="dashboard-input"
                                                    value={business.location}
                                                    placeholder={t("City or address")}
                                                    onChange={(event) =>
                                                        updateBusiness("location", event.target.value)
                                                    }
                                                />
                                            </label>
                                            <label>
                                                {t("Opening hours")}
                                                <input
                                                    className="dashboard-input"
                                                    value={business.hours}
                                                    placeholder={t("e.g. Mon–Sat, 10:00–20:00")}
                                                    onChange={(event) =>
                                                        updateBusiness("hours", event.target.value)
                                                    }
                                                />
                                            </label>
                                        </div>
                                    </section>
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
                                            copy="Team invitations require account authentication, which is not configured in this local preview."
                                        />
                                    </section>
                                </>
                            )}

                            {view === "billing" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">{t("PLANS THAT GROW WITH YOU")}</div>
                                            <h1>{t("Plan & billing")}</h1>
                                            <p>{t("Your plan at a glance. No payment details stored.")}</p>
                                        </div>
                                    </div>
                                    <section className="dashboard-panel billing-panel">
                                        <div className="billing-plan-icon">
                                            <CreditCard size={18} />
                                        </div>
                                        <div className="billing-plan-copy">
                                            <span className="plan-label">{t("CURRENT PLAN")}</span>
                                            <h2>{t("Free")}</h2>
                                            <p>{t("Everything you need to try your assistant.")}</p>
                                        </div>
                                        <div className="billing-price">
                                            <b>₸0</b>
                                            <span>{t("per month")}</span>
                                        </div>
                                        <div className="billing-usage">
                                            <div>
                                                <span>{t("Monthly conversations")}</span>
                                                <b>0 / 100</b>
                                            </div>
                                            <div className="usage-track">
                                                <i />
                                            </div>
                                            <small>
                                                {t("No live conversations counted in this browser preview.")}
                                            </small>
                                        </div>
                                        <button
                                            type="button"
                                            className="button button-outline"
                                            disabled
                                            title={t("Stripe is not connected")}
                                        >
                                            {t("Manage subscription")}
                                        </button>
                                    </section>
                                    <div className="billing-plan-grid">
                                        {[
                                            {
                                                name: "Starter",
                                                price: "₸19,900",
                                                count: 2_000,
                                            },
                                            {
                                                name: "Business",
                                                price: "₸49,900",
                                                count: 10_000,
                                            },
                                        ].map((plan) => (
                                            <article key={plan.name}>
                                                <span className="plan-label">{t("GROWING BUSINESS")}</span>
                                                <h3>{t(plan.name)}</h3>
                                                <p>{plan.count.toLocaleString(numberLocale)} {t("conversations / month")}</p>
                                                <div>
                                                    <b>{plan.price}</b>
                                                    <span> / {t("per month")}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled
                                                    title={t("Card payments are not configured")}
                                                >
                                                    {t("Not configured")}
                                                </button>
                                            </article>
                                        ))}
                                    </div>
                                    <div className="integration-disclosure">
                                        <CreditCard size={14} /> {t("Billing preview only. Stripe and card payments are not configured. FloralAI never collects card numbers in this preview.")}
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </main>
            </div>
        </div>
    );
}
