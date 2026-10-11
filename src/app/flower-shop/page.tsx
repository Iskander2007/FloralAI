"use client";

import { ArrowLeft, ArrowRight, Flower2, RotateCcw, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
    emptyFlowerOrder,
    flowerProductDescription,
    flowerProductName,
    FlowerFlowStep,
    FlowerOrderDraft,
    flowerCatalog,
    formatKzt,
} from "@/lib/flower-assistant";
import "./flower-shop.css";
import "../floral-theme.css";

type ChatMessage = { role: "assistant" | "user"; content: string };

export default function FlowerShopPage() {
    const { locale, t } = useLanguage();
    const welcomeMessage = t("Hello! I can help you choose a bouquet and place an order. What is the occasion?");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [step, setStep] = useState<FlowerFlowStep>("occasion");
    const [draft, setDraft] = useState<FlowerOrderDraft>(emptyFlowerOrder);
    const [input, setInput] = useState("");
    const [idempotencyKey, setIdempotencyKey] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function send(event?: FormEvent, suggestedMessage?: string) {
        event?.preventDefault();
        const message = (suggestedMessage ?? input).trim();
        if (!message || busy || step === "complete") return;

        const key = idempotencyKey || window.crypto.randomUUID();
        setIdempotencyKey(key);
        setInput("");
        setError("");
        setMessages((current) => [...current, { role: "user", content: message }]);
        setBusy(true);

        try {
            const response = await fetch("/api/flower-assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message, step, draft, idempotencyKey: key, locale }),
            });
            const result = (await response.json()) as {
                reply?: string;
                step?: FlowerFlowStep;
                draft?: FlowerOrderDraft;
                error?: string;
            };
            if (!response.ok || !result.reply || !result.step || !result.draft) {
                throw new Error(result.error ?? t("Unable to get a response."));
            }
            setMessages((current) => [
                ...current,
                { role: "assistant", content: result.reply! },
            ]);
            setStep(result.step);
            setDraft(result.draft);
        } catch (requestError) {
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : t("Could not reach the server. Please try again."),
            );
        } finally {
            setBusy(false);
        }
    }

    function startNewOrder() {
        setMessages([{ role: "assistant", content: welcomeMessage }]);
        setStep("occasion");
        setDraft(emptyFlowerOrder);
        setIdempotencyKey("");
        setInput("");
        setError("");
    }

    return (
        <main className="flower-page">
            <header className="flower-header">
                <Link className="flower-back" href="/">
                    <ArrowLeft size={16} /> <span translate="no">FloralAI</span>
                </Link>
                <span className="flower-demo-badge"><i /> {t("FLOWER SHOP DEMO")}</span>
                <LanguageSwitcher />
            </header>

            <div className="flower-layout">
                <section className="flower-intro">
                    <div className="flower-kicker"><Sparkles size={14} /> {t("FLOWER SHOP ASSISTANT")}</div>
                    <h1>{t("From the first question")}<br />{t("to a bouquet order.")}</h1>
                    <p>
                        {t("The assistant will ask about the occasion, budget, bouquet, date, address and payment method, then show a summary before submitting your order.")}
                    </p>
                    <div className="flower-catalog">
                        <h2>{t("Sample catalog")}</h2>
                        {flowerCatalog.map((product, index) => (
                            <article className="flower-product" key={product.id}>
                                <span className="flower-number">0{index + 1}</span>
                                <div>
                                    <b>{flowerProductName(product.id, locale)}</b>
                                    <small>{flowerProductDescription(product.id, locale)}</small>
                                </div>
                                <strong>{formatKzt(product.priceKzt, locale)}</strong>
                            </article>
                        ))}
                        <p className="flower-disclosure">
                            {t("Catalog and prices are examples. The shop must confirm availability, delivery and the final price.")}
                        </p>
                    </div>
                    <Link className="flower-back-link" href="/dashboard">
                        {t("Back to your workspace")} <ArrowRight size={14} />
                    </Link>
                </section>

                <section className="flower-chat" aria-label={t("Flower order demo")}>
                    <div className="flower-chat-header">
                        <span className="flower-avatar"><Flower2 size={20} /></span>
                        <div>
                            <b>{t("Flower shop assistant")}</b>
                            <small><i /> {t("Ready to help with your order")}</small>
                        </div>
                        {step === "complete" && (
                            <button
                                className="flower-reset"
                                type="button"
                                onClick={startNewOrder}
                                aria-label={t("Start a new order")}
                                title={t("New order")}
                            >
                                <RotateCcw size={16} />
                            </button>
                        )}
                    </div>
                    <div className="flower-chat-messages" aria-live="polite">
                        {messages.length === 0 && (
                            <div className="flower-message">{welcomeMessage}</div>
                        )}
                        {messages.map((message, index) => (
                            <div
                                className={`flower-message ${message.role === "user" ? "flower-user-message" : ""}`}
                                key={`${index}-${message.role}`}
                            >
                                {message.content}
                            </div>
                        ))}
                        {busy && <div className="flower-typing" role="status">{t("Checking details…")}</div>}
                        <div />
                    </div>
                    {error && <p className="flower-error" role="alert">{error}</p>}
                    {step !== "complete" ? (
                        <>
                            {messages.length === 0 && (
                                <div className="flower-prompts">
                                    {[t("For a birthday"), t("I'd like roses"), t("How much do bouquets cost?")].map((prompt) => (
                                        <button
                                            type="button"
                                            key={prompt}
                                            onClick={() => send(undefined, prompt)}
                                            disabled={busy}
                                        >
                                            {prompt}
                                        </button>
                                    ))}
                                </div>
                            )}
                            <form className="flower-composer" onSubmit={send}>
                                <label className="visually-hidden" htmlFor="flower-message">{t("Your message")}</label>
                                <input
                                    id="flower-message"
                                    maxLength={500}
                                    value={input}
                                    onChange={(event) => setInput(event.target.value)}
                                    placeholder={t("Write a message...")}
                                    autoComplete="off"
                                />
                                <button type="submit" disabled={busy || !input.trim()} aria-label={t("Send message")}>
                                    <Send size={17} />
                                </button>
                            </form>
                        </>
                    ) : (
                        <button className="flower-new-order" type="button" onClick={startNewOrder}>
                            {t("New order")} <RotateCcw size={15} />
                        </button>
                    )}
                    <p className="flower-chat-footnote">
                        {t("Orders require a configured database to be saved. Card payments are not connected.")}
                    </p>
                </section>
            </div>
        </main>
    );
}
