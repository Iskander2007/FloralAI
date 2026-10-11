import { handleFlowerAssistantRequest } from "@/lib/flower-api";

export const runtime = "nodejs";

export async function POST(request: Request) {
    return handleFlowerAssistantRequest(request);
}
