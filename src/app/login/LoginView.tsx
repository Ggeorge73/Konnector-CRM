"use client";
import Google from "@mui/icons-material/Google";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useState } from "react";
import { GlassCard } from "@/components/kit/GlassCard";
import { UserAvatar } from "@/components/kit/UserAvatar";
import { Brand } from "@/components/shell/SideNav";
import { supabaseBrowser } from "@/lib/supabase/client";

interface DemoUser {
  id: string;
  name: string;
  title: string;
  role: string;
  color: string;
}

export function LoginView({
  appName,
  company,
  domain,
  demoUsers,
  error,
}: {
  appName: string;
  company: string;
  domain: string;
  demoUsers: DemoUser[];
  error?: string;
}) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(error === "domain" ? `Only @${domain} accounts can sign in.` : null);
  const demo = demoUsers.length > 0;

  const magic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.toLowerCase().endsWith(`@${domain}`)) return setErr(`Use your @${domain} email.`);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setErr(error.message);
    else setSent(true);
  };
  const google = () =>
    supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback`, queryParams: { hd: domain } },
    });

  return (
    <Box component="main" sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 4 }}>
      <GlassCard sx={{ width: "100%", maxWidth: 460 }}>
        <Box sx={{ mx: -5, mt: -5 }}>
          <Brand />
        </Box>
        <Typography variant="h3" component="h1">
          Sign in
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1, mb: 5 }}>
          {appName} is {company}&apos;s internal system for winning work. Clients use Konnect Hub.
        </Typography>
        {err && (
          <Alert severity="error" sx={{ mb: 4 }}>
            {err}
          </Alert>
        )}
        {demo ? (
          <>
            <Alert severity="info" sx={{ mb: 4 }}>
              Demo mode — seeded data. Pick a teammate to see the app as their role.
            </Alert>
            <Stack spacing={2}>
              {demoUsers.map((u) => (
                <form key={u.id} action="/auth/demo" method="post">
                  <input type="hidden" name="user_id" value={u.id} />
                  <Button
                    type="submit"
                    fullWidth
                    variant="outlined"
                    color="inherit"
                    sx={{ justifyContent: "flex-start", gap: 3, py: 2, borderColor: "divider" }}
                  >
                    <UserAvatar name={u.name} color={u.color} size={32} />
                    <Box sx={{ textAlign: "left" }}>
                      <Typography fontWeight={700}>{u.name}</Typography>
                      <Typography variant="caption">
                        {u.role} · {u.title}
                      </Typography>
                    </Box>
                  </Button>
                </form>
              ))}
            </Stack>
          </>
        ) : sent ? (
          <Alert severity="success">Check {email} for your sign-in link.</Alert>
        ) : (
          <Stack spacing={4}>
            <Button variant="contained" size="large" startIcon={<Google />} onClick={google}>
              Continue with Google
            </Button>
            <Divider>or</Divider>
            <Stack component="form" spacing={3} onSubmit={magic}>
              <TextField
                label="Work email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={`you@${domain}`}
                required
                autoComplete="email"
              />
              <Button type="submit" variant="outlined">
                Email me a magic link
              </Button>
            </Stack>
          </Stack>
        )}
      </GlassCard>
    </Box>
  );
}
