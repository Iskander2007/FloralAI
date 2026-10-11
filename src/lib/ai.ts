export type ChatTurn = { role: "user" | "assistant"; content: string };

export type AssistantContext = {
    businessName: string;
    businessDescription: string;
    services: string[];
    tone?: string;
    language?: string;
};

export async function generateAIResponse(
    message: string,
    context: AssistantContext,
    history: ChatTurn[] = [],
) {
    const useMock = process.env.USE_MOCK_AI !== "false";
    if (useMock) return mockResponse(message, context);

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI provider is not configured");

    const businessDetails = [context.businessDescription, ...context.services].filter(Boolean).join("\n");
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
            temperature: 0.2,
            messages: [
                {
                    role: "system",
                    content: `You are the concise ${context.tone ?? "friendly"} assistant for ${context.businessName}. Reply in ${context.language ?? "English"}. Use only the approved business information below. Never invent prices, stock, schedules, policies, or availability. If the information is missing, say so and offer a human handoff.\n\nApproved business information:\n${businessDetails || "No approved business information supplied."}`,
                },
                ...history.slice(-12),
                { role: "user", content: message },
            ],
        }),
        signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) throw new Error(`AI provider returned ${response.status}`);
    const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
    };
    const content = payload.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("AI provider returned an empty response");
    return content;
}

function mockResponse(message: string, context: AssistantContext) {
    const text = message.toLowerCase();
    const knowledge = context.services.join("; ");
    if (/human|person|agent|человек|оператор|сотрудник/i.test(text)) {
        return "Of course. I can pass your message to a teammate. This demo does not send a real notification.";
    }
    if (/price|cost|how much|стоим|цен/i.test(text)) {
        return knowledge
            ? `Here is what I have for ${context.businessName}: ${knowledge}. Would you like help with anything else?`
            : `I don't have approved pricing information for ${context.businessName} yet, and I don't want to guess. Would you like me to pass this to a teammate?`;
    }
    if (/hour|open|when|schedule|врем|откры/i.test(text)) {
        return context.businessDescription
            ? `I can check the details you shared: ${context.businessDescription.slice(0, 180)}. If you'd like, I can pass your question to the team.`
            : `I don't have the opening hours for ${context.businessName} yet. Would you like me to pass this to a teammate?`;
    }
    if (/book|appointment|reserve|запис/i.test(text)) {
        return "I can help collect your preferred day and time. A teammate will need to confirm the booking in this demo.";
    }
    return `Thanks for reaching out to ${context.businessName}. I can help with services, pricing or appointments. What would you like to know?`;
}
