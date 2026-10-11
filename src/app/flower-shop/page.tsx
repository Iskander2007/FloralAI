"use client";

import { ArrowLeft, ArrowRight, Flower2, RotateCcw, Send, Sparkles } from "lucide-react";
import Link from "next/link";
import { FormEvent, useState } from "react";
import {
    emptyFlowerOrder,
    FlowerFlowStep,
    FlowerOrderDraft,
    flowerCatalog,
    formatKzt,
} from "@/lib/flower-assistant";
import "./flower-shop.css";

type ChatMessage = { role: "assistant" | "user"; content: string };

const welcomeMessage =
    "Здравствуйте! Я помогу выбрать букет и оформить заявку. Сначала расскажите, по какому поводу нужны цветы?";

export default function FlowerShopPage() {
    const [messages, setMessages] = useState<ChatMessage[]>([
        { role: "assistant", content: welcomeMessage },
    ]);
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
                body: JSON.stringify({ message, step, draft, idempotencyKey: key }),
            });
            const result = (await response.json()) as {
                reply?: string;
                step?: FlowerFlowStep;
                draft?: FlowerOrderDraft;
                error?: string;
            };
            if (!response.ok || !result.reply || !result.step || !result.draft) {
                throw new Error(result.error ?? "Не удалось получить ответ.");
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
                    : "Не удалось связаться с сервером. Попробуйте ещё раз.",
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
                    <ArrowLeft size={16} /> BizAI
                </Link>
                <span className="flower-demo-badge"><i /> ДЕМО ЦВЕТОЧНОГО БИЗНЕСА</span>
            </header>

            <div className="flower-layout">
                <section className="flower-intro">
                    <div className="flower-kicker"><Sparkles size={14} /> ПОМОЩНИК ФЛОРИСТА</div>
                    <h1>От первого вопроса<br />до заявки на букет.</h1>
                    <p>
                        Помощник уточнит повод, бюджет, букет, дату, адрес и способ оплаты,
                        покажет итог и сохранит подтверждённую заявку на сервере.
                    </p>
                    <div className="flower-catalog">
                        <h2>Пример каталога</h2>
                        {flowerCatalog.map((product, index) => (
                            <article className="flower-product" key={product.id}>
                                <span className="flower-number">0{index + 1}</span>
                                <div>
                                    <b>{product.name}</b>
                                    <small>{product.description}</small>
                                </div>
                                <strong>{formatKzt(product.priceKzt)}</strong>
                            </article>
                        ))}
                        <p className="flower-disclosure">
                            Каталог и цены демонстрационные. Наличие, доставку и финальную
                            стоимость должен подтвердить магазин.
                        </p>
                    </div>
                    <Link className="flower-back-link" href="/dashboard">
                        Вернуться в рабочее пространство <ArrowRight size={14} />
                    </Link>
                </section>

                <section className="flower-chat" aria-label="Демонстрация заказа цветов">
                    <div className="flower-chat-header">
                        <span className="flower-avatar"><Flower2 size={20} /></span>
                        <div>
                            <b>Помощник цветочного магазина</b>
                            <small><i /> Готов помочь с заказом</small>
                        </div>
                        {step === "complete" && (
                            <button
                                className="flower-reset"
                                type="button"
                                onClick={startNewOrder}
                                aria-label="Начать новый заказ"
                                title="Новый заказ"
                            >
                                <RotateCcw size={16} />
                            </button>
                        )}
                    </div>
                    <div className="flower-chat-messages" aria-live="polite">
                        {messages.map((message, index) => (
                            <div
                                className={`flower-message ${message.role === "user" ? "flower-user-message" : ""}`}
                                key={`${index}-${message.role}`}
                            >
                                {message.content}
                            </div>
                        ))}
                        {busy && <div className="flower-typing" role="status">Проверяю данные…</div>}
                        <div />
                    </div>
                    {error && <p className="flower-error" role="alert">{error}</p>}
                    {step !== "complete" ? (
                        <>
                            {messages.length === 1 && (
                                <div className="flower-prompts">
                                    {["На день рождения", "Нужны розы", "Сколько стоят букеты?"].map((prompt) => (
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
                                <label className="visually-hidden" htmlFor="flower-message">Ваше сообщение</label>
                                <input
                                    id="flower-message"
                                    maxLength={500}
                                    value={input}
                                    onChange={(event) => setInput(event.target.value)}
                                    placeholder="Напишите сообщение…"
                                    autoComplete="off"
                                />
                                <button type="submit" disabled={busy || !input.trim()} aria-label="Отправить сообщение">
                                    <Send size={17} />
                                </button>
                            </form>
                        </>
                    ) : (
                        <button className="flower-new-order" type="button" onClick={startNewOrder}>
                            Новый заказ <RotateCcw size={15} />
                        </button>
                    )}
                    <p className="flower-chat-footnote">
                        Для сохранения заказов нужна PostgreSQL. Telegram можно подключить бесплатно после публичного деплоя и настройки BotFather. Оплата картой не подключена.
                    </p>
                </section>
            </div>
        </main>
    );
}
