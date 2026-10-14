"use client";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { setUserRoleAction } from "@/app/actions/users";
import { Select } from "@/components/common/fields";
import { useAction } from "@/components/common/useAction";
import { EmptyState, GlassCard, StatusChip, UserAvatar } from "@/components/kit";
import { PENDING_LABEL, ROLE_LABEL } from "@/lib/auth/permissions";
import { ROLES, type Role } from "@/lib/domain/types";
import type { TeamMember } from "@/lib/services/users";

type Choice = Role | "pending";
const OPTIONS: Array<{ value: Choice; label: string }> = [
  { value: "pending", label: `${PENDING_LABEL} (no access)` },
  ...ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })),
];

/** Settings → Team: admins let new people in and change roles. Every change is audited. */
export function TeamCard({ members }: { members: TeamMember[] }) {
  const save = useAction(setUserRoleAction, { success: "Role updated" });
  const pending = members.filter((m) => m.role === null).length;

  return (
    <GlassCard
      id="team"
      title="Team"
      subtitle="New sign-ins from your domain wait here with no access until you assign a role. Changes are audited."
      action={pending > 0 ? <StatusChip tone="warning" label={`${pending} waiting`} /> : undefined}
    >
      {members.length === 0 ? (
        <EmptyState message="No teammates yet. People appear here the first time they sign in." />
      ) : (
        <Stack spacing={3} component="ul" aria-label="Team members" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {members.map((m) => (
            <Box
              component="li"
              key={m.id}
              sx={{
                display: "grid",
                gap: 2,
                alignItems: "center",
                gridTemplateColumns: { xs: "auto 1fr", md: "auto 1fr 140px 240px" },
              }}
            >
              <UserAvatar name={m.full_name} color={m.avatar_color} size={36} />
              <Box sx={{ minWidth: 0 }}>
                <Typography fontWeight={700} noWrap>
                  {m.full_name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="p">
                  {m.email}
                  {m.title ? ` · ${m.title}` : ""}
                </Typography>
              </Box>
              <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}>
                <StatusChip tone={m.role ? "primary" : "warning"} label={m.role ? ROLE_LABEL[m.role] : PENDING_LABEL} />
              </Box>
              <Box sx={{ gridColumn: { xs: "1 / -1", md: "auto" } }}>
                <Select<Choice>
                  label={`Role for ${m.full_name}`}
                  value={m.role ?? "pending"}
                  options={OPTIONS}
                  disabled={m.self || save.pending}
                  helperText={m.self ? "You can't change your own role." : undefined}
                  onChange={(v) => save.exec({ user_id: m.id, role: v === "pending" ? null : v })}
                />
              </Box>
            </Box>
          ))}
        </Stack>
      )}
    </GlassCard>
  );
}
