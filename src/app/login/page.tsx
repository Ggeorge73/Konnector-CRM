import { APP_NAME, COMPANY_NAME, env, isDemo } from "@/config/app";
import { SIGN_IN_ERRORS } from "@/lib/auth/access";
import { roleLabel } from "@/lib/auth/permissions";
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
        role: roleLabel(u.role),
        color: u.avatar_color,
      }))
    : [];
  const message =
    error && error in SIGN_IN_ERRORS ? SIGN_IN_ERRORS[error as keyof typeof SIGN_IN_ERRORS](env.allowedEmailDomain) : undefined;
  return <LoginView appName={APP_NAME} company={COMPANY_NAME} domain={env.allowedEmailDomain} demoUsers={demoUsers} error={message} />;
}
