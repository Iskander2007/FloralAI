import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Create your FloralAI account" };

export default function SignupPage() {
    return <AuthForm mode="signup" />;
}
