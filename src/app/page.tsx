"use client";

import {
    ArrowDownRight,
    ArrowRight,
    ArrowUpRight,
    BadgeCheck,
    Bot,
    CalendarCheck2,
    Check,
    ChevronDown,
    Clock3,
    Headset,
    Menu,
    MessageCircle,
    MessageSquareText,
    Send,
    Sparkles,
    X,
    Zap,
} from "lucide-react";
import Link from "next/link";
import { annualDiscount, plans } from "@/lib/plans";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { FormEvent, useMemo, useState } from "react";
import "./floral-theme.css";

type BusinessKey = "salon" | "restaurant" | "clinic" | "shop" | "auto";
type ChatMessage = { role: "assistant" | "customer"; content: string };

const businesses: Record<
    BusinessKey,
    {
        label: string;
        name: string;
        mark: string;
        welcome: string;
        prompts: string[];
    }
> = {
    salon: {
        label: "Beauty",
        name: "Mira Studio",
        mark: "M",
        welcome: "Hi there! Welcome to Mira Studio. How can I help you today?",
        prompts: [
            "How much is a haircut?",
            "Can I book for tomorrow?",
            "What are your hours?",
        ],
    },
    restaurant: {
        label: "Restaurant",
        name: "Sunday Table",
        mark: "S",
        welcome:
            "Welcome to Sunday Table. Looking for a table or something delicious?",
        prompts: [
            "Do you have a table tonight?",
            "What’s on the menu?",
            "Are you open now?",
        ],
    },
    clinic: {
        label: "Clinic",
        name: "Northline Dental",
        mark: "N",
        welcome: "Hello! You’ve reached Northline Dental. What can I help with?",
        prompts: [
            "Can I book a check-up?",
            "How much is cleaning?",
            "When are you open?",
        ],
    },
    shop: {
        label: "Shop",
        name: "Object Supply",
        mark: "O",
        welcome: "Hey! Welcome to Object Supply. What are you looking for?",
        prompts: [
            "Is the weekend bag in stock?",
            "How long is delivery?",
            "Can I return an item?",
        ],
    },
    auto: {
        label: "Auto service",
        name: "Morrow Auto",
        mark: "M",
        welcome: "Hi! Morrow Auto here. Tell me what your car needs.",
        prompts: [
            "Can I book a service?",
            "How much is diagnostics?",
            "Where are you located?",
        ],
    },
};

function replyFor(business: BusinessKey, text: string) {
    const query = text.toLowerCase();
    const answers: Record<BusinessKey, [RegExp, string][]> = {
        salon: [
            [
                /price|cost|how much|стоим|цен/i,
                "A cut and style is 8,000 ₸, and a color refresh starts at 24,000 ₸. Want me to find a time?",
            ],
            [
                /book|appointment|tomorrow|запис/i,
                "We have a few openings tomorrow at 11:30, 14:00 and 17:30. Which works for you?",
            ],
            [
                /hour|open|work|врем|откры/i,
                "We’re open every day from 10:00 to 21:00. I can help you book whenever suits you.",
            ],
        ],
        restaurant: [
            [
                /table|reserv|book|стол/i,
                "I can help with that. How many people, and what time should I check?",
            ],
            [
                /menu|food|dish|меню/i,
                "Our most-loved dishes are the Sunday roast (7,500 ₸) and seasonal pasta (5,200 ₸). Want the full menu?",
            ],
            [
                /hour|open|work|врем|откры/i,
                "We’re open daily from 11:00 to 23:00. The kitchen takes its last order at 22:15.",
            ],
        ],
        clinic: [
            [
                /price|cost|how much|clean|цен|стоим/i,
                "A dental cleaning is 18,000 ₸. A first consultation is 6,000 ₸. Would you like to book?",
            ],
            [
                /book|appointment|check|запис/i,
                "I can arrange that. We have appointments tomorrow at 10:00 and 16:30. Which is better?",
            ],
            [
                /hour|open|work|врем|откры/i,
                "Our clinic is open Monday to Saturday, 09:00–20:00.",
            ],
        ],
        shop: [
            [
                /stock|available|bag|налич|есть/i,
                "The Weekend Carryall is in stock in black and olive, for 39,900 ₸. Want me to reserve one?",
            ],
            [
                /deliver|ship|достав/i,
                "Delivery around Almaty takes 1–2 business days. Orders over 30,000 ₸ ship free.",
            ],
            [
                /return|exchange|возврат/i,
                "Unused items can be returned within 14 days with the original packaging. I can pass you to our team for help.",
            ],
        ],
        auto: [
            [
                /diagnos|price|cost|how much|цен|стоим/i,
                "Computer diagnostics is 7,000 ₸. If you go ahead with a repair, we deduct it from the bill.",
            ],
            [
                /book|service|appointment|запис/i,
                "We have service slots tomorrow at 09:30 and 15:00. What works for you, and what car do you drive?",
            ],
            [
                /hour|open|work|врем|откры/i,
                "We’re open Monday to Saturday, 09:00–19:00. You’ll find us at 18 Tole Bi Street, Almaty.",
            ],
        ],
    };
    if (/human|person|agent|человек|оператор|сотрудник/i.test(query))
        return "Of course. I’m passing your message to a teammate now. They’ll get back to you shortly.";
    return (
        answers[business].find(([pattern]) => pattern.test(query))?.[1] ??
        "I don’t have that detail just yet, and I don’t want to guess. Would you like me to pass this to a teammate?"
    );
}

function Brand() {
    const { t } = useLanguage();

    return (
        <Link href="/" className="brand" aria-label={t("FloralAI home")}>
            <span className="brand-mark">
                <Sparkles size={17} strokeWidth={2.4} />
            </span>
            <span translate="no" className="brand-name">
                Floral<span>AI</span>
            </span>
        </Link>
    );
}

function ChatDemo({
    initialBusiness = "salon" as BusinessKey,
}: {
    initialBusiness?: BusinessKey;
}) {
    const { t } = useLanguage();
    const [business, setBusiness] = useState<BusinessKey>(initialBusiness);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [typing, setTyping] = useState(false);
    const profile = businesses[business];
    const visibleMessages = useMemo(() => messages.slice(-5), [messages]);

    function sendMessage(value: string) {
        const clean = value.trim();
        if (!clean || typing) return;
        setInput("");
        setMessages((current) => [
            ...current,
            { role: "customer", content: clean },
        ]);
        setTyping(true);
        window.setTimeout(() => {
            setMessages((current) => [
                ...current,
                { role: "assistant", content: replyFor(business, clean) },
            ]);
            setTyping(false);
        }, 650);
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        sendMessage(input);
    }

    return (
        <div className="chat-window">
            <div className="chat-topbar">
                <div className="chat-identity">
                    <span className="chat-avatar">{profile.mark}</span>
                    <div>
                        <strong>{profile.name}</strong>
                        <span>
                            <i className="online-dot" /> {t("Typically replies instantly")}
                        </span>
                    </div>
                </div>
                <span className="chat-powered">
                    <Sparkles size={13} /> AI
                </span>
            </div>
            <div
                className="chat-business-select"
                role="group"
                aria-label={t("Choose demo business")}
            >
                {(Object.keys(businesses) as BusinessKey[]).map((key) => (
                    <button
                        key={key}
                        className={business === key ? "selected" : ""}
                        aria-pressed={business === key}
                        onClick={() => {
                            setBusiness(key);
                            setMessages([]);
                        }}
                        type="button"
                    >
                        {t(businesses[key].label)}
                    </button>
                ))}
            </div>
            <div
                className="chat-transcript"
                role="log"
                aria-label={t("Conversation")}
                aria-busy={typing}
            >
                <div className="chat-date">{t("TODAY, 10:42 AM")}</div>
                <div className="message-row">
                    <span className="mini-avatar">{profile.mark}</span>
                    <div className="message-bubble assistant-bubble">
                        {t(profile.welcome)}
                        <span className="message-time">10:42</span>
                    </div>
                </div>
                {visibleMessages.map((message, index) => (
                    <div
                        key={`${message.role}-${index}`}
                        className={`message-row ${message.role === "customer" ? "customer-row" : ""}`}
                    >
                        {message.role === "assistant" && (
                            <span className="mini-avatar">{profile.mark}</span>
                        )}
                        <div
                            className={`message-bubble ${message.role === "assistant" ? "assistant-bubble" : "customer-bubble"}`}
                        >
                            {message.role === "assistant"
                                ? t(message.content)
                                : message.content}
                            <span className="message-time">10:43</span>
                        </div>
                    </div>
                ))}
                {typing && (
                    <div className="message-row" role="status" aria-label={t("Assistant is typing")}>
                        <span className="mini-avatar">{profile.mark}</span>
                        <div className="message-bubble assistant-bubble typing-bubble" aria-hidden="true">
                            <i />
                            <i />
                            <i />
                        </div>
                    </div>
                )}
                {messages.length === 0 && (
                    <div className="suggestions">
                        {profile.prompts.map((prompt) => (
                            <button
                                key={prompt}
                                type="button"
                                onClick={() => sendMessage(prompt)}
                            >
                                {t(prompt)}
                                <ArrowUpRight size={12} />
                            </button>
                        ))}
                    </div>
                )}
                {messages.length >= 3 && (
                    <div className="chat-nudge">
                        <span>{t("You’ve seen how it works.")}</span>
                        <Link href="/signup">
                            {t("Create your AI")} <ArrowRight size={14} />
                        </Link>
                    </div>
                )}
            </div>
            <form className="chat-composer" onSubmit={handleSubmit}>
                <input
                    aria-label={t("Message the AI assistant")}
                    placeholder={t("Write a message...")}
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                />
                <button
                    aria-label={t("Send message")}
                    type="submit"
                    disabled={!input.trim() || typing}
                >
                    <Send size={16} />
                </button>
            </form>
            <div className="chat-footnote">
                {t("Powered by")} <strong translate="no">FloralAI</strong>{" "}
                <span>{t("Preview demo")}</span>
            </div>
        </div>
    );
}

const benefits = [
    {
        icon: Clock3,
        metric: "24/7",
        title: "Always on",
        copy: "Your customers get an answer, even after closing time.",
    },
    {
        icon: Zap,
        metric: "< 5 sec",
        title: "Instant replies",
        copy: "No more losing a lead while you’re with another customer.",
    },
    {
        icon: MessageSquareText,
        metric: "Every chat",
        title: "Nothing missed",
        copy: "Every question gets a thoughtful, useful response.",
    },
    {
        icon: Headset,
        metric: "Human-first",
        title: "Easy handoff",
        copy: "When it matters, your team can take over in one click.",
    },
];

const faqs = [
    [
        "What is FloralAI?",
        "A virtual teammate that answers customer questions using your business information, captures leads and helps with bookings.",
    ],
    [
        "Do I need technical knowledge?",
        "No. Tell us about your business in plain language and FloralAI turns it into a helpful assistant.",
    ],
    [
        "Can I teach it about my business?",
        "Yes. Add services, prices, opening hours, FAQs and documents to its business knowledge.",
    ],
    [
        "Will it make things up?",
        "FloralAI is designed to stay within the information you provide. When it is unsure, it says so and offers a human handoff.",
    ],
    [
        "Can my team take over a conversation?",
        "Absolutely. Conversations that need attention are flagged so a teammate can step in.",
    ],
    [
        "Does it work with WhatsApp?",
        "WhatsApp and other channel connections are planned integrations. The current demo does not connect to external accounts.",
    ],
];

export default function Home() {
    const { locale, t } = useLanguage();
    const numberLocale =
        locale === "ru" ? "ru-RU" : locale === "kk" ? "kk-KZ" : "en-US";
    const [menuOpen, setMenuOpen] = useState(false);
    const [openFaq, setOpenFaq] = useState<number | null>(0);
    const [demoOpen, setDemoOpen] = useState(false);
    const [annualBilling, setAnnualBilling] = useState(false);

    return (
        <main className="floral-site">
            <header className="site-header">
                <div className="header-inner">
                    <Brand />
                    <nav
                        className={menuOpen ? "nav-open" : ""}
                        aria-label={t("Main navigation")}
                    >
                        <a href="#product" onClick={() => setMenuOpen(false)}>
                            {t("Product")}
                        </a>
                        <a href="#solutions" onClick={() => setMenuOpen(false)}>
                            {t("Solutions")}
                        </a>
                        <a href="#how" onClick={() => setMenuOpen(false)}>
                            {t("How it works")}
                        </a>
                        <Link href="/flower-shop" onClick={() => setMenuOpen(false)}>
                            {t("Flower shop demo")}
                        </Link>
                        <a href="#pricing" onClick={() => setMenuOpen(false)}>
                            {t("Pricing")}
                        </a>
                        <a href="#faq" onClick={() => setMenuOpen(false)}>
                            {t("FAQ")}
                        </a>
                        <div className="mobile-nav-actions">
                            <Link href="/login" className="nav-login">
                                {t("Log in")}
                            </Link>
                            <Link href="/signup" className="button button-dark">
                                {t("Try for free")} <ArrowRight size={15} />
                            </Link>
                        </div>
                    </nav>
                    <div className="header-actions">
                        <LanguageSwitcher />
                        <Link href="/login" className="nav-login">
                            {t("Log in")}
                        </Link>
                        <button
                            className="button button-dark button-small"
                            onClick={() => setDemoOpen(true)}
                        >
                            {t("Try for free")} <ArrowRight size={15} />
                        </button>
                    </div>
                    <button
                        className="mobile-menu"
                        onClick={() => setMenuOpen((open) => !open)}
                        aria-label={t(menuOpen ? "Close menu" : "Open menu")}
                        aria-expanded={menuOpen}
                    >
                        {menuOpen ? <X /> : <Menu />}
                    </button>
                </div>
            </header>

            <section className="hero-section">
                <div className="hero-grid">
                    <div className="hero-copy">
                        <div className="eyebrow">
                            <span className="eyebrow-spark">
                                <Sparkles size={13} />
                            </span>{" "}
                            {t("YOUR NEW FAVORITE TEAMMATE")}
                        </div>
                        <h1>
                            {t("Your AI teammate")}
                            <br />
                            {t("for every customer.")}
                        </h1>
                        <p className="hero-description">
                            {t("FloralAI answers questions, captures leads and books appointments for your business, around the clock.")}
                        </p>
                        <div className="hero-actions">
                            <button
                                className="button button-blue"
                                onClick={() => setDemoOpen(true)}
                            >
                                {t("Try the live demo")} <ArrowRight size={16} />
                            </button>
                            <a className="button button-outline" href="#live-demo">
                                <span className="play-icon">▶</span> {t("See how it works")}
                            </a>
                        </div>
                        <div className="trust-line">
                            <span className="trust-check">
                                <Check size={12} />
                            </span>{" "}
                            {t("No credit card")} <i /> {t("Ready in 5 minutes")} <i /> {t("Free to try")}
                        </div>
                        <div className="hero-proof">
                            <div className="proof-avatars">
                                <span>J</span>
                                <span>A</span>
                                <span>M</span>
                                <span>+</span>
                            </div>
                            <p>
                                <strong>{t("Made for the people behind small business.")}</strong>
                                <br />
                                {t("From the first hello to the next loyal customer.")}
                            </p>
                        </div>
                    </div>
                    <div className="hero-product">
                        <div className="product-label">
                            <span>
                                <i className="online-dot" /> {t("INTERACTIVE PRODUCT DEMO")}
                            </span>
                            <span>01 / 04</span>
                        </div>
                        <ChatDemo />
                        <div className="floating-note note-top">
                            <span className="note-icon note-green">
                                <CalendarCheck2 size={15} />
                            </span>
                            <div>
                                <b>{t("New appointment")}</b>
                                <small>{t("Tomorrow at 17:30")}</small>
                            </div>
                            <BadgeCheck size={16} className="note-check" />
                        </div>
                        <div className="floating-note note-bottom">
                            <span className="note-icon note-blue">
                                <MessageCircle size={15} />
                            </span>
                            <div>
                                <b>{t("Lead captured")}</b>
                                <small>{t("Ready for your team")}</small>
                            </div>
                            <ArrowDownRight size={16} className="note-arrow" />
                        </div>
                    </div>
                </div>
                <div className="hero-bottom">
                    <span>{t("BUILT FOR YOUR KIND OF BUSINESS")}</span>
                    <div className="business-logos">
                        <span>
                            mira<span className="logo-light">studio</span>
                        </span>
                        <span className="logo-serif">Sunday Table</span>
                        <span className="logo-wide">NORTHLINE</span>
                        <span>
                            object<span className="logo-light">supply</span>
                        </span>
                        <span className="logo-mono">MORROW AUTO</span>
                    </div>
                </div>
            </section>

            <section className="benefit-section" id="product">
                <div className="section-heading">
                    <div>
                        <div className="eyebrow">{t("MORE TIME FOR THE WORK YOU LOVE")}</div>
                        <h2>
                            {t("Be there for every")}
                            <br />
                            {t("customer.")}{" "}
                            <span>
                                {t("Without being")}
                                <br className="mobile-break" /> {t("on your phone.")}
                            </span>
                        </h2>
                    </div>
                    <p>
                        {t("Keep the human touch in your business. Let FloralAI take the repetitive conversations off your hands.")}
                    </p>
                </div>
                <div className="benefit-grid">
                    {benefits.map(({ icon: Icon, metric, title, copy }) => (
                        <article className="benefit-item" key={title}>
                            <div className="benefit-icon">
                                <Icon size={19} />
                            </div>
                            <span className="benefit-metric">{t(metric)}</span>
                            <h3>{t(title)}</h3>
                            <p>{t(copy)}</p>
                        </article>
                    ))}
                </div>
            </section>

            <section className="problem-section">
                <div className="problem-left">
                    <div className="eyebrow eyebrow-light">
                        {t("THE EVERYDAY BUSINESS OF BUSINESS")}
                    </div>
                    <h2>
                        {t("Good customers")}
                        <br />
                        {t("don’t wait around.")}
                    </h2>
                    <p>
                        {t("A late reply shouldn’t be the reason someone books somewhere else.")}
                    </p>
                    <button
                        className="text-link text-link-light"
                        onClick={() => setDemoOpen(true)}
                    >
                        {t("Meet your AI teammate")} <ArrowRight size={16} />
                    </button>
                </div>
                <div className="problem-list">
                    <div className="problem-list-head">
                        <span>{t("Sound familiar?")}</span>
                        <span>{t("THAT’S ABOUT TO CHANGE")}</span>
                    </div>
                    {[
                        "A customer messages while you’re with someone else.",
                        "The same question, answered for the tenth time today.",
                        "A booking request comes in after you’ve closed.",
                        "A promising lead gets buried in your inbox.",
                    ].map((line, index) => (
                        <div className="problem-row" key={line}>
                            <span className="problem-number">0{index + 1}</span>
                            <p>{t(line)}</p>
                            <span className="problem-cross">×</span>
                        </div>
                    ))}
                </div>
                <div className="problem-stamp">
                    <span>
                        {t("ALWAYS HERE")}
                        <br />
                    </span>
                    <Sparkles size={18} />
                </div>
            </section>

            <section className="knowledge-section" id="solutions">
                <div className="knowledge-copy">
                    <div className="eyebrow">{t("YOUR BUSINESS, UNDERSTOOD")}</div>
                    <h2>
                        {t("It knows your business.")}
                        <br />
                        <span>{t("Not just the internet.")}</span>
                    </h2>
                    <p>
                        {t("Give FloralAI your services, prices, hours and policies. It learns what makes your business yours, then uses those details to help every customer.")}
                    </p>
                    <div className="knowledge-points">
                        <div>
                            <span className="check-round">
                                <Check size={13} />
                            </span>
                            <p>
                                <b>{t("Answers from your information")}</b>
                                <small>
                                    {t("Services, prices, policies and the details you approve.")}
                                </small>
                            </p>
                        </div>
                        <div>
                            <span className="check-round">
                                <Check size={13} />
                            </span>
                            <p>
                                <b>{t("Honest when it doesn’t know")}</b>
                                <small>{t("No guessing. It offers to bring a real person in.")}</small>
                            </p>
                        </div>
                        <div>
                            <span className="check-round">
                                <Check size={13} />
                            </span>
                            <p>
                                <b>{t("Always your call")}</b>
                                <small>{t("Review and edit everything your assistant knows.")}</small>
                            </p>
                        </div>
                    </div>
                    <Link href="/signup" className="text-link">
                        {t("Teach it your business")} <ArrowRight size={16} />
                    </Link>
                </div>
                <div className="knowledge-visual">
                    <div className="knowledge-window">
                        <div className="window-top">
                            <span>
                                <i className="window-dot dot-red" />
                                <i className="window-dot dot-yellow" />
                                <i className="window-dot dot-green" />
                            </span>
                            <span>{t("BUSINESS KNOWLEDGE")}</span>
                            <span>
                                <Sparkles size={14} />
                            </span>
                        </div>
                        <div className="knowledge-document">
                            <div className="doc-kicker">
                                <span className="doc-icon">
                                    <MessageSquareText size={15} />
                                </span>{" "}
                                MIRA STUDIO{" "}
                                <span className="doc-status">
                                    <Check size={11} /> {t("READY")}
                                </span>
                            </div>
                            <h3>{t("Services & pricing")}</h3>
                            <div className="doc-line doc-line-long" />
                            <div className="doc-entry">
                                <div>
                                    <b>{t("Cut & style")}</b>
                                    <span>{t("60 minutes")}</span>
                                </div>
                                <strong>8,000 ₸</strong>
                            </div>
                            <div className="doc-entry">
                                <div>
                                    <b>{t("Color refresh")}</b>
                                    <span>{t("From 2 hours")}</span>
                                </div>
                                <strong>24,000 ₸</strong>
                            </div>
                            <div className="doc-entry">
                                <div>
                                    <b>{t("Signature manicure")}</b>
                                    <span>{t("45 minutes")}</span>
                                </div>
                                <strong>9,500 ₸</strong>
                            </div>
                            <div className="doc-foot">
                                <BadgeCheck size={14} /> {t("Answering from approved information")}
                            </div>
                        </div>
                    </div>
                    <div className="knowledge-chip chip-a">
                        <span className="chip-dot" /> {t("Services")}
                    </div>
                    <div className="knowledge-chip chip-b">
                        <span className="chip-dot chip-dot-purple" /> {t("Opening hours")}
                    </div>
                    <div className="knowledge-chip chip-c">
                        <span className="chip-dot chip-dot-orange" /> {t("FAQ")}
                    </div>
                </div>
            </section>

            <section className="how-section" id="how">
                <div className="how-header">
                    <div>
                        <div className="eyebrow">{t("Simple by design")}</div>
                        <h2>
                            {t("From “hello” to")}
                            <br />
                            <span>{t("ready in minutes.")}</span>
                        </h2>
                    </div>
                    <p>
                        {t("No prompt engineering. No complicated setup.")}
                        <br />
                        {t("Just a better way to look after your customers.")}
                    </p>
                </div>
                <div className="steps-grid">
                    <article className="step-card">
                        <div className="step-top">
                            <span>01</span>
                            <span className="step-icon">
                                <MessageCircle size={18} />
                            </span>
                        </div>
                        <h3>{t("Tell us about your business")}</h3>
                        <p>
                            {t("Write a few sentences about what you do. That’s all we need to start.")}
                        </p>
                        <div className="step-visual step-visual-note">
                            <span>{t("We’re a neighborhood salon in Almaty...")}</span>
                            <i />
                            <i />
                        </div>
                    </article>
                    <article className="step-card">
                        <div className="step-top">
                            <span>02</span>
                            <span className="step-icon">
                                <Sparkles size={18} />
                            </span>
                        </div>
                        <h3>{t("Make it yours")}</h3>
                        <p>
                            {t("FloralAI organises your services, tone and hours into a helpful assistant.")}
                        </p>
                        <div className="step-visual step-visual-tags">
                            <span>
                                {t("Friendly")} <Check size={11} />
                            </span>
                            <span>{t("Russian + English")}</span>
                            <span>{t("Bookings")}</span>
                        </div>
                    </article>
                    <article className="step-card">
                        <div className="step-top">
                            <span>03</span>
                            <span className="step-icon">
                                <Bot size={18} />
                            </span>
                        </div>
                        <h3>{t("Let the good chats begin")}</h3>
                        <p>
                            {t("Test it yourself, then choose where your customers can find it.")}
                        </p>
                        <div className="step-visual step-visual-live">
                            <span>
                                <i className="online-dot" /> {t("Assistant is ready")}
                            </span>
                            <button type="button" onClick={() => setDemoOpen(true)}>
                                {t("Try a chat")} <ArrowRight size={12} />
                            </button>
                        </div>
                    </article>
                </div>
            </section>

            <section className="live-demo-section" id="live-demo">
                <div className="live-demo-inner">
                    <div className="live-demo-copy">
                        <div className="eyebrow eyebrow-light">{t("GO ON, ASK IT ANYTHING")}</div>
                        <h2>
                            {t("See the conversation")}
                            <br />
                            {t("before it")} <span>{t("happens.")}</span>
                        </h2>
                        <p>
                            {t("Choose a business and try a real conversation. The demo uses sample business information and never asks you to sign up.")}
                        </p>
                        <div className="live-proof-list">
                            <span>
                                <Check size={14} /> {t("Five business scenarios")}
                            </span>
                            <span>
                                <Check size={14} /> {t("No account needed")}
                            </span>
                            <span>
                                <Check size={14} /> {t("No made-up answers")}
                            </span>
                        </div>
                        <div className="demo-privacy">
                            <span className="privacy-lock">
                                <BadgeCheck size={15} />
                            </span>
                            <p>
                                <b>{t("A demo, not a real business.")}</b>
                                <br />
                                {t("These sample replies show how FloralAI works. External messaging channels aren’t connected.")}
                            </p>
                        </div>
                    </div>
                    <div className="live-demo-chat">
                        <ChatDemo initialBusiness="shop" />
                    </div>
                </div>
            </section>

            <section className="solutions-section">
                <div className="section-heading">
                    <div>
                        <div className="eyebrow">{t("ONE HELPFUL ASSISTANT")}</div>
                        <h2>
                            {t("Fits right into")}
                            <br />
                            <span>{t("your kind of work.")}</span>
                        </h2>
                    </div>
                    <p>
                        {t("A salon, a studio, a shop around the corner. Your assistant learns the details that make your business different.")}
                    </p>
                </div>
                <div className="solutions-grid">
                    {[
                        {
                            icon: "01",
                            name: "Beauty & wellness",
                            description: "Bookings, services & pricing",
                            type: "solution-beauty",
                        },
                        {
                            icon: "02",
                            name: "Food & hospitality",
                            description: "Tables, menus & opening hours",
                            type: "solution-food",
                        },
                        {
                            icon: "03",
                            name: "Health & clinics",
                            description: "Appointments, services & FAQs",
                            type: "solution-health",
                        },
                        {
                            icon: "04",
                            name: "Retail & online shops",
                            description: "Product questions & order leads",
                            type: "solution-retail",
                        },
                        {
                            icon: "05",
                            name: "Auto & home services",
                            description: "Quotes, diagnostics & bookings",
                            type: "solution-auto",
                        },
                    ].map((item) => (
                        <article className={`solution-card ${item.type}`} key={item.name}>
                            <div className="solution-card-art">
                                <span className="solution-orbit" />
                                <span className="solution-glyph">{item.icon}</span>
                            </div>
                            <div className="solution-card-copy">
                                <div>
                                    <h3>{t(item.name)}</h3>
                                    <p>{t(item.description)}</p>
                                </div>
                                <ArrowUpRight size={17} />
                            </div>
                        </article>
                    ))}
                </div>
            </section>

            <section className="pricing-section" id="pricing">
                <div className="pricing-heading">
                    <div className="eyebrow">{t("STRAIGHTFORWARD PRICING")}</div>
                    <h2>
                        {t("Start small.")}
                        <br />
                        <span>{t("Grow when you’re ready.")}</span>
                    </h2>
                    <p>{t("See what works for your business before you pay a thing.")}</p>
                    <div className="billing-toggle">
                        <button
                            className={!annualBilling ? "active" : ""}
                            type="button"
                            onClick={() => setAnnualBilling(false)}
                        >
                            {t("Monthly")}
                        </button>
                        <button
                            className={annualBilling ? "active" : ""}
                            type="button"
                            onClick={() => setAnnualBilling(true)}
                        >
                            {t("Yearly")} <span>{t("Save")} {Math.round(annualDiscount * 100)}%</span>
                        </button>
                    </div>
                </div>
                <div className="pricing-grid">
                    <article className="price-card">
                        <span className="plan-label">{t("A GOOD PLACE TO START")}</span>
                        <h3>{t("Free")}</h3>
                        <p>{t("Try FloralAI with a real, working demo.")}</p>
                        <div className="price">
                            <strong>₸{plans.free.monthlyPriceKzt.toLocaleString(numberLocale)}</strong>
                            <span>/ {t("month")}</span>
                        </div>
                        <Link href="/signup" className="button button-outline price-button">
                            {t("Start for free")} <ArrowRight size={15} />
                        </Link>
                        <div className="price-divider" />
                        <span className="feature-caption">{t("INCLUDED")}</span>
                        {[
                            `${plans.free.messageLimit.toLocaleString(numberLocale)} ${t("conversations / month")}`,
                            `${plans.free.assistantLimit} ${t("AI assistant")}`,
                            t("Basic business knowledge"),
                            t("Essential analytics"),
                        ].map((item) => (
                            <div className="price-feature" key={item}>
                                <Check size={14} /> {t(item)}
                            </div>
                        ))}
                    </article>
                    <article className="price-card price-featured">
                        <div className="popular-tag">{t("MOST POPULAR")}</div>
                        <span className="plan-label">{t("FOR YOUR EVERYDAY")}</span>
                        <h3>{t("Starter")}</h3>
                        <p>{t("More time back, as your business grows.")}</p>
                        <div className="price">
                            <strong>₸{Math.round(plans.starter.monthlyPriceKzt * (annualBilling ? 1 - annualDiscount : 1)).toLocaleString(numberLocale)}</strong>
                            <span>{annualBilling ? `/ ${t("month, billed yearly")}` : `/ ${t("month")}`}</span>
                        </div>
                        <Link
                            href="/signup?plan=starter"
                            className="button button-blue price-button"
                        >
                            {t("Try Starter free")} <ArrowRight size={15} />
                        </Link>
                        <div className="price-divider" />
                        <span className="feature-caption">{t("EVERYTHING IN FREE, PLUS")}</span>
                        {[
                            `${plans.starter.messageLimit.toLocaleString(numberLocale)} ${t("conversations / month")}`,
                            ...plans.starter.features,
                        ].map((item) => (
                            <div className="price-feature" key={item}>
                                <Check size={14} /> {t(item)}
                            </div>
                        ))}
                    </article>
                    <article className="price-card">
                        <span className="plan-label">{t("FOR A BUSY TEAM")}</span>
                        <h3>{t("Business")}</h3>
                        <p>{t("More assistants and more ways to grow.")}</p>
                        <div className="price">
                            <strong>₸{Math.round(plans.business.monthlyPriceKzt * (annualBilling ? 1 - annualDiscount : 1)).toLocaleString(numberLocale)}</strong>
                            <span>{annualBilling ? `/ ${t("month, billed yearly")}` : `/ ${t("month")}`}</span>
                        </div>
                        <Link
                            href="/signup?plan=business"
                            className="button button-outline price-button"
                        >
                            {t("Explore Business")} <ArrowRight size={15} />
                        </Link>
                        <div className="price-divider" />
                        <span className="feature-caption">{t("EVERYTHING IN STARTER, PLUS")}</span>
                        {[
                            `${plans.business.messageLimit.toLocaleString(numberLocale)} ${t("conversations / month")}`,
                            ...plans.business.features,
                        ].map((item) => (
                            <div className="price-feature" key={item}>
                                <Check size={14} /> {t(item)}
                            </div>
                        ))}
                    </article>
                </div>
                <p className="pricing-footnote">
                    {t("Prices shown in Kazakhstani tenge. Billing is a product preview; payments are not connected yet.")}
                </p>
            </section>

            <section className="faq-section" id="faq">
                <div className="faq-heading">
                    <div className="eyebrow">{t("A FEW GOOD QUESTIONS")}</div>
                    <h2>{t("Good to know.")}</h2>
                    <p>{t("Still curious? We’re here to help.")}</p>
                    <a href="mailto:hello@floralai.example" className="text-link">
                        {t("Talk to our team")} <ArrowRight size={15} />
                    </a>
                </div>
                <div className="faq-list">
                    {faqs.map(([question, answer], index) => (
                        <article
                            className={`faq-item ${openFaq === index ? "faq-open" : ""}`}
                            key={question}
                        >
                            <button
                                type="button"
                                aria-expanded={openFaq === index}
                                onClick={() => setOpenFaq(openFaq === index ? null : index)}
                            >
                                <span>{t(question)}</span>
                                <ChevronDown size={17} />
                            </button>
                            {openFaq === index && <p>{t(answer)}</p>}
                        </article>
                    ))}
                </div>
            </section>

            <section className="final-cta">
                <div className="cta-spark">
                    <Sparkles size={18} />
                </div>
                <div className="eyebrow eyebrow-light">
                    {t("YOUR NEXT GREAT HIRE IS ALREADY HERE")}
                </div>
                <h2>
                    {t("Give your business")}
                    <br />{t("a little more breathing room.")}
                </h2>
                <p>
                    {t("Set up an AI teammate that makes every customer feel looked after.")}
                </p>
                <Link href="/signup" className="button button-white">
                    {t("Create your AI for free")} <ArrowRight size={16} />
                </Link>
                <div className="cta-note">
                    <Check size={13} /> {t("Start free. No card needed.")}
                </div>
            </section>

            <footer className="site-footer">
                <div className="footer-top">
                    <div className="footer-brand">
                        <Brand />
                        <p>{t("A little more room to run your business.")}</p>
                    </div>
                    <div className="footer-column">
                        <span>{t("PRODUCT")}</span>
                        <a href="#product">{t("How it works")}</a>
                        <a href="#pricing">{t("Pricing")}</a>
                        <a href="#live-demo">{t("Try the demo")}</a>
                        <Link href="/flower-shop">{t("Flower shop ordering demo")}</Link>
                        <Link href="/dashboard">{t("Dashboard preview")}</Link>
                    </div>
                    <div className="footer-column">
                        <span>{t("BUSINESSES")}</span>
                        <a href="#solutions">{t("Beauty & wellness")}</a>
                        <a href="#solutions">{t("Food & hospitality")}</a>
                        <a href="#solutions">{t("Retail & services")}</a>
                        <a href="#solutions">{t("All businesses")}</a>
                    </div>
                    <div className="footer-column">
                        <span>{t("COMPANY")}</span>
                        <a href="#faq">{t("FAQ")}</a>
                        <a href="mailto:hello@floralai.example">{t("Contact")}</a>
                        <a href="#privacy">{t("Privacy")}</a>
                        <a href="#terms">{t("Terms")}</a>
                    </div>
                    <div className="footer-signup">
                        <span>{t("A BETTER KIND OF BUSY")}</span>
                        <p>{t("Explore a real sample conversation with FloralAI.")}</p>
                        <button
                            className="button button-outline footer-demo-button"
                            type="button"
                            onClick={() => setDemoOpen(true)}
                        >
                            {t("Try the live demo")} <ArrowRight size={14} />
                        </button>
                        <small>{t("No account or channel connection needed.")}</small>
                    </div>
                </div>
                <div className="footer-bottom">
                    <span>{t("© 2026 FloralAI. Made for the independently minded.")}</span>
                    <span className="footer-status">
                        <i className="online-dot" /> {t("ALL SYSTEMS OPERATIONAL")}
                    </span>
                    <div>
                        <a href="#privacy">{t("Privacy")}</a>
                        <a href="#terms">{t("Terms")}</a>
                    </div>
                </div>
            </footer>

            {demoOpen && (
                <div
                    className="modal-backdrop"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) setDemoOpen(false);
                    }}
                >
                    <section
                        className="demo-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="demo-title"
                    >
                        <div className="modal-heading">
                            <div>
                                <span className="eyebrow">{t("NO SIGN-UP NEEDED")}</span>
                                <h2 id="demo-title">{t("Meet your new teammate.")}</h2>
                            </div>
                            <button
                                type="button"
                                className="icon-button"
                                onClick={() => setDemoOpen(false)}
                                aria-label={t("Close demo")}
                            >
                                <X size={19} />
                            </button>
                        </div>
                        <p className="modal-description">
                            {t("Choose a business, ask anything, and see how FloralAI responds.")}
                        </p>
                        <ChatDemo />
                    </section>
                </div>
            )}
        </main>
    );
}
