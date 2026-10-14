import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { redirect } from "next/navigation";
import { APP_NAME } from "@/config/app";
import { GlassCard } from "@/components/kit/GlassCard";
import { Brand } from "@/components/shell/SideNav";
import { currentUser } from "@/lib/auth/session";

export const metadata = { title: "Pending access" };
export const dynamic = "force-dynamic";

/**
 * Where signed-in people without a role wait. Outside the (app) group on purpose: it renders
 * no CRM data, and requireUser() sends every app route, action and API call here for them.
 */
export default async function PendingPage() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.role) redirect("/");
  return (
    <Box component="main" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 4 }}>
      <GlassCard sx={{ width: "100%", maxWidth: 520 }}>
        <Box sx={{ mx: -5, mt: -5 }}>
          <Brand />
        </Box>
        <Typography variant="h3" component="h1">
          Pending access
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 4 }}>
          You&apos;re signed in as <strong>{user.email}</strong>, but an admin hasn&apos;t given you a role in {APP_NAME} yet.
        </Typography>
        <Alert severity="info" sx={{ mb: 4 }}>
          We&apos;ve let the admins know. Once they assign your role, refresh this page to get started.
        </Alert>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          <Button variant="contained" href="/pending">
            Check again
          </Button>
          <Button variant="outlined" color="inherit" href="/auth/signout">
            Sign out
          </Button>
        </Box>
      </GlassCard>
    </Box>
  );
}
