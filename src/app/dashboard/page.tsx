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
import {
    BusinessProfile,
    clearWorkspace,
    DemoWorkspace,
    useDemoWorkspace,
    writeWorkspace,
} from "@/lib/workspace";
import type { ChatTurn } from "@/lib/ai";

type View =
    | "overview"
    | "assistant"
    | "conversations"
    | "leads"
    | "knowledge"
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
    const business = workspace.business;
    const [history, setHistory] = useState<ChatTurn[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(false);

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
                        language: business.language,
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
                    <b>{business?.name || "Your assistant"}</b>
                    <small>
                        <i className="online-dot" /> Private test session
                    </small>
                </div>
                <span className="test-label">TEST MODE</span>
            </div>
            <div className="test-chat-messages">
                <div className="test-message assistant-message">
                    Hi, I’m your {business?.tone.toLowerCase() || "friendly"} assistant
                    for {business?.name || "your business"}. Ask me about your services,
                    prices or hours.
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
                        Something went wrong.{" "}
                        <button
                            type="button"
                            onClick={() => send(undefined, history.at(-1)?.content)}
                        >
                            Try again
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
                        {item}
                    </button>
                ))}
            </div>
            <form className="test-composer" onSubmit={(event) => send(event)}>
                <input
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="Ask about your business..."
                    aria-label="Test your assistant"
                />
                <button
                    type="submit"
                    disabled={!input.trim() || busy}
                    aria-label="Send message"
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
    return (
        <div className="empty-state">
            <span className="empty-icon">
                <Icon size={19} />
            </span>
            <h3>{title}</h3>
            <p>{copy}</p>
            {action && (
                <button
                    className="button button-outline"
                    type="button"
                    onClick={onAction}
                >
                    {action} <ArrowRight size={14} />
                </button>
            )}
        </div>
    );
}

export default function DashboardPage() {
    const router = useRouter();
    const { ready, workspace } = useDemoWorkspace();
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

    const business = workspace?.business;
    const active = navigation.find((item) => item.id === view) ?? navigation[0];

    if (!ready)
        return (
            <div className="dashboard-loading">
                <span className="loading-mark">
                    <Sparkles size={17} />
                </span>
                <p>Opening your workspace...</p>
            </div>
        );
    if (!workspace)
        return (
            <main className="dashboard-loading">
                <span className="loading-mark">
                    <Sparkles size={17} />
                </span>
                <h1>Start with your business.</h1>
                <p>Create a local demo workspace to explore the dashboard.</p>
                <Link className="button button-blue" href="/signup">
                    Create your AI assistant <ArrowRight size={15} />
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
                        <span>
                            biz<span>ai</span>
                        </span>
                    </Link>
                    <button
                        className="sidebar-close"
                        type="button"
                        onClick={() => setMobileNav(false)}
                        aria-label="Close navigation"
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
                        <small>Free workspace</small>
                    </span>
                    <ChevronDown size={14} />
                </button>
                <nav className="dashboard-nav" aria-label="Workspace navigation">
                    {["WORKSPACE", "BUILD", "ACCOUNT"].map((group) => (
                        <div className="nav-group" key={group}>
                            <span className="nav-group-label">{group}</span>
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
                                        <span>{label}</span>
                                        {id === "conversations" && <i className="nav-count">0</i>}
                                    </button>
                                ))}
                        </div>
                    ))}
                </nav>
                <div className="sidebar-bottom">
                    <div className="plan-usage">
                        <div>
                            <span>FREE PLAN</span>
                            <span>0 / 100</span>
                        </div>
                        <div className="usage-track">
                            <i />
                        </div>
                        <small>conversations this month</small>
                        <Link
                            href="/dashboard?view=billing"
                            onClick={() => selectView("billing")}
                        >
                            Explore plans <ArrowUpRight size={12} />
                        </Link>
                    </div>
                    <div className="sidebar-user">
                        <span className="user-avatar">
                            {workspace.email.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                            <b>{workspace.email.split("@")[0]}</b>
                            <small>Demo account</small>
                        </span>
                        <button
                            type="button"
                            aria-label="Sign out"
                            onClick={() => {
                                clearWorkspace();
                                router.push("/");
                            }}
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
                        aria-label="Open navigation"
                    >
                        <span />
                        <span />
                        <span />
                    </button>
                    <div className="breadcrumb">
                        <span>Workspace</span>
                        <i>/</i>
                        <b>{active.label}</b>
                    </div>
                    <div className="topbar-actions">
                        <span className="preview-pill">
                            <i /> DEMO MODE
                        </span>
                        <button
                            className="topbar-help"
                            type="button"
                            title="Help center coming soon"
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
                                <span className="eyebrow">YOUR WORKSPACE IS READY</span>
                                <h1>
                                    Let’s meet your
                                    <br />
                                    <span>business first.</span>
                                </h1>
                                <p>
                                    Tell us a little about what you do. We’ll use it to create a
                                    private AI assistant you can test right here.
                                </p>
                                <Link className="button button-blue" href="/signup">
                                    Create your AI assistant <ArrowRight size={15} />
                                </Link>
                                <small>No channels connected. Nothing is live.</small>
                            </div>
                            <div className="dashboard-onboarding-art">
                                <div className="art-circle art-circle-one" />
                                <div className="art-circle art-circle-two" />
                                <span className="art-bot">
                                    <Bot size={27} />
                                </span>
                                <div className="art-note art-note-one">
                                    <Sparkles size={13} /> Your business, understood
                                </div>
                                <div className="art-note art-note-two">
                                    <MessageCircle size={13} /> Ready for a first chat
                                </div>
                            </div>
                        </section>
                    ) : (
                        <>
                            {notice && (
                                <div className="dashboard-toast">
                                    <Check size={14} /> {notice}
                                </div>
                            )}
                            {view === "overview" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">MONDAY, SEPTEMBER 28</div>
                                            <h1>
                                                Good morning
                                                <span>, {workspace.email.split("@")[0]}.</span>
                                            </h1>
                                            <p>
                                                Here&apos;s what&apos;s happening with {business.name}{" "}
                                                today.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="button button-blue"
                                            onClick={() => selectView("assistant")}
                                        >
                                            <Sparkles size={15} /> Test your AI
                                        </button>
                                    </div>
                                    <div className="assistant-status">
                                        <div className="status-left">
                                            <span className="status-icon">
                                                <Bot size={17} />
                                            </span>
                                            <div>
                                                <b>{business.name} assistant</b>
                                                <span>
                                                    <i className="status-dot" /> Ready to test · not
                                                    published
                                                </span>
                                            </div>
                                        </div>
                                        <div className="status-actions">
                                            <button
                                                type="button"
                                                onClick={() => selectView("assistant")}
                                            >
                                                Test assistant <ArrowRight size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => selectView("settings")}
                                                aria-label="Assistant settings"
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
                                                <small>Starts once your assistant is connected</small>
                                            </article>
                                        ))}
                                    </div>
                                    <section className="dashboard-panel overview-chart">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>Conversations</h2>
                                                <p>Customer conversations over time</p>
                                            </div>
                                            <button type="button" className="select-period">
                                                Last 7 days <ChevronDown size={13} />
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
                                                <b>Your chart starts with your first conversation.</b>
                                                <small>No activity is tracked in demo mode.</small>
                                            </div>
                                            <div className="chart-days">
                                                <span>MON</span>
                                                <span>TUE</span>
                                                <span>WED</span>
                                                <span>THU</span>
                                                <span>FRI</span>
                                                <span>SAT</span>
                                                <span>SUN</span>
                                            </div>
                                        </div>
                                    </section>
                                    <div className="dashboard-two-col">
                                        <section className="dashboard-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>Recent conversations</h2>
                                                    <p>Latest messages from your channels</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => selectView("conversations")}
                                                    className="panel-link"
                                                >
                                                    View all <ArrowRight size={13} />
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
                                                    <h2>Quick actions</h2>
                                                    <p>Keep building your assistant</p>
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
                                            <div className="eyebrow">PRIVATE TEST SPACE</div>
                                            <h1>Meet your assistant.</h1>
                                            <p>
                                                Try a few questions before you decide what to change.
                                            </p>
                                        </div>
                                        <span className="draft-status">
                                            <i /> DRAFT · NOT PUBLISHED
                                        </span>
                                    </div>
                                    <div className="assistant-builder-grid">
                                        <section className="dashboard-panel assistant-settings-panel">
                                            <div className="panel-heading">
                                                <div>
                                                    <h2>How should your AI behave?</h2>
                                                    <p>
                                                        Only uses the approved details in your business
                                                        profile.
                                                    </p>
                                                </div>
                                            </div>
                                            <label className="field-label" htmlFor="assistant-name">
                                                Assistant name
                                            </label>
                                            <input
                                                className="dashboard-input"
                                                id="assistant-name"
                                                defaultValue={`${business.name} assistant`}
                                            />
                                            <label className="field-label" htmlFor="assistant-tone">
                                                Tone of voice
                                            </label>
                                            <select
                                                className="dashboard-input"
                                                id="assistant-tone"
                                                defaultValue={business.tone}
                                            >
                                                <option>Friendly</option>
                                                <option>Professional</option>
                                                <option>Premium</option>
                                                <option>Casual</option>
                                            </select>
                                            <label
                                                className="field-label"
                                                htmlFor="assistant-language"
                                            >
                                                Language
                                            </label>
                                            <select
                                                className="dashboard-input"
                                                id="assistant-language"
                                                defaultValue={business.language}
                                            >
                                                <option>English</option>
                                                <option>Russian</option>
                                                <option>Kazakh</option>
                                            </select>
                                            <div className="guardrail-note">
                                                <BadgeCheck size={15} />
                                                <span>
                                                    <b>Grounded in your business</b>
                                                    <small>
                                                        If your assistant doesn’t know, it’ll say so instead
                                                        of guessing.
                                                    </small>
                                                </span>
                                            </div>
                                            <button
                                                type="button"
                                                className="button button-outline full-button"
                                                onClick={() => selectView("knowledge")}
                                            >
                                                Review business knowledge <ArrowRight size={14} />
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
                                            <div className="eyebrow">CUSTOMER MESSAGES</div>
                                            <h1>Conversations</h1>
                                            <p>
                                                Every conversation in one place, with a human handoff
                                                when it matters.
                                            </p>
                                        </div>
                                        <button
                                            className="button button-outline"
                                            type="button"
                                            disabled
                                        >
                                            <Search size={14} /> Search
                                        </button>
                                    </div>
                                    <div className="dashboard-panel list-panel">
                                        <div className="conversation-filters">
                                            <button className="filter-active" type="button">
                                                All <span>0</span>
                                            </button>
                                            <button type="button">
                                                Needs attention <span>0</span>
                                            </button>
                                            <button type="button">
                                                Resolved <span>0</span>
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
                                            <div className="eyebrow">CUSTOMER INTEREST</div>
                                            <h1>Leads</h1>
                                            <p>People who asked to hear from your business.</p>
                                        </div>
                                        <button
                                            className="button button-outline"
                                            type="button"
                                            disabled
                                        >
                                            <ArrowDownToLine size={14} /> Export CSV
                                        </button>
                                    </div>
                                    <div className="dashboard-panel list-panel">
                                        <div className="list-toolbar">
                                            <div className="fake-search">
                                                <Search size={14} />
                                                <span>Search leads...</span>
                                            </div>
                                            <button className="select-period" type="button">
                                                All statuses <ChevronDown size={13} />
                                            </button>
                                        </div>
                                        <div className="lead-table">
                                            <div className="lead-row lead-head">
                                                <span>NAME</span>
                                                <span>PHONE</span>
                                                <span>SOURCE</span>
                                                <span>STATUS</span>
                                                <span>CREATED</span>
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
                                            <div className="eyebrow">WHAT YOUR AI KNOWS</div>
                                            <h1>Business knowledge</h1>
                                            <p>Answers come from information you choose to share.</p>
                                        </div>
                                        <div className="heading-actions">
                                            <button
                                                type="button"
                                                className="button button-outline"
                                                disabled
                                                title="Document upload is not configured"
                                            >
                                                <ArrowDownToLine size={14} /> Upload document
                                            </button>
                                            <button
                                                type="button"
                                                className="button button-blue"
                                                onClick={() => {
                                                    setKnowledgeText(business.description);
                                                    setAddingKnowledge(true);
                                                }}
                                            >
                                                <Plus size={15} /> Add information
                                            </button>
                                        </div>
                                    </div>
                                    <div className="knowledge-summary">
                                        <span className="knowledge-summary-icon">
                                            <BookOpen size={17} />
                                        </span>
                                        <div>
                                            <b>{business.name}</b>
                                            <span>Business profile · Edited in this browser</span>
                                        </div>
                                        <span className="knowledge-ready">
                                            <Check size={12} /> APPROVED
                                        </span>
                                    </div>
                                    <div className="dashboard-panel knowledge-editor">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>About your business</h2>
                                                <p>
                                                    This information is available to your assistant in
                                                    test mode.
                                                </p>
                                            </div>
                                            <button
                                                type="button"
                                                className="quiet-button"
                                                onClick={() =>
                                                    setAddingKnowledge((current) => !current)
                                                }
                                            >
                                                {addingKnowledge ? "Cancel" : "Edit"}
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
                                                    placeholder="Describe your business, services, prices, opening hours and policies..."
                                                />
                                                <div className="knowledge-save-row">
                                                    <small>
                                                        {knowledgeText.length} / 4,000 characters
                                                    </small>
                                                    <button
                                                        type="button"
                                                        onClick={saveKnowledge}
                                                        className="button button-blue"
                                                    >
                                                        Save information <Check size={14} />
                                                    </button>
                                                </div>
                                            </>
                                        ) : (
                                            <p className="knowledge-description">
                                                {business.description ||
                                                    "No description added yet. Add your services, opening hours, policies and prices so your assistant can give useful answers."}
                                            </p>
                                        )}
                                        <div className="knowledge-meta">
                                            <span>
                                                <BadgeCheck size={14} /> Uses approved business
                                                information only
                                            </span>
                                            <span>Updated in this browser</span>
                                        </div>
                                    </div>
                                    <div className="knowledge-categories">
                                        {[
                                            "Services & prices",
                                            "Opening hours",
                                            "Frequently asked questions",
                                            "Business policies",
                                        ].map((item) => (
                                            <div key={item}>
                                                <span className="category-icon">
                                                    <BookOpen size={15} />
                                                </span>
                                                <span>
                                                    <b>{item}</b>
                                                    <small>Part of your business profile</small>
                                                </span>
                                                <Check size={14} />
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}

                            {view === "analytics" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">A CLEARER PICTURE</div>
                                            <h1>Analytics</h1>
                                            <p>
                                                Track the conversations that help your business grow.
                                            </p>
                                        </div>
                                        <button className="select-period" type="button" disabled>
                                            Last 30 days <ChevronDown size={13} />
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
                                                <small>Available when a channel is connected</small>
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
                                                MEET CUSTOMERS WHERE THEY ARE
                                            </div>
                                            <h1>Channels</h1>
                                            <p>
                                                Choose where your assistant can talk with customers.
                                            </p>
                                        </div>
                                    </div>
                                    <div className="channel-cards">
                                        {[
                                            {
                                                name: "Website chat",
                                                detail: "Embed a small chat on your website",
                                                icon: Globe2,
                                                state: "AVAILABLE TO PREVIEW",
                                            },
                                            {
                                                name: "WhatsApp",
                                                detail: "Connect your business WhatsApp number",
                                                icon: MessageCircle,
                                                state: "NOT CONNECTED",
                                            },
                                            {
                                                name: "Instagram",
                                                detail: "Reply to Instagram direct messages",
                                                icon: MessageCircle,
                                                state: "COMING SOON",
                                            },
                                            {
                                                name: "Telegram",
                                                detail: "Add your Telegram business bot",
                                                icon: Send,
                                                state: "COMING SOON",
                                            },
                                            {
                                                name: "Facebook",
                                                detail: "Respond to messages from your page",
                                                icon: MessageCircle,
                                                state: "COMING SOON",
                                            },
                                            {
                                                name: "Kaspi Pay",
                                                detail: "Payment connection for Kazakhstan",
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
                                                    {state}
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
                                                    {state === "AVAILABLE TO PREVIEW" ? "Set up" : ""}
                                                </button>
                                            </article>
                                        ))}
                                    </div>
                                    <div className="integration-disclosure">
                                        <Sparkles size={15} /> External channels are not connected
                                        in this preview. No messages will be sent to customers.
                                    </div>
                                </>
                            )}

                            {view === "settings" && (
                                <>
                                    <div className="dashboard-page-heading">
                                        <div>
                                            <div className="eyebrow">
                                                THE DETAILS THAT MAKE IT YOURS
                                            </div>
                                            <h1>Settings</h1>
                                            <p>
                                                Manage your business profile and assistant preferences.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            className="button button-blue"
                                            onClick={() =>
                                                setNotice(
                                                    "Settings are saved automatically in this browser.",
                                                )
                                            }
                                        >
                                            <Check size={14} /> Save changes
                                        </button>
                                    </div>
                                    <section className="dashboard-panel settings-panel">
                                        <div className="panel-heading">
                                            <div>
                                                <h2>Business profile</h2>
                                                <p>
                                                    Shown to your assistant as approved business
                                                    information.
                                                </p>
                                            </div>
                                        </div>
                                        <div className="settings-fields">
                                            <label>
                                                Business name
                                                <input
                                                    className="dashboard-input"
                                                    value={business.name}
                                                    onChange={(event) =>
                                                        updateBusiness("name", event.target.value)
                                                    }
                                                />
                                            </label>
                                            <label>
                                                Business type
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
                                                    <option>Beauty &amp; wellness</option>
                                                    <option>Food &amp; hospitality</option>
                                                    <option>Health &amp; clinics</option>
                                                    <option>Retail &amp; online shop</option>
                                                    <option>Auto &amp; home services</option>
                                                    <option>Other</option>
                                                </select>
                                            </label>
                                            <label>
                                                Location
                                                <input
                                                    className="dashboard-input"
                                                    value={business.location}
                                                    placeholder="City or address"
                                                    onChange={(event) =>
                                                        updateBusiness("location", event.target.value)
                                                    }
                                                />
                                            </label>
                                            <label>
                                                Opening hours
                                                <input
                                                    className="dashboard-input"
                                                    value={business.hours}
                                                    placeholder="e.g. Mon–Sat, 10:00–20:00"
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
                                                <h2>Team access</h2>
                                                <p>Invite a teammate to help with conversations.</p>
                                            </div>
                                            <button
                                                type="button"
                                                className="button button-outline"
                                                disabled
                                                title="Team invitations are not configured"
                                            >
                                                <Plus size={14} /> Invite member
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
                                            <div className="eyebrow">PLANS THAT GROW WITH YOU</div>
                                            <h1>Plan &amp; billing</h1>
                                            <p>Your plan at a glance. No payment details stored.</p>
                                        </div>
                                    </div>
                                    <section className="dashboard-panel billing-panel">
                                        <div className="billing-plan-icon">
                                            <CreditCard size={18} />
                                        </div>
                                        <div className="billing-plan-copy">
                                            <span className="plan-label">CURRENT PLAN</span>
                                            <h2>Free</h2>
                                            <p>Everything you need to try your assistant.</p>
                                        </div>
                                        <div className="billing-price">
                                            <b>₸0</b>
                                            <span>per month</span>
                                        </div>
                                        <div className="billing-usage">
                                            <div>
                                                <span>Monthly conversations</span>
                                                <b>0 / 100</b>
                                            </div>
                                            <div className="usage-track">
                                                <i />
                                            </div>
                                            <small>
                                                No live conversations counted in this browser preview.
                                            </small>
                                        </div>
                                        <button
                                            type="button"
                                            className="button button-outline"
                                            disabled
                                            title="Stripe is not connected"
                                        >
                                            Manage subscription
                                        </button>
                                    </section>
                                    <div className="billing-plan-grid">
                                        {[
                                            {
                                                name: "Starter",
                                                price: "₸19,900",
                                                count: "2,000 conversations",
                                            },
                                            {
                                                name: "Business",
                                                price: "₸49,900",
                                                count: "10,000 conversations",
                                            },
                                        ].map((plan) => (
                                            <article key={plan.name}>
                                                <span className="plan-label">GROWING BUSINESS</span>
                                                <h3>{plan.name}</h3>
                                                <p>{plan.count} / month</p>
                                                <div>
                                                    <b>{plan.price}</b>
                                                    <span> / month</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    disabled
                                                    title="Payments are not connected"
                                                >
                                                    Coming soon
                                                </button>
                                            </article>
                                        ))}
                                    </div>
                                    <div className="integration-disclosure">
                                        <CreditCard size={14} /> Billing preview only. Stripe and
                                        invoices are not connected.
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
