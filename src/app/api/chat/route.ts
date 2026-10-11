import { NextRequest, NextResponse } from "next/server";
import { AssistantContext, ChatTurn, generateAIResponse } from "@/lib/ai";

export const runtime = "nodejs";

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
        !context.services.every((service) => typeof service === "string" && service.length <= 180)
    ) {
        return NextResponse.json({ error: "Business context is invalid." }, { status: 400 });
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
        const reply = await generateAIResponse(message, context as AssistantContext, history);
        return NextResponse.json({ reply, mode: process.env.USE_MOCK_AI === "false" ? "provider" : "mock" });
    } catch {
        return NextResponse.json(
            { error: "We couldn't get a reply just now. Please try again." },
            { status: 503 },
        );
    }
}
