import { APP_NAME, COMPANY_NAME, env, isDemo } from "@/config/app";
import { ROLE_LABEL } from "@/lib/auth/permissions";
import { demoStore } from "@/lib/server/store";
import { LoginView } from "./LoginView";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const demoUsers = isDemo()
    ? (await demoStore().list("users")).map((u) => ({
        id: u.id,
        name: u.full_name,
        title: u.title,
        role: ROLE_LABEL[u.role],
        color: u.avatar_color,
      }))
    : [];
  return <LoginView appName={APP_NAME} company={COMPANY_NAME} domain={env.allowedEmailDomain} demoUsers={demoUsers} error={error} />;
}
