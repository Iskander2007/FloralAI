import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { defaultLocale, translate } from "@/lib/i18n";

export const metadata: Metadata = { title: translate(defaultLocale, "Create your FloralAI account") };

export default function SignupPage() {
    return <AuthForm mode="signup" />;
}
