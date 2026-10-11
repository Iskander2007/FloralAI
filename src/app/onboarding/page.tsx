"use client";

import {
    ArrowLeft,
    ArrowRight,
    Bot,
    Check,
    ChevronRight,
    Globe2,
    MessageCircle,
    Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
    BusinessCategory,
    BusinessProfile,
    extractBusinessDetails,
    useDemoWorkspace,
    writeWorkspace,
} from "@/lib/workspace";

const categories: BusinessCategory[] = [
    "Beauty & wellness",
    "Food & hospitality",
    "Health & clinics",
    "Retail & online shop",
    "Auto & home services",
    "Other",
];
const emptyBusiness: BusinessProfile = {
    name: "",
    category: "Other",
    description: "",
    location: "",
    hours: "",
    phone: "",
    language: "English",
    tone: "Friendly",
    services: [],
};
const tones = [
    {
        name: "Friendly" as const,
        description: "Warm, helpful and easy to talk to.",
    },
    {
        name: "Professional" as const,
        description: "Clear, polished and to the point.",
    },
    {
        name: "Premium" as const,
        description: "Considered service with an elevated feel.",
    },
    {
        name: "Casual" as const,
        description: "Natural, relaxed and conversational.",
    },
];

export default function OnboardingPage() {
    const router = useRouter();
    const { ready, workspace } = useDemoWorkspace();
    const [businessDraft, setBusinessDraft] = useState<BusinessProfile | null>(
        null,
    );
    const business = businessDraft ?? workspace?.business ?? emptyBusiness;
    const [step, setStep] = useState(0);
    const [saved, setSaved] = useState(false);
    const [widgetEnabled, setWidgetEnabled] = useState(true);

    useEffect(() => {
        if (ready && !workspace?.email) {
            router.replace("/signup");
        }
    }, [ready, router, workspace?.email]);

    function update<K extends keyof BusinessProfile>(
        key: K,
        value: BusinessProfile[K],
    ) {
        setBusinessDraft((current) => ({ ...(current ?? business), [key]: value }));
    }

    function next(event?: FormEvent) {
        event?.preventDefault();
        setStep((current) => Math.min(current + 1, 4));
    }

    function finish() {
        if (!workspace) return;
        writeWorkspace({ ...workspace, business, assistantPublished: false });
        setSaved(true);
    }

    if (!ready || !workspace)
        return (
            <main className="onboarding-loading">
                <span className="loading-mark">
                    <Sparkles size={18} />
                </span>
                <p>Preparing your workspace...</p>
            </main>
        );

    if (saved)
        return (
            <main className="setup-page setup-success">
                <div className="setup-success-mark">
                    <Check size={26} />
                </div>
                <div className="eyebrow">BUILT AROUND YOUR BUSINESS</div>
                <h1>
                    Your AI teammate
                    <br />
                    <span>is ready to meet you.</span>
                </h1>
                <p>
                    We’ve created a first version for {business.name || "your business"}.
                    You can teach it more and test a conversation in your workspace.
                </p>
                <div className="success-checklist">
                    <span>
                        <Check size={14} /> Business profile saved
                    </span>
                    <span>
                        <Check size={14} /> Assistant style set to{" "}
                        {business.tone.toLowerCase()}
                    </span>
                    <span>
                        <Check size={14} /> Demo chat ready to test
                    </span>
                </div>
                <button
                    type="button"
                    className="button button-blue"
                    onClick={() => router.push("/dashboard")}
                >
                    Open your workspace <ArrowRight size={15} />
                </button>
                <button
                    type="button"
                    className="success-secondary"
                    onClick={() => router.push("/dashboard?view=assistant")}
                >
                    Test your AI assistant
                </button>
                <div className="demo-disclosure">
                    <Sparkles size={14} />
                    <span>
                        Demo workspace only. Your profile is saved in this browser;
                        publishing and external channels are not connected.
                    </span>
                </div>
            </main>
        );

    return (
        <main className="setup-page">
            <header className="setup-header">
                <Link href="/" className="brand">
                    <span className="brand-mark">
                        <Sparkles size={17} />
                    </span>
                    <span>
                        biz<span>ai</span>
                    </span>
                </Link>
                <div className="setup-account">
                    Setting up for <b>{workspace.email}</b>
                </div>
                <Link href="/dashboard" className="setup-exit">
                    Exit setup <ArrowRight size={14} />
                </Link>
            </header>
            <div className="setup-layout">
                <aside className="setup-aside">
                    <div className="setup-aside-mark">
                        <Bot size={19} />
                    </div>
                    <div className="eyebrow">YOUR AI, YOUR RULES</div>
                    <h2>
                        Built on what
                        <br />
                        makes your
                        <br />
                        <span>business yours.</span>
                    </h2>
                    <p>
                        Just the useful bits. Your assistant learns from the details you
                        choose to share.
                    </p>
                    <div className="setup-aside-footer">
                        <Globe2 size={15} /> Works in English, Russian &amp; Kazakh
                    </div>
                </aside>
                <section className="setup-main">
                    <div className="setup-progress-head">
                        <span>LET&apos;S GET YOU SET UP</span>
                        <span>
                            {step + 1} <i>/</i> 5
                        </span>
                    </div>
                    <div className="progress-track">
                        <span style={{ width: `${(step + 1) * 20}%` }} />
                    </div>
                    {step === 0 && (
                        <form className="setup-form" onSubmit={next}>
                            <div className="step-eyebrow">
                                STEP 01 <i /> THE BASICS
                            </div>
                            <h1>
                                What should we call
                                <br />
                                your business?
                            </h1>
                            <p>Start with the name customers know you by.</p>
                            <label htmlFor="business-name">Business name</label>
                            <input
                                autoFocus
                                id="business-name"
                                required
                                maxLength={80}
                                placeholder="e.g. Mira Studio"
                                value={business.name}
                                onChange={(event) => update("name", event.target.value)}
                            />
                            <label htmlFor="business-type">
                                What kind of business is it?
                            </label>
                            <select
                                id="business-type"
                                value={business.category}
                                onChange={(event) =>
                                    update("category", event.target.value as BusinessCategory)
                                }
                            >
                                {categories.map((category) => (
                                    <option key={category}>{category}</option>
                                ))}
                            </select>
                            <div className="setup-actions">
                                <span>About 2 minutes left</span>
                                <button className="button button-blue" type="submit">
                                    Continue <ArrowRight size={15} />
                                </button>
                            </div>
                        </form>
                    )}
                    {step === 1 && (
                        <form className="setup-form" onSubmit={next}>
                            <div className="step-eyebrow">
                                STEP 02 <i /> THE GOOD DETAILS
                            </div>
                            <h1>
                                Tell us about your
                                <br />
                                business, your way.
                            </h1>
                            <p>
                                A couple of sentences are plenty. We&apos;ll find the useful
                                details for you.
                            </p>
                            <label htmlFor="business-description">
                                A little about what you do
                            </label>
                            <textarea
                                autoFocus
                                id="business-description"
                                rows={5}
                                placeholder="We’re a neighborhood salon in Almaty. Open every day, 10:00 to 21:00. Men’s haircut is 8,000 ₸..."
                                value={business.description}
                                onChange={(event) => update("description", event.target.value)}
                            />
                            <button
                                className="extract-button"
                                type="button"
                                onClick={() => {
                                    const found = extractBusinessDetails(business.description);
                                    setBusinessDraft({
                                        ...business,
                                        name: business.name || found.name,
                                        location: found.location || business.location,
                                        hours: found.hours || business.hours,
                                        services: found.services.length
                                            ? found.services
                                            : business.services,
                                    });
                                }}
                            >
                                {" "}
                                <Sparkles size={14} /> Find business details
                            </button>
                            {(business.location ||
                                business.hours ||
                                business.services.length > 0) && (
                                    <div className="extracted-box">
                                        <strong>
                                            Here&apos;s what we found. Edit anything that needs a tweak.
                                        </strong>
                                        <div className="extracted-grid">
                                            <label>
                                                Location
                                                <input
                                                    value={business.location}
                                                    onChange={(event) =>
                                                        update("location", event.target.value)
                                                    }
                                                    placeholder="City or address"
                                                />
                                            </label>
                                            <label>
                                                Opening hours
                                                <input
                                                    value={business.hours}
                                                    onChange={(event) =>
                                                        update("hours", event.target.value)
                                                    }
                                                    placeholder="e.g. 10:00–21:00"
                                                />
                                            </label>
                                            <label className="extracted-services">
                                                Services or prices
                                                <input
                                                    value={business.services.join(", ")}
                                                    onChange={(event) =>
                                                        update(
                                                            "services",
                                                            event.target.value
                                                                .split(",")
                                                                .map((service) => service.trim())
                                                                .filter(Boolean),
                                                        )
                                                    }
                                                    placeholder="e.g. Cut — 8,000 ₸"
                                                />
                                            </label>
                                        </div>
                                    </div>
                                )}
                            <div className="setup-actions">
                                <button
                                    className="back-step"
                                    type="button"
                                    onClick={() => setStep(0)}
                                >
                                    <ArrowLeft size={14} /> Back
                                </button>
                                <button className="button button-blue" type="submit">
                                    Continue <ArrowRight size={15} />
                                </button>
                            </div>
                        </form>
                    )}
                    {step === 2 && (
                        <form className="setup-form" onSubmit={next}>
                            <div className="step-eyebrow">
                                STEP 03 <i /> A LITTLE PERSONALITY
                            </div>
                            <h1>
                                How should your
                                <br />
                                assistant sound?
                            </h1>
                            <p>
                                Pick the style that feels most like your business. You can
                                change this later.
                            </p>
                            <div className="tone-options">
                                {tones.map((tone) => (
                                    <button
                                        type="button"
                                        key={tone.name}
                                        className={`tone-option ${business.tone === tone.name ? "selected" : ""}`}
                                        onClick={() => update("tone", tone.name)}
                                    >
                                        <span className="tone-option-radio">
                                            {business.tone === tone.name && <i />}
                                        </span>
                                        <span>
                                            <b>{tone.name}</b>
                                            <small>{tone.description}</small>
                                        </span>
                                        <ChevronRight size={15} />
                                    </button>
                                ))}
                            </div>
                            <label htmlFor="language">Main conversation language</label>
                            <select
                                id="language"
                                value={business.language}
                                onChange={(event) =>
                                    update(
                                        "language",
                                        event.target.value as BusinessProfile["language"],
                                    )
                                }
                            >
                                <option>English</option>
                                <option>Russian</option>
                                <option>Kazakh</option>
                            </select>
                            <div className="setup-actions">
                                <button
                                    className="back-step"
                                    type="button"
                                    onClick={() => setStep(1)}
                                >
                                    <ArrowLeft size={14} /> Back
                                </button>
                                <button className="button button-blue" type="submit">
                                    Continue <ArrowRight size={15} />
                                </button>
                            </div>
                        </form>
                    )}
                    {step === 3 && (
                        <div className="setup-form">
                            <div className="step-eyebrow">
                                STEP 04 <i /> WHERE TO FIND YOU
                            </div>
                            <h1>
                                Meet your customers
                                <br />
                                where they are.
                            </h1>
                            <p>Choose a starting point. You can add more channels anytime.</p>
                            <div className="channel-option channel-active">
                                <span className="channel-icon channel-web">
                                    <Globe2 size={17} />
                                </span>
                                <span>
                                    <b>Website chat</b>
                                    <small>A chat widget for your website</small>
                                </span>
                                <span className="channel-toggle">
                                    <i />
                                </span>
                            </div>
                            {["WhatsApp", "Instagram", "Telegram"].map((channel) => (
                                <div className="channel-option channel-disabled" key={channel}>
                                    <span className="channel-icon channel-placeholder">
                                        <MessageCircle size={16} />
                                    </span>
                                    <span>
                                        <b>{channel}</b>
                                        <small>External connection not configured</small>
                                    </span>
                                    <span className="coming-soon">COMING SOON</span>
                                </div>
                            ))}
                            <div className="setup-actions">
                                <button
                                    className="back-step"
                                    type="button"
                                    onClick={() => setStep(2)}
                                >
                                    <ArrowLeft size={14} /> Back
                                </button>
                                <button
                                    className="button button-blue"
                                    type="button"
                                    onClick={() => setStep(4)}
                                >
                                    Review assistant <ArrowRight size={15} />
                                </button>
                            </div>
                        </div>
                    )}
                    {step === 4 && (
                        <div className="setup-form">
                            <div className="step-eyebrow">
                                STEP 05 <i /> READY WHEN YOU ARE
                            </div>
                            <h1>
                                One last look.
                                <br />
                                Then say hello.
                            </h1>
                            <p>
                                Your assistant starts in draft mode. You can test it before
                                anything goes live.
                            </p>
                            <div className="review-card">
                                <div className="review-card-head">
                                    <span className="review-avatar">
                                        {business.name.slice(0, 1) || "B"}
                                    </span>
                                    <div>
                                        <b>{business.name || "Your business"}</b>
                                        <small>{business.category}</small>
                                    </div>
                                    <span className="draft-pill">DRAFT</span>
                                </div>
                                <div className="review-divider" />
                                <div className="review-row">
                                    <span>Personality</span>
                                    <b>
                                        {business.tone} · {business.language}
                                    </b>
                                </div>
                                <div className="review-row">
                                    <span>Business info</span>
                                    <b>{business.description ? "Added" : "Add later"}</b>
                                </div>
                                <div className="review-row">
                                    <span>Website widget</span>
                                    <button
                                        className={`small-switch ${widgetEnabled ? "on" : ""}`}
                                        aria-label="Toggle website chat"
                                        type="button"
                                        onClick={() => setWidgetEnabled((enabled) => !enabled)}
                                    >
                                        <i />
                                    </button>
                                </div>
                                <div className="review-note">
                                    <Sparkles size={14} />
                                    <span>
                                        Nothing is published. Your assistant is private until you
                                        choose otherwise.
                                    </span>
                                </div>
                            </div>
                            <div className="setup-actions">
                                <button
                                    className="back-step"
                                    type="button"
                                    onClick={() => setStep(3)}
                                >
                                    <ArrowLeft size={14} /> Back
                                </button>
                                <button
                                    className="button button-blue"
                                    type="button"
                                    onClick={finish}
                                >
                                    Create my AI <ArrowRight size={15} />
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
            <footer className="setup-footer">
                <span>
                    <MessageCircle size={13} /> Need a hand? hello@floralai.example
                </span>
                <span>DEMO SETUP · NOTHING PUBLISHED</span>
            </footer>
        </main>
    );
}
