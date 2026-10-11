import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
    children,
}: {
    children: ReactNode;
}) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
        const { data, error } = await supabase.auth.getUser();
        if (error || !data.user) redirect("/login");
    }
    return children;
}
