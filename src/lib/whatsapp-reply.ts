import type { BusinessProfile } from "@/lib/business";
import { generateAIResponse, type ChatTurn } from "@/lib/ai";
import type { SalesProduct } from "@/lib/sales-assistant";

export async function answerWhatsAppMessage(message: string, profile: BusinessProfile, products: SalesProduct[], history: ChatTurn[]) {
    const locale = profile.language === "English" ? "en" : profile.language === "Kazakh" ? "kk" : "ru";
    const say = (ru: string, en: string, kk: string) => ({ ru, en, kk })[locale];
    if (/оператор|сотрудник|человек|менеджер|human|agent|operator|қызметкер/i.test(message)) return {
        handoff: true, reply: say("Передал ваш вопрос сотруднику. Бот приостановлен в этом диалоге; сотрудник сможет ответить вам лично.",
            "Your conversation has been handed to the team. The bot is paused so a person can help you.",
            "Сұрағыңыз қызметкерге берілді. Қызметкер жауап беруі үшін бот осы диалогта тоқтатылды."),
    };
    if (message === "[Сообщение без текста]") return { handoff: false, reply: say(
        "Пока я понимаю текстовые сообщения. Напишите ваш вопрос или слово «оператор», чтобы связаться с сотрудником.",
        "I can read text messages. Please type your question, or say ‘agent’ to speak to the team.",
        "Әзірге мәтіндік хабарларды түсінемін. Сұрағыңызды жазыңыз немесе қызметкерді шақырыңыз.") };
    if (process.env.USE_MOCK_AI === "false" && process.env.OPENAI_API_KEY) {
        const reply = await generateAIResponse(message, {
            businessName: profile.name, tone: profile.tone, language: profile.language,
            businessDescription: [profile.description, `Address: ${profile.location || "not provided"}`,
                `Opening hours: ${profile.hours || "not provided"}`, `Phone: ${profile.phone || "not provided"}`,
                `Delivery areas: ${profile.deliveryAreas || "not provided"}`, `Order policy: ${profile.orderPolicy || "not provided"}`,
                "You answer questions only. Do not claim that an appointment, order, payment or staff notification has been created. Ask the customer to say ‘оператор’ / ‘agent’ for a human."].join("\n"),
            services: profile.services, products,
        }, history);
        return { reply: reply.slice(0, 4000), handoff: false };
    }
    // A working FAQ mode when no model is configured; no demo booking or invented information.
    let reply: string;
    if (/час|график|откры|закры|работа[ею]|hours|open|сағат/i.test(message)) reply = profile.hours || say(
        "График пока не указан. Напишите «оператор», и сотрудник уточнит время работы.",
        "Opening hours haven't been provided. Type ‘agent’ to ask the team.", "Жұмыс уақыты көрсетілмеген. Қызметкерден сұраңыз.");
    else if (/адрес|где|находит|address|location|мекенжай/i.test(message)) reply = profile.location || say(
        "Адрес пока не указан. Напишите «оператор», чтобы уточнить его.", "The address hasn't been provided. Type ‘agent’ to ask the team.", "Мекенжай көрсетілмеген. Қызметкерден сұраңыз.");
    else if (/достав|delivery|жеткіз/i.test(message)) reply = [profile.deliveryAreas,
        typeof profile.deliveryFeeKzt === "number" ? `${profile.deliveryFeeKzt.toLocaleString("ru-RU")} ₸` : "", profile.orderPolicy].filter(Boolean).join("\n")
        || say("Условия доставки пока не указаны. Напишите «оператор», чтобы уточнить их.", "Delivery details haven't been provided. Type ‘agent’ to ask the team.", "Жеткізу шарттары көрсетілмеген. Қызметкерден сұраңыз.");
    else if (/телефон|контакт|phone|contact|байланыс/i.test(message)) reply = profile.phone || say(
        "Контакт пока не указан. Напишите «оператор», чтобы связаться с сотрудником.", "No contact number has been provided. Type ‘agent’ to speak to the team.", "Байланыс нөмірі көрсетілмеген. Қызметкерге жазыңыз.");
    else if (/цен|стоим|стоит|сколько|каталог|товар|букет|услуг|price|cost|catalog|service|баға|қызмет/i.test(message)) reply = products.length
        ? products.slice(0, 12).map((p) => `${p.name} — ${p.price_kzt.toLocaleString("ru-RU")} ₸${p.description ? `: ${p.description.slice(0, 100)}` : ""}`).join("\n")
        : profile.services.join("\n") || say("Цены пока не добавлены. Напишите «оператор», и сотрудник подскажет.", "No prices have been added. Type ‘agent’ to ask the team.", "Бағалар қосылмаған. Қызметкерден сұраңыз.");
    else reply = say(`Здравствуйте! Я помощник «${profile.name}». ${profile.description.slice(0, 500)}\nПомогу с услугами, каталогом, адресом и временем работы. Для связи с сотрудником напишите «оператор».`,
        `Hello! I'm the assistant for ${profile.name}. ${profile.description.slice(0, 500)}\nAsk about our services, catalog, address or opening hours. Type ‘agent’ to speak to the team.`,
        `Сәлеметсіз бе! Мен «${profile.name}» көмекшісімін. ${profile.description.slice(0, 500)}\nҚызметтер, каталог, мекенжай және жұмыс уақыты туралы сұраңыз. Қызметкерге де жүгіне аласыз.`);
    return { reply: reply.slice(0, 4000), handoff: false };
}
