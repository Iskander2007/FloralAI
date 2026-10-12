"use client";

import { useState, type FormEvent } from "react";
import { Check, ClipboardList, Save, Store, Truck } from "lucide-react";
import type { BusinessProfile } from "@/lib/business";

type BusinessProfileEditorProps = {
    profile: BusinessProfile;
    onSaved: (profile: BusinessProfile) => void;
};

const categories: { value: BusinessProfile["category"]; label: string }[] = [
    { value: "Beauty & wellness", label: "Красота и уход" },
    { value: "Food & hospitality", label: "Еда и гостеприимство" },
    { value: "Health & clinics", label: "Здоровье и клиники" },
    { value: "Retail & online shop", label: "Магазин и онлайн-продажи" },
    { value: "Auto & home services", label: "Услуги для дома и авто" },
    { value: "Other", label: "Другое" },
];

export function BusinessProfileEditor({ profile, onSaved }: BusinessProfileEditorProps) {
    const [draft, setDraft] = useState(profile);
    const [servicesText, setServicesText] = useState(profile.services.join("\n"));
    const [deliveryFee, setDeliveryFee] = useState(
        profile.deliveryFeeKzt == null ? "" : String(profile.deliveryFeeKzt),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    function update<K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) {
        setDraft((current) => ({ ...current, [key]: value }));
        setNotice("");
    }

    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setNotice("");

        const fee = deliveryFee.trim() ? Number(deliveryFee) : null;
        if (!draft.name.trim()) {
            setError("Укажите название бизнеса.");
            return;
        }
        if (fee !== null && (!Number.isSafeInteger(fee) || fee < 0 || fee > 10_000_000)) {
            setError("Стоимость доставки должна быть целым числом от 0 до 10 000 000 ₸. Оставьте поле пустым, если стоимость нужно уточнять.");
            return;
        }
        const services = servicesText.split("\n").map((service) => service.trim()).filter(Boolean);
        if (services.length > 30 || services.some((service) => service.length > 500)) {
            setError("Добавьте не больше 30 услуг, до 500 символов каждая.");
            return;
        }

        const savedProfile: BusinessProfile = {
            ...draft,
            name: draft.name.trim(),
            description: draft.description.trim(),
            location: draft.location.trim(),
            hours: draft.hours.trim(),
            phone: draft.phone.trim(),
            services,
            deliveryAreas: draft.deliveryAreas?.trim() ?? "",
            deliveryFeeKzt: fee,
            orderPolicy: draft.orderPolicy?.trim() ?? "",
            language: "Russian",
            tone: "Friendly",
            acceptOrdersOffline: true,
        };

        setSaving(true);
        try {
            const response = await fetch("/api/business-profile", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ profile: savedProfile }),
            });
            const result = await response.json() as { profile?: BusinessProfile; error?: string };
            if (!response.ok || !result.profile) {
                throw new Error(result.error || "Не удалось сохранить данные бизнеса.");
            }
            setDraft(result.profile);
            setServicesText(result.profile.services.join("\n"));
            setDeliveryFee(result.profile.deliveryFeeKzt == null ? "" : String(result.profile.deliveryFeeKzt));
            onSaved(result.profile);
            setNotice("Данные сохранены. Ассистент будет использовать их в новых ответах клиентам.");
        } catch (saveError) {
            setError(saveError instanceof Error && !(saveError instanceof TypeError) && !(saveError instanceof SyntaxError)
                ? saveError.message
                : "Не удалось сохранить данные. Проверьте соединение и попробуйте ещё раз.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <form className="business-profile-editor" onSubmit={save} aria-busy={saving}>
            <div className="business-tools-intro">
                <div className="business-tools-intro-icon"><ClipboardList size={22} aria-hidden="true" /></div>
                <div>
                    <h2>Всё, что нужно знать вашему ассистенту</h2>
                    <p>Заполните информацию о магазине и доставке. Бот будет опираться на эти данные, предлагать товары из каталога и собирать заявки клиентов.</p>
                </div>
            </div>

            <fieldset className="business-section" disabled={saving}>
                <legend><Store size={18} aria-hidden="true" /> О бизнесе</legend>
                <div className="business-fields">
                    <label className="business-field">Название бизнеса
                        <input value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={120} autoComplete="organization" />
                    </label>
                    <label className="business-field">Сфера бизнеса
                        <select value={draft.category} onChange={(event) => update("category", event.target.value as BusinessProfile["category"])}>
                            {categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}
                        </select>
                    </label>
                    <label className="business-field business-field-wide">Расскажите о магазине
                        <textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={4} maxLength={8000} placeholder="Какие цветы продаёте, для кого собираете букеты и чем отличаетесь от других магазинов" />
                    </label>
                    <label className="business-field business-field-wide">Услуги и важные детали
                        <textarea value={servicesText} onChange={(event) => { setServicesText(event.target.value); setNotice(""); }} rows={4} maxLength={6000} placeholder={"Сборка букета по пожеланиям клиента\nОткрытка с пожеланием\nФото букета перед отправкой"} />
                        <span className="business-field-hint">Каждая услуга — с новой строки, до 30 услуг. Товары с точными ценами добавляйте в каталог.</span>
                    </label>
                    <label className="business-field">Адрес магазина
                        <input value={draft.location} onChange={(event) => update("location", event.target.value)} maxLength={300} autoComplete="street-address" placeholder="Город, улица, дом" />
                    </label>
                    <label className="business-field">Время работы
                        <input value={draft.hours} onChange={(event) => update("hours", event.target.value)} maxLength={300} placeholder="Ежедневно с 09:00 до 21:00" />
                    </label>
                    <label className="business-field">Телефон магазина
                        <input type="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} maxLength={40} autoComplete="tel" placeholder="+7 …" />
                    </label>
                </div>
                <p className="business-section-description">Ассистент общается на русском: помогает выбрать букет и уточняет детали заявки.</p>
            </fieldset>

            <fieldset className="business-section" disabled={saving}>
                <legend><Truck size={18} aria-hidden="true" /> Доставка</legend>
                <div className="business-fields">
                    <label className="business-field">Куда доставляете
                        <textarea value={draft.deliveryAreas ?? ""} onChange={(event) => update("deliveryAreas", event.target.value)} rows={3} maxLength={1000} placeholder="Город, районы, ограничения по доставке" />
                    </label>
                    <label className="business-field">Фиксированная стоимость, ₸
                        <input type="number" min={0} max={10_000_000} step={1} value={deliveryFee} onChange={(event) => { setDeliveryFee(event.target.value); setNotice(""); }} placeholder="Уточняется у владельца" />
                        <span className="business-field-hint">0 — бесплатная доставка. Пустое поле — бот соберёт заявку, а стоимость вы уточните отдельно.</span>
                    </label>
                </div>
            </fieldset>

            <fieldset className="business-section" disabled={saving}>
                <legend><ClipboardList size={18} aria-hidden="true" /> Правила приёма заявок</legend>
                <p className="business-section-description">Ассистент уточнит пожелания, имя, телефон и адрес доставки. Заявки сохранятся в кабинете, где вы сможете их проверить и подтвердить.</p>
                <div className="business-offline-option">
                    <ClipboardList size={18} aria-hidden="true" />
                    <span><strong>Приём заявок круглосуточно</strong><span>Бот сохранит пожелания и контакты клиента, даже когда вы не на связи. Время доставки и возможность выполнить заявку вы подтвердите позже.</span></span>
                </div>
                <label className="business-field business-policy-field">Что важно учитывать при оформлении
                    <textarea value={draft.orderPolicy ?? ""} onChange={(event) => update("orderPolicy", event.target.value)} rows={4} maxLength={3000} placeholder="Срок подготовки букета, отмена заявки, замена цветов и другие правила вашего магазина" />
                </label>
            </fieldset>

            <div className="business-save-bar">
                <div className="business-save-feedback" aria-live="polite">
                    {error && <p className="business-feedback business-feedback-error" role="alert">{error}</p>}
                    {notice && <p className="business-feedback business-feedback-success"><Check size={16} aria-hidden="true" />{notice}</p>}
                </div>
                <button className="business-primary-button" type="submit" disabled={saving}><Save size={16} aria-hidden="true" />{saving ? "Сохраняем…" : "Сохранить данные"}</button>
            </div>
        </form>
    );
}
