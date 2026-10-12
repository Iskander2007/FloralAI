import { NextRequest, NextResponse } from "next/server";
import { generateAIResponse } from "@/lib/ai";
import type { AssistantContext, ChatTurn } from "@/lib/ai";
import type { AssistantProduct } from "@/lib/catalog";

export const runtime = "nodejs";

function isAssistantProduct(value: unknown): value is AssistantProduct {
    if (!value || typeof value !== "object") return false;
    const product = value as Record<string, unknown>;
    return (
        typeof product.name === "string" &&
        product.name.trim().length > 0 &&
        product.name.length <= 120 &&
        typeof product.price_kzt === "number" &&
        Number.isSafeInteger(product.price_kzt) &&
        product.price_kzt >= 0 &&
        typeof product.description === "string" &&
        product.description.length <= 1000
    );
}

export async function POST(request: NextRequest) {
    let payload: unknown;
    try {
        payload = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    if (!payload || typeof payload !== "object") {
        return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }
    const body = payload as Record<string, unknown>;
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const rawContext = body.context;
    if (!message || message.length > 1200) {
        return NextResponse.json(
            { error: "Message must be between 1 and 1,200 characters." },
            { status: 400 },
        );
    }
    if (!rawContext || typeof rawContext !== "object") {
        return NextResponse.json({ error: "Business context is required." }, { status: 400 });
    }

    const context = rawContext as Record<string, unknown>;
    if (
        typeof context.businessName !== "string" ||
        context.businessName.length > 120 ||
        typeof context.businessDescription !== "string" ||
        context.businessDescription.length > 4000 ||
        !Array.isArray(context.services) ||
        context.services.length > 30 ||
        !context.services.every(
            (service) => typeof service === "string" && service.length <= 180,
        ) ||
        (context.tone !== undefined &&
            (typeof context.tone !== "string" || context.tone.length > 50)) ||
        (context.language !== undefined &&
            (typeof context.language !== "string" || context.language.length > 50))
    ) {
        return NextResponse.json({ error: "Business context is invalid." }, { status: 400 });
    }

    const rawProducts = context.products;
    let products: AssistantProduct[] = [];
    if (rawProducts !== undefined) {
        if (
            !Array.isArray(rawProducts) ||
            rawProducts.length > 30 ||
            !rawProducts.every(isAssistantProduct)
        ) {
            return NextResponse.json(
                { error: "Product catalog is invalid." },
                { status: 400 },
            );
        }
        products = rawProducts.filter(isAssistantProduct);
    }

    const history = Array.isArray(body.history)
        ? body.history
            .filter(
                (turn): turn is ChatTurn =>
                    !!turn &&
                    typeof turn === "object" &&
                    "role" in turn &&
                    (turn.role === "user" || turn.role === "assistant") &&
                    "content" in turn &&
                    typeof turn.content === "string" &&
                    turn.content.length <= 1200,
            )
            .slice(-12)
        : [];

    try {
        const assistantContext: AssistantContext = {
            businessName: context.businessName,
            businessDescription: context.businessDescription,
            services: context.services,
            products,
            ...(typeof context.tone === "string" ? { tone: context.tone } : {}),
            ...(typeof context.language === "string" ? { language: context.language } : {}),
        };
        const reply = await generateAIResponse(
            message,
            assistantContext,
            history,
        );
        return NextResponse.json({ reply, mode: process.env.USE_MOCK_AI === "false" ? "provider" : "mock" });
    } catch {
        return NextResponse.json(
            { error: "We couldn't get a reply just now. Please try again." },
            { status: 503 },
        );
    }
}
