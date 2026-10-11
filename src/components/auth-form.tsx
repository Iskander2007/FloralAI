"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readWorkspace, writeWorkspace } from "@/lib/workspace";
import "../app/floral-theme.css";

export function AuthForm({
    mode,
    callbackError,
}: {
    mode: "signup" | "login";
    callbackError?: "auth_not_configured" | "auth_callback_failed";
}) {
    const router = useRouter();
    const { t } = useLanguage();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const supabase = createSupabaseBrowserClient();
    const authConfigured = supabase !== null;
    const isSignup = mode === "signup";

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setNotice("");

        if (
            isSignup &&
            supabase &&
            (password.length < 12 ||
                !/[a-z]/.test(password) ||
                !/[A-Z]/.test(password) ||
                !/\d/.test(password))
        ) {
            setError(t("Use at least 12 characters with an uppercase letter, a lowercase letter and a number."));
            return;
        }

        if (supabase) {
            setBusy(true);
            try {
                if (isSignup) {
                    const { data, error: signupError } = await supabase.auth.signUp({
                        email,
                        password,
                        options: {
                            emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
                        },
                    });
                    if (signupError) throw signupError;

                    if (!data.session) {
                        setNotice(t("Check your email to confirm your account."));
                        return;
                    }
                    const existing = readWorkspace();
                    const sameAccount =
                        existing?.email.toLowerCase() === email.toLowerCase();
                    writeWorkspace({
                        email: data.user?.email ?? email,
                        business: sameAccount ? existing?.business ?? null : null,
                        assistantPublished: sameAccount
                            ? existing?.assistantPublished ?? false
                            : false,
                    });
                    router.push("/onboarding");
                    return;
                }

                const { data, error: loginError } =
                    await supabase.auth.signInWithPassword({ email, password });
                if (loginError) throw loginError;
                const authenticatedEmail = data.user.email;
                if (!authenticatedEmail) {
                    throw new Error(t("The authentication provider did not return an email address."));
                }
                const existing = readWorkspace();
                writeWorkspace({
                    email: authenticatedEmail,
                    business:
                        existing?.email.toLowerCase() === authenticatedEmail.toLowerCase()
                            ? existing.business
                            : null,
                    assistantPublished: existing?.assistantPublished ?? false,
                });
                router.push(
                    existing?.email.toLowerCase() === authenticatedEmail.toLowerCase() &&
                        existing.business
                        ? "/dashboard"
                        : "/onboarding",
                );
            } catch (authError) {
                setError(
                    authError instanceof Error
                        ? authError.message
                        : t("Authentication failed. Please try again."),
                );
            } finally {
                setBusy(false);
            }
            return;
        }

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

    async function continueWithGoogle() {
        if (!supabase) return;
        setError("");
        setBusy(true);
        try {
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo: `${window.location.origin}/auth/callback?next=/onboarding`,
                },
            });
            if (oauthError) throw oauthError;
        } catch (oauthError) {
            setError(
                oauthError instanceof Error
                    ? oauthError.message
                    : t("Google sign-in failed. Please try again."),
            );
        } finally {
            setBusy(false);
        }
    }

    return (
        <main className="auth-page">
            <Link href="/" className="auth-back">
                <ArrowLeft size={15} /> {t("Back to FloralAI")}
            </Link>
            <section className="auth-card">
                <div className="auth-language">
                    <LanguageSwitcher />
                </div>
                <Link href="/" className="brand auth-brand">
                    <span className="brand-mark">
                        <Sparkles size={17} />
                    </span>
                    <span translate="no" className="brand-name">
                        Floral<span>AI</span>
                    </span>
                </Link>
                <div className="auth-kicker">
                    {t(isSignup ? "YOUR BUSINESS, WITH A LITTLE MORE ROOM" : "WELCOME BACK")}
                </div>
                <h1>
                    {isSignup
                        ? t("Let’s build your AI teammate.")
                        : t("Good to have you back.")}
                </h1>
                <p className="auth-intro">
                    {isSignup
                        ? t("Start with an email. We’ll set up the rest together.")
                        : t("Pick up where you left off.")}
                </p>
                {callbackError && (
                    <p className="auth-error" role="alert">
                        {t(
                            callbackError === "auth_not_configured"
                                ? "Account authentication is not configured yet."
                                : "We could not complete sign-in. Please try again.",
                        )}
                    </p>
                )}
                <form className="auth-form" onSubmit={handleSubmit}>
                    <label htmlFor="email">{t("Work email")}</label>
                    <input
                        id="email"
                        type="email"
                        autoComplete="email"
                        placeholder="you@yourbusiness.com"
                        required
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                    />
                    <label htmlFor="password">{t("Password")}</label>
                    <div className="password-field">
                        <input
                            id="password"
                            type={visible ? "text" : "password"}
                            autoComplete={isSignup ? "new-password" : "current-password"}
                            placeholder={t(isSignup && authConfigured ? "At least 12 characters" : "Password")}
                            minLength={isSignup && authConfigured ? 12 : 1}
                            required
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                        />
                        <button
                            type="button"
                            onClick={() => setVisible((current) => !current)}
                            aria-label={t(visible ? "Hide password" : "Show password")}
                        >
                            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {error && (
                        <p className="auth-error" role="alert">
                            {error}
                        </p>
                    )}
                    <button className="button button-blue auth-submit" type="submit" disabled={busy}>
                        {t(isSignup ? "Create free account" : "Continue to your workspace")}{" "}
                        <ArrowRight size={15} />
                    </button>
                </form>
                {notice && <p className="auth-notice" role="status">{notice}</p>}
                <div className="auth-divider">
                    <span /> {t("or")} <span />
                </div>
                <button
                    className="google-button"
                    type="button"
                    disabled={busy || !authConfigured}
                    onClick={continueWithGoogle}
                    title={authConfigured ? t("Continue with Google") : t("OAuth is not configured in this preview")}
                >
                    {t("Continue with Google")}{" "}
                    <span>{authConfigured ? t("Connected") : t("Not connected")}</span>
                </button>
                <p className="auth-switch">
                    {t(isSignup ? "Already have an account?" : "New to FloralAI?")}{" "}
                    <Link href={isSignup ? "/login" : "/signup"}>
                        {t(isSignup ? "Log in" : "Create a free account")}
                    </Link>
                </p>
                <div className="demo-disclosure">
                    <Sparkles size={14} />
                    <span>{authConfigured
                        ? t("Business profile data remains in this browser preview; account authentication is handled by Supabase.")
                        : t("This is a local product preview. Account details stay in this browser; server authentication is not configured.")}
                    </span>
                </div>
            </section>
            <div className="auth-side-note">
                <span>01 / 05</span>
                <p>
                    {t("A better way to be there")}
                    <br />
                    {t("for your customers.")}
                </p>
                <div>
                    <i /> {t("No card needed")} <i /> {t("Setup in minutes")}
                </div>
            </div>
        </main>
    );
}
