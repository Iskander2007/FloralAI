"use client";

import { ArrowRight, Check, Flower2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BusinessProfileEditor } from "@/components/business-profile-editor";
import { useWorkspaceSession, writeWorkspace } from "@/lib/workspace";
import type { BusinessProfile } from "@/lib/business";
import "../floral-theme.css";
import "../business-tools.css";

const emptyBusiness: BusinessProfile = {
    name: "", category: "Retail & online shop", description: "", location: "", hours: "", phone: "",
    language: "Russian", tone: "Friendly", services: [], deliveryFeeKzt: null, acceptOrdersOffline: true,
};

export default function OnboardingPage() {
    const router = useRouter();
    const { ready, workspace, authError } = useWorkspaceSession();
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (ready && !workspace?.email && !authError) router.replace("/signup");
    }, [authError, ready, router, workspace?.email]);

    if (authError) return <main className="onboarding-loading"><p role="alert">Не удалось проверить вход в аккаунт. Обновите страницу и попробуйте снова.</p></main>;
    if (!ready || !workspace) return <main className="onboarding-loading"><p>Готовим ваш кабинет…</p></main>;

    if (saved) return (
        <main className="setup-page setup-success">
            <div className="setup-success-mark"><Check size={26} /></div>
            <h1>Магазин настроен</h1><p>Теперь добавьте букеты с фото и ценами, затем подключите Telegram. Клиенты смогут выбрать цветы и оставить заявку.</p>
            <button type="button" className="button button-blue" onClick={() => router.push("/dashboard?view=catalog")}>Добавить букеты <ArrowRight size={15} /></button>
            <Link className="success-secondary" href="/dashboard">Открыть кабинет</Link>
        </main>
    );

    return (
        <main className="setup-page setup-quick-page">
            <header className="setup-header"><Link href="/" className="brand"><span className="brand-mark"><Flower2 size={20} /></span>FloralAI</Link><Link href="/dashboard" className="business-text-button">В кабинет</Link></header>
            <div className="setup-layout">
                <aside className="setup-aside"><div className="setup-aside-mark"><Flower2 size={28} /></div><h2>Меньше текста.<br /><span>Больше цветов.</span></h2><p>Название магазина, подходящий шаблон и несколько вариантов — ваш помощник готов знакомиться с клиентами.</p><div className="quick-setup-checklist"><span><Check size={16} /> Готовое описание магазина</span><span><Check size={16} /> Услуги и доставка кнопками</span><span><Check size={16} /> Любой текст можно изменить</span></div></aside>
                <section className="setup-main"><BusinessProfileEditor profile={workspace.business ?? emptyBusiness} submitLabel="Сохранить и перейти к букетам" onSaved={(profile) => { writeWorkspace({ ...workspace, business: profile, assistantPublished: false }); setSaved(true); }} /></section>
            </div>
        </main>
    );
}
