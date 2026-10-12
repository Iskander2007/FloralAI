"use client";

import { useEffect, useState } from "react";
import { Copy, ExternalLink, Send } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { translateError } from "@/lib/i18n";

type TelegramBusiness = {
    id: string;
    owner_id: string;
    business_name: string;
    start_code: string;
    active: boolean;
};

export function TelegramChannel({ businessName }: { businessName: string }) {
    const { locale, t } = useLanguage();
    const [setup, setSetup] = useState<TelegramBusiness | null>(null);
    const [botUsername, setBotUsername] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    useEffect(() => {
        let cancelled = false;
        async function loadSetup() {
            const supabase = createSupabaseBrowserClient();
            if (!supabase) {
                setError(t("Telegram requires a signed-in Supabase account."));
                setLoading(false);
                return;
            }
            try {
                const { data: userData, error: userError } =
                    await supabase.auth.getUser();
                if (userError) throw userError;
                if (!userData.user) {
                    throw new Error(t("Sign in to connect Telegram."));
                }
                const { data, error: queryError } = await supabase
                    .from("telegram_businesses")
                    .select("id, owner_id, business_name, start_code, active")
                    .eq("owner_id", userData.user.id)
                    .maybeSingle();
                if (queryError) throw queryError;
                if (!cancelled) setSetup(data as TelegramBusiness | null);

                const configResponse = await fetch("/api/telegram/setup", {
                    cache: "no-store",
                });
                const config = (await configResponse.json()) as {
                    username?: string;
                    error?: string;
                };
                if (configResponse.ok && config.username && !cancelled) {
                    setBotUsername(config.username);
                } else if (!configResponse.ok && !cancelled) {
                    setError(translateError(locale, config.error, "Telegram bot is not configured on the server yet."));
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(
                        translateError(locale, loadError, "Could not load Telegram settings."),
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void loadSetup();
        return () => {
            cancelled = true;
        };
    }, [locale, t]);

    async function connect() {
        setError("");
        setNotice("");
        setSaving(true);
        const supabase = createSupabaseBrowserClient();
        if (!supabase) {
            setError(t("Telegram requires a signed-in Supabase account."));
            setSaving(false);
            return;
        }
        try {
            const { data: userData, error: userError } =
                await supabase.auth.getUser();
            if (userError) throw userError;
            if (!userData.user) throw new Error(t("Sign in to connect Telegram."));

            const startCode =
                setup?.start_code ??
                Array.from(crypto.getRandomValues(new Uint8Array(24)))
                    .map((value) => value.toString(16).padStart(2, "0"))
                    .join("");
            const webhookResponse = await fetch("/api/telegram/setup", {
                method: "POST",
            });
            const webhook = (await webhookResponse.json()) as {
                username?: string;
                error?: string;
            };
            if (!webhookResponse.ok || !webhook.username) {
                throw new Error(webhook.error ?? t("Could not activate the Telegram bot."));
            }

            const row = {
                owner_id: userData.user.id,
                business_name: businessName.trim().slice(0, 120) || t("My flower shop"),
                start_code: startCode,
                active: true,
            };
            const query = setup
                ? supabase
                      .from("telegram_businesses")
                      .update(row)
                      .eq("id", setup.id)
                      .eq("owner_id", userData.user.id)
                : supabase.from("telegram_businesses").insert(row);
            const { data, error: saveError } = await query
                .select("id, owner_id, business_name, start_code, active")
                .single();
            if (saveError) throw saveError;
            setSetup(data as TelegramBusiness);
            setBotUsername(webhook.username);
            setNotice(t("Telegram bot connected. Share its link with your customers."));
        } catch (connectError) {
            setError(
                translateError(locale, connectError, "Could not connect Telegram."),
            );
        } finally {
            setSaving(false);
        }
    }

    async function disconnect() {
        const supabase = createSupabaseBrowserClient();
        if (!supabase || !setup) return;
        setSaving(true);
        setError("");
        setNotice("");
        try {
            const { data: userData, error: userError } =
                await supabase.auth.getUser();
            if (userError) throw userError;
            if (!userData.user) throw new Error(t("Sign in to manage Telegram."));
            const { data, error: updateError } = await supabase
                .from("telegram_businesses")
                .update({ active: false })
                .eq("id", setup.id)
                .eq("owner_id", userData.user.id)
                .select("id, owner_id, business_name, start_code, active")
                .single();
            if (updateError) throw updateError;
            setSetup(data as TelegramBusiness);
            setNotice(t("Telegram bot paused."));
        } catch (disconnectError) {
            setError(
                translateError(locale, disconnectError, "Could not pause Telegram."),
            );
        } finally {
            setSaving(false);
        }
    }

    async function copyLink() {
        if (!setup || !botUsername) return;
        try {
            await navigator.clipboard.writeText(
                `https://t.me/${botUsername}?start=${setup.start_code}`,
            );
            setNotice(t("Telegram link copied."));
        } catch (copyError) {
            setError(
                translateError(locale, copyError, "Could not copy the Telegram link."),
            );
        }
    }

    const telegramLink =
        setup && botUsername
            ? `https://t.me/${botUsername}?start=${setup.start_code}`
            : null;

    return (
        <section className="dashboard-panel telegram-channel">
            <div className="telegram-channel-heading">
                <span className="channel-card-icon"><Send size={18} /></span>
                <div>
                    <h2>{t("One shared FloralAI Telegram bot")}</h2>
                    <p>Клиенты переходят по вашей ссылке. Бот учитывает сохранённый профиль бизнеса, предлагает товары из каталога и собирает заявки.</p>
                </div>
                <span className={`channel-state ${setup?.active ? "channel-available" : ""}`}>
                    {t(loading ? "Loading..." : setup?.active ? "CONNECTED" : "NOT CONNECTED")}
                </span>
            </div>

            {(error || notice) && (
                <p className={error ? "auth-error" : "auth-notice"} role={error ? "alert" : "status"}>
                    {error || notice}
                </p>
            )}

            {telegramLink && (
                <div className="telegram-link-row">
                    <a href={telegramLink} target="_blank" rel="noreferrer">
                        {telegramLink} <ExternalLink size={14} />
                    </a>
                    <button
                        type="button"
                        className="button button-outline"
                        onClick={() => void copyLink()}
                    >
                        <Copy size={14} /> {t("Copy link")}
                    </button>
                </div>
            )}

            <div className="telegram-channel-notes">
                <p>Ассистент уточняет повод, бюджет, имя, телефон, адрес и время доставки. После подтверждения клиентом заявка появится в разделе «Заявки».</p>
                <p>Изменения профиля доступны боту после нажатия «Сохранить данные». В каталоге и описании бизнеса указывайте информацию для клиентов.</p>
            </div>

            <div className="product-form-actions">
                <button
                    type="button"
                    className="button button-blue"
                    onClick={() => void connect()}
                    disabled={loading || saving || !businessName.trim()}
                >
                    {saving
                        ? t("Connecting...")
                        : setup?.active
                          ? t("Reconnect Telegram")
                          : t("Connect Telegram")}
                </button>
                {setup?.active && (
                    <button
                        type="button"
                        className="button button-outline"
                        onClick={() => void disconnect()}
                        disabled={saving}
                    >
                        {t("Pause bot")}
                    </button>
                )}
            </div>
        </section>
    );
}
