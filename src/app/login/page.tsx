import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Log in to FloralAI" };

export default async function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ error?: string }>;
}) {
    const params = await searchParams;
    const callbackError =
        params.error === "auth_not_configured" ||
        params.error === "auth_callback_failed"
            ? params.error
            : undefined;
    return <AuthForm mode="login" callbackError={callbackError} />;
}
