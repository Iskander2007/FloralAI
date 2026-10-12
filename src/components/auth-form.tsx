"use client";

import { ArrowLeft, ArrowRight, Eye, EyeOff, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateError } from "@/lib/i18n";
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
    const { locale, t } = useLanguage();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [codeRequested, setCodeRequested] = useState(false);
    const [resendCountdown, setResendCountdown] = useState(0);
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [googlePending, setGooglePending] = useState(false);
    const supabase = createSupabaseBrowserClient();
    const authConfigured = supabase !== null;
    const isSignup = mode === "signup";

    useEffect(() => {
        if (resendCountdown === 0) return;
        const timer = window.setTimeout(
            () => setResendCountdown((current) => Math.max(0, current - 1)),
            1000,
        );
        return () => window.clearTimeout(timer);
    }, [resendCountdown]);

    async function requestCode() {
        if (!supabase) return;
        setError("");
        setNotice("");
        setBusy(true);
        const normalizedEmail = email.trim();
        try {
            const { error: otpError } = await supabase.auth.signInWithOtp({
                email: normalizedEmail,
                options: { shouldCreateUser: isSignup },
            });
            if (otpError) throw otpError;
            setEmail(normalizedEmail);
            setCode("");
            setCodeRequested(true);
            setResendCountdown(60);
            setNotice(t("We sent a 6-digit sign-in code to your email."));
        } catch (authError) {
            setError(
                translateError(locale, authError, "Authentication failed. Please try again."),
            );
        } finally {
            setBusy(false);
        }
    }

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setNotice("");

        if (supabase) {
            if (!codeRequested) {
                await requestCode();
                return;
            }
            const token = code.replace(/\D/g, "");
            if (token.length !== 6) {
                setError(t("Enter the 6-digit code from your email."));
                return;
            }
            setBusy(true);
            try {
                const { data, error: otpError } = await supabase.auth.verifyOtp({
                    email: email.trim(),
                    token,
                    type: "email",
                });
                if (otpError) throw otpError;
                const authenticatedEmail = data.user?.email;
                if (!authenticatedEmail) {
                    throw new Error(t("The authentication provider did not return an email address."));
                }
                const existing = readWorkspace();
                const sameAccount =
                    existing?.email.toLowerCase() === authenticatedEmail.toLowerCase();
                writeWorkspace({
                    email: authenticatedEmail,
                    business: sameAccount ? existing?.business ?? null : null,
                    assistantPublished: sameAccount
                        ? existing?.assistantPublished ?? false
                        : false,
                });
                router.push(
                    sameAccount && existing?.business
                        ? "/dashboard"
                        : "/onboarding",
                );
            } catch (authError) {
                setError(
                    translateError(locale, authError, "Authentication failed. Please try again."),
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
                t("This local demo only recognises the email used on this browser."),
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
        if (busy) return;
        setError("");
        setNotice("");
        if (!supabase) {
            setError(t("Google sign-in is not available yet. Please continue with email."));
            return;
        }
        setBusy(true);
        setGooglePending(true);
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
                translateError(locale, oauthError, "Google sign-in failed. Please try again."),
            );
        } finally {
            setBusy(false);
            setGooglePending(false);
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
                        readOnly={authConfigured && codeRequested}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                    />
                    {authConfigured && codeRequested && (
                        <button
                            className="auth-code-change"
                            type="button"
                            onClick={() => {
                                setCodeRequested(false);
                                setCode("");
                                setResendCountdown(0);
                                setError("");
                                setNotice("");
                            }}
                        >
                            {t("Change email")}
                        </button>
                    )}
                    {authConfigured ? (
                        codeRequested && (
                            <>
                                <label htmlFor="email-code">{t("6-digit email code")}</label>
                                <input
                                    id="email-code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    pattern="[0-9]{6}"
                                    maxLength={6}
                                    placeholder="123456"
                                    required
                                    value={code}
                                    onChange={(event) =>
                                        setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                                    }
                                />
                            </>
                        )
                    ) : (
                        <>
                            <label htmlFor="password">{t("Password")}</label>
                            <div className="password-field">
                            <input
                                id="password"
                                type={visible ? "text" : "password"}
                                autoComplete={isSignup ? "new-password" : "current-password"}
                                placeholder={t("Password")}
                                minLength={1}
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
                    </>
                )}
                {error && (
                    <p id="auth-error" className="auth-error" role="alert">
                            {error}
                    </p>
                )}
                <button className="button button-blue auth-submit" type="submit" disabled={busy}>
                    {t(
                            authConfigured
                                ? codeRequested
                                    ? "Verify code and continue"
                                    : "Send me a sign-in code"
                                : isSignup
                                  ? "Create free account"
                                  : "Continue to your workspace",
                    )}{" "}
                    <ArrowRight size={15} />
                </button>
            </form>
                {notice && <p className="auth-notice" role="status">{notice}</p>}
                {authConfigured && codeRequested && (
                    <button
                        className="auth-code-resend"
                        type="button"
                        disabled={busy || resendCountdown > 0}
                        onClick={requestCode}
                    >
                        {resendCountdown > 0
                            ? t("Resend code in {seconds}s").replace(
                                  "{seconds}",
                                  String(resendCountdown),
                              )
                            : t("Resend code")}
                    </button>
                )}
                <div className="auth-divider">
                    <span /> {t("or")} <span />
                </div>
                <button
                    className="google-button"
                    type="button"
                    disabled={busy}
                    aria-busy={googlePending}
                    aria-describedby={error ? "auth-error" : undefined}
                    onClick={continueWithGoogle}
                >
                    <svg className="google-button-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-1.99 3.02v2.51h3.23c1.89-1.74 2.98-4.3 2.98-7.36Z" />
                        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.23-2.51c-.9.6-2.05.96-3.39.96-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z" />
                        <path fill="#FBBC05" d="M6.41 13.92a6 6 0 0 1 0-3.84V7.49H3.07a10 10 0 0 0 0 9.02l3.34-2.59Z" />
                        <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.51 3.83 1.51L18.7 4.6A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.93 5.49l3.34 2.59C7.2 7.72 9.4 5.96 12 5.96Z" />
                    </svg>
                    {t(googlePending ? "Opening Google…" : "Continue with Google")}
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
