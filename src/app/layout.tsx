import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { ThemeRegistry } from "@/components/providers/ThemeRegistry";
import { APP_NAME, COMPANY_NAME } from "@/config/app";
import type { Mode } from "@/theme/tokens";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: `${COMPANY_NAME}'s internal system for winning work.`,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const mode: Mode = (await cookies()).get("kcrm_theme")?.value === "light" ? "light" : "dark";
  return (
    <html lang="en" data-theme={mode} className={`${jakarta.variable} ${mono.variable}`}>
      <body>
        <ThemeRegistry initialMode={mode}>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
