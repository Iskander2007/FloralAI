"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { readWorkspace, writeWorkspace } from "@/lib/workspace";
import "../app/floral-theme.css";

export function AuthForm({ mode }: { mode: "signup" | "login" }) {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState("");
    const isSignup = mode === "signup";

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        const existing = readWorkspace();
        if (
            !isSignup &&
            existing?.email &&
            existing.email.toLowerCase() !== email.toLowerCase()
        ) {
            setError(
                "This local demo only recognises the email used on this browser.",
            );
            return;
        }
        writeWorkspace({
            email,
            business:
                existing?.email?.toLowerCase() === email.toLowerCase()
                    ? existing.business
                    : null,
            assistantPublished: existing?.assistantPublished ?? false,
        });
        router.push(!isSignup && existing?.business ? "/dashboard" : "/onboarding");
    }

    return (
        <main className="auth-page">
            <Link href="/" className="auth-back">
                <ArrowLeft size={15} /> Back to FloralAI
            </Link>
            <section className="auth-card">
                <Link href="/" className="brand auth-brand">
                    <span className="brand-mark">
                        <Sparkles size={17} />
                    </span>
                    <span>
                        Floral<span>AI</span>
                    </span>
                </Link>
                <div className="auth-kicker">
                    {isSignup ? "YOUR BUSINESS, WITH A LITTLE MORE ROOM" : "WELCOME BACK"}
                </div>
                <h1>
                    {isSignup
                        ? "Let’s build your AI teammate."
                        : "Good to have you back."}
                </h1>
                <p className="auth-intro">
                    {isSignup
                        ? "Start with an email. We’ll set up the rest together."
                        : "Pick up where you left off."}
                </p>
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label htmlFor="email">Work email</label>
                    <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@yourbusiness.com"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                    />
                    <label htmlFor="password">Password</label>
                    <div className="password-field">
                        <input
                            id="password"
                            type={visible ? "text" : "password"}
                            autoComplete={isSignup ? "new-password" : "current-password"}
                            placeholder="At least 8 characters"
                            minLength={8}
                            required
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setVisible((current) => !current)}
                            aria-label={visible ? "Hide password" : "Show password"}
                        >
                            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {error && (
                        <p className="auth-error" role="alert">
                            {error}
                        </p>
                    )}
                    <button className="button button-blue auth-submit" type="submit">
                        {isSignup ? "Create free account" : "Continue to your workspace"}{" "}
                        <ArrowRight size={15} />
                    </button>
                </form>
                <div className="auth-divider">
                    <span /> or <span />
                </div>
                <button
                    className="google-button"
                    type="button"
                    disabled
                    title="OAuth is not configured in this demo"
                >
                    Continue with Google <span>Not connected</span>
                </button>
                <p className="auth-switch">
                    {isSignup ? "Already have an account?" : "New to FloralAI?"}{" "}
                    <Link href={isSignup ? "/login" : "/signup"}>
                        {isSignup ? "Log in" : "Create a free account"}
                    </Link>
                </p>
                <div className="demo-disclosure">
                    <Sparkles size={14} />
                    <span>
                        This is a local product preview. Account details stay in this
                        browser; server authentication is not configured.
                    </span>
                </div>
            </section>
            <div className="auth-side-note">
                <span>01 / 05</span>
                <p>
                    A better way to be there
                    <br />
                    for your customers.
                </p>
                <div>
                    <i />
                    No card needed <i />
                    Setup in minutes
                </div>
            </div>
        </main>
    );
}
