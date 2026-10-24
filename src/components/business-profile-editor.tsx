"use client";

import { useState, type FormEvent } from "react";
import { Check, ClipboardList, Save, Store, Truck } from "lucide-react";
import type { BusinessProfile } from "@/lib/business";
import { applyBusinessTemplate, businessTemplates, deliveryAreaOptions, hoursOptions, policyOptions, serviceOptions, toggleBusinessOption } from "@/lib/business-presets";

type BusinessProfileEditorProps = {
    profile: BusinessProfile;
    onSaved: (profile: BusinessProfile) => void;
    submitLabel?: string;
};

const categories: { value: BusinessProfile["category"]; label: string }[] = [
    { value: "Beauty & wellness", label: "Красота и уход" },
    { value: "Food & hospitality", label: "Еда и гостеприимство" },
    { value: "Health & clinics", label: "Здоровье и клиники" },
    { value: "Retail & online shop", label: "Магазин и онлайн-продажи" },
    { value: "Auto & home services", label: "Услуги для дома и авто" },
    { value: "Other", label: "Другое" },
];

function Options({ label, values, selected, onSelect }: { label: string; values: readonly string[]; selected: string[]; onSelect: (value: string) => void }) {
    return <div className="business-options" role="group" aria-label={label}>{values.map((value) => <button className="business-option" key={value} type="button" aria-pressed={selected.includes(value)} onClick={() => onSelect(value)}>{selected.includes(value) && <Check size={13} aria-hidden="true" />}{value}</button>)}</div>;
}

export function BusinessProfileEditor({ profile, onSaved, submitLabel = "Сохранить данные" }: BusinessProfileEditorProps) {
    const [draft, setDraft] = useState(profile);
    const [servicesText, setServicesText] = useState(profile.services.join("\n"));
    const [deliveryFee, setDeliveryFee] = useState(
        profile.deliveryFeeKzt == null ? "" : String(profile.deliveryFeeKzt),
    );
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [templateId, setTemplateId] = useState("");
    const [manualDescription, setManualDescription] = useState(false);
    const services = servicesText.split("\n").map((value) => value.trim()).filter(Boolean);
    const policies = (draft.orderPolicy ?? "").split("\n").map((value) => value.trim()).filter(Boolean);

    function chooseTemplate(id: string) {
        setTemplateId(id);
        setNotice("");
        if (id === "custom") { setManualDescription(true); return; }
        const next = applyBusinessTemplate(draft, id);
        setDraft(next);
        setServicesText(next.services.join("\n"));
        setManualDescription(false);
    }

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
                <div><h2>Ваш бизнес — за несколько нажатий</h2><p>Выберите подходящие варианты. Обязательно только название, остальные детали можно добавить позже.</p></div>
            </div>
            <fieldset className="business-section" disabled={saving}>
                <legend><Store size={18} aria-hidden="true" /> 1. О магазине</legend>
                <label className="business-field">Название бизнеса
                    <input value={draft.name} onChange={(event) => update("name", event.target.value)} required maxLength={120} autoComplete="organization" placeholder="Как называется ваш магазин?" />
                </label>
                <div className="business-quick-group">
                    <h3>Выберите основу описания</h3><p className="business-field-hint">Шаблон заполнит описание и услуги. Контакты и доставка сохранятся. Проверьте, что выбранные услуги подходят вашему магазину.</p>
                    <div className="business-template-grid" role="group" aria-label="Шаблон бизнеса">
                        {businessTemplates.map((template) => <button type="button" className="business-template" key={template.id} aria-pressed={templateId === template.id} onClick={() => chooseTemplate(template.id)}><span aria-hidden="true">{template.icon}</span><strong>{template.title}</strong><small>{template.detail}</small>{templateId === template.id && <Check size={16} aria-hidden="true" />}</button>)}
                        <button type="button" className="business-template" aria-pressed={templateId === "custom"} onClick={() => chooseTemplate("custom")}><span aria-hidden="true">✏️</span><strong>Напишу сам</strong><small>Свой текст и любая сфера бизнеса</small>{templateId === "custom" && <Check size={16} aria-hidden="true" />}</button>
                    </div>
                </div>
                {draft.description && !manualDescription && <div className="business-description-preview"><p>{draft.description}</p><button type="button" className="business-text-button" onClick={() => setManualDescription(true)}>Изменить текст</button></div>}
                {(manualDescription || !draft.description) && <label className="business-field business-quick-group">Описание магазина · можно пропустить
                    <textarea value={draft.description} onChange={(event) => update("description", event.target.value)} rows={3} maxLength={8000} placeholder="Выберите шаблон выше или расскажите о магазине своими словами" />
                </label>}
                <div className="business-quick-group"><h3>Что вы предлагаете?</h3><p className="business-field-hint">Можно выбрать несколько услуг и убрать лишние.</p>
                    <Options label="Услуги магазина" values={serviceOptions} selected={services} onSelect={(value) => { setServicesText(toggleBusinessOption(services, value).join("\n")); setNotice(""); }} />
                    <details className="business-custom-details"><summary>Добавить свои услуги или изменить список{services.some((value) => !serviceOptions.includes(value)) ? " · есть свои услуги" : ""}</summary><label className="business-field">Каждая услуга — с новой строки<textarea value={servicesText} onChange={(event) => { setServicesText(event.target.value); setNotice(""); }} rows={3} maxLength={15000} /></label></details>
                </div>
                <details className="business-custom-details"><summary>Выбрать другую сферу бизнеса</summary><label className="business-field">Сфера бизнеса<select value={draft.category} onChange={(event) => update("category", event.target.value as BusinessProfile["category"])}>{categories.map((category) => <option key={category.value} value={category.value}>{category.label}</option>)}</select></label></details>
            </fieldset>
            <fieldset className="business-section" disabled={saving}>
                <legend><Store size={18} aria-hidden="true" /> 2. График и контакты</legend>
                <div className="business-quick-group"><h3>Когда вы работаете?</h3><Options label="График работы" values={hoursOptions} selected={[draft.hours]} onSelect={(value) => update("hours", draft.hours === value ? "" : value)} />
                    <label className="business-field">Или укажите свой график<input value={draft.hours} onChange={(event) => update("hours", event.target.value)} maxLength={300} placeholder="Можно добавить позже" /></label>
                </div>
                <div className="business-fields business-quick-group">
                    <label className="business-field">Адрес магазина · необязательно<input value={draft.location} onChange={(event) => update("location", event.target.value)} maxLength={300} autoComplete="street-address" placeholder="Город, улица, дом" /></label>
                    <label className="business-field">Телефон магазина · необязательно<input type="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} maxLength={40} autoComplete="tel" placeholder="+7 …" /></label>
                </div>
            </fieldset>
            <fieldset className="business-section" disabled={saving}>
                <legend><Truck size={18} aria-hidden="true" /> 3. Доставка и условия</legend>
                <div className="business-quick-group"><h3>Куда доставляете?</h3><Options label="Зона доставки" values={deliveryAreaOptions} selected={[draft.deliveryAreas ?? ""]} onSelect={(value) => update("deliveryAreas", draft.deliveryAreas === value ? "" : value)} />
                    <label className="business-field">Или укажите свои районы<input value={draft.deliveryAreas ?? ""} onChange={(event) => update("deliveryAreas", event.target.value)} maxLength={1000} placeholder="Например, город и районы доставки" /></label>
                </div>
                <div className="business-quick-group"><h3>Сколько стоит доставка?</h3><Options label="Стоимость доставки" values={["Уточним после заявки", "Бесплатно", "1 000 ₸", "1 500 ₸", "2 000 ₸"]} selected={[deliveryFee === "" ? "Уточним после заявки" : deliveryFee === "0" ? "Бесплатно" : ({ "1000": "1 000 ₸", "1500": "1 500 ₸", "2000": "2 000 ₸" }[deliveryFee] ?? "")]} onSelect={(value) => { setDeliveryFee(value === "Уточним после заявки" ? "" : value === "Бесплатно" ? "0" : value.replace(/[^0-9]/g, "")); setNotice(""); }} />
                    <label className="business-field business-fee-field">Своя стоимость, ₸<input type="number" min={0} max={10_000_000} step={1} value={deliveryFee} onChange={(event) => { setDeliveryFee(event.target.value); setNotice(""); }} placeholder="Уточняется" /><span className="business-field-hint">Пустое поле — стоимость уточнит магазин.</span></label>
                </div>
                <div className="business-quick-group"><h3>Что учесть при оформлении?</h3><Options label="Условия магазина" values={policyOptions} selected={policies} onSelect={(value) => update("orderPolicy", toggleBusinessOption(policies, value).join("\n"))} />
                    <details className="business-custom-details"><summary>Написать свои условия{policies.some((value) => !policyOptions.includes(value)) ? " · есть свой текст" : ""}</summary><label className="business-field">Правила вашего магазина<textarea value={draft.orderPolicy ?? ""} onChange={(event) => update("orderPolicy", event.target.value)} rows={3} maxLength={3000} placeholder="Срок подготовки, замены цветов и другие пожелания" /></label></details>
                </div>
            </fieldset>
            <fieldset className="business-section" disabled={saving}>
                <legend><ClipboardList size={18} aria-hidden="true" /> 4. Персональный помощник</legend>
                <div className="business-fields">
                    <label className="business-field">Язык ответов<select value={draft.language} onChange={(event) => update("language", event.target.value as BusinessProfile["language"])}><option value="Russian">Русский</option><option value="Kazakh">Қазақша</option><option value="English">English</option></select></label>
                    <label className="business-field">Стиль общения<select value={draft.tone} onChange={(event) => update("tone", event.target.value as BusinessProfile["tone"])}><option value="Friendly">Дружелюбный</option><option value="Professional">Деловой</option><option value="Premium">Сдержанный, премиальный</option><option value="Casual">Неформальный</option></select></label>
                </div>
                <p className="business-field-hint">Язык и стиль применяются к AI-консультациям. Оформление заявки и встроенные советы пока на русском.</p>
                <label className="business-field">Приветствие вашего бота<input value={draft.assistantGreeting ?? ""} onChange={(event) => update("assistantGreeting", event.target.value)} maxLength={500} placeholder="Добро пожаловать в наш цветочный магазин!" /></label>
                <label className="business-field">База знаний магазина<textarea value={draft.assistantKnowledge ?? ""} onChange={(event) => update("assistantKnowledge", event.target.value)} maxLength={6000} rows={7} placeholder={"Вопрос: Можно ли заменить цветы в букете?\nОтвет: Состав согласовываем с клиентом до сборки.\n\nВопрос: Есть ли открытка?\nОтвет: Укажите реальные условия вашего магазина."} /><span className="business-field-hint">Добавьте реальные условия про упаковку, открытки, самовывоз, замены и претензии. Для ответов без AI используйте пары «Вопрос:» и «Ответ:». Не добавляйте пароли и внутренние сведения — эту информацию бот сообщает клиентам.</span></label>
                <label className="business-field"><span><input type="checkbox" checked={draft.allowFlowerAdvice !== false} onChange={(event) => update("allowFlowerAdvice", event.target.checked)} /> Советы флориста по уходу, выбору и оформлению цветов</span><span className="business-field-hint">Общие рекомендации. Наличие цветов, сроки и особые условия всегда подтверждает магазин.</span></label>
            </fieldset>
            <div className="business-save-bar">
                <div className="business-save-feedback" aria-live="polite">{error && <p className="business-feedback business-feedback-error" role="alert">{error}</p>}{notice && <p className="business-feedback business-feedback-success"><Check size={16} aria-hidden="true" />{notice}</p>}</div>
                <button className="business-primary-button" type="submit" disabled={saving}><Save size={16} aria-hidden="true" />{saving ? "Сохраняем…" : submitLabel}</button>
            </div>
        </form>
    );
}
