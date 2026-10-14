import { describe, expect, it } from "vitest";
import { allowedDomains, isAllowedEmail } from "@/lib/auth/access";
import { ForbiddenError, ValidationError } from "@/lib/auth/errors";
import { hasRole, roleLabel } from "@/lib/auth/permissions";
import { createApiKey, authenticateApiKey } from "@/lib/services/api-keys";
import { usersById } from "@/lib/services/core";
import { activeUsers, admitSignIn, setUserRole, teamMembers } from "@/lib/services/users";
import { asUser, NOW, switchUser } from "./helpers";

const DOMAIN = "konnectorllc.com";

describe("allowed email domain", () => {
  it("accepts only exact matches of ALLOWED_EMAIL_DOMAIN", () => {
    expect(isAllowedEmail("ada@konnectorllc.com", DOMAIN)).toBe(true);
    expect(isAllowedEmail("  Ada@KonnectorLLC.com ", DOMAIN)).toBe(true);
    for (const bad of [
      "ada@gmail.com",
      "ada@evilkonnectorllc.com",
      "ada@mail.konnectorllc.com",
      "ada@konnectorllc.com.evil.io",
      "ada@konnectorllc.com@gmail.com",
      "@konnectorllc.com",
      "konnectorllc.com",
      "",
      null,
      undefined,
    ]) {
      expect(isAllowedEmail(bad, DOMAIN), String(bad)).toBe(false);
    }
  });

  it("supports a comma-separated list of domains", () => {
    expect(allowedDomains(" konnectorllc.com, @Konnector.io ")).toEqual(["konnectorllc.com", "konnector.io"]);
    expect(isAllowedEmail("a@konnector.io", "konnectorllc.com,konnector.io")).toBe(true);
    expect(isAllowedEmail("a@gmail.com", "konnectorllc.com,konnector.io")).toBe(false);
  });
});

describe("sign-in admission", () => {
  it("rejects other domains and unverified emails without creating a user", async () => {
    const c = await asUser("admin");
    const before = (await c.store.list("users")).length;
    expect(await admitSignIn(c.store, { id: "x1", email: "eve@gmail.com", emailVerified: true }, NOW, DOMAIN)).toEqual({
      ok: false,
      reason: "domain",
    });
    expect(await admitSignIn(c.store, { id: "x2", email: "eve@konnectorllc.com", emailVerified: false }, NOW, DOMAIN)).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect((await c.store.list("users")).length).toBe(before);
  });

  it("creates new people with no role, audits it and tells the admins", async () => {
    const c = await asUser("admin");
    const r = await admitSignIn(c.store, { id: "new-1", email: "New.Starter@konnectorllc.com", emailVerified: true }, NOW, DOMAIN);
    expect(r.ok && r.created).toBe(true);
    if (!r.ok) return;
    expect(r.user).toMatchObject({ id: "new-1", email: "new.starter@konnectorllc.com", full_name: "New Starter", role: null });
    expect(hasRole(r.user)).toBe(false);
    expect(roleLabel(r.user.role)).toBe("Pending access");
    const log = await c.store.list("audit_log", { where: { entity_id: "new-1" } });
    expect(log.map((l) => l.action)).toEqual(["user.pending_created"]);
    expect(log[0].actor_id).toBeNull();
    const notes = await c.store.list("notifications", { where: { user_id: c.user.id } });
    expect(notes.some((n) => n.title.includes("New Starter") && n.href === "/settings#team")).toBe(true);

    // Signing in again finds the same row; it never self-upgrades.
    const again = await admitSignIn(c.store, { id: "other", email: "new.starter@konnectorllc.com", emailVerified: true }, NOW, DOMAIN);
    expect(again).toMatchObject({ ok: true, created: false, user: { id: "new-1", role: null } });
  });

  it("lets existing people straight in and refuses deactivated ones", async () => {
    const c = await asUser("admin");
    const r = await admitSignIn(c.store, { id: "ignored", email: "marcus@konnectorllc.com", emailVerified: true }, NOW, DOMAIN);
    expect(r).toMatchObject({ ok: true, created: false, user: { role: "bd" } });
    if (r.ok) await c.store.update("users", r.user.id, { archived_at: NOW.toISOString() });
    expect(await admitSignIn(c.store, { id: "ignored", email: "marcus@konnectorllc.com", emailVerified: true }, NOW, DOMAIN)).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("keeps pending people out of pickers, mentions and the API", async () => {
    const c = await asUser("admin");
    const r = await admitSignIn(c.store, { id: "new-2", email: "pat@konnectorllc.com", emailVerified: true }, NOW, DOMAIN);
    expect(r.ok).toBe(true);
    expect((await activeUsers(c.store)).some((u) => u.id === "new-2")).toBe(false);
    expect((await usersById(c)).has("new-2")).toBe(false);

    // A key whose owner is put back to pending stops working.
    const bd = await switchUser(c, "bd1");
    const { key } = await createApiKey(bd, { name: "laptop", scopes: ["read"] });
    expect((await authenticateApiKey(c.store, `Bearer ${key}`, NOW)).ok).toBe(true);
    await setUserRole(c, { user_id: bd.user.id, role: null });
    expect(await authenticateApiKey(c.store, `Bearer ${key}`, NOW)).toMatchObject({ ok: false });
  });
});

describe("role assignment", () => {
  it("lets an admin assign, change and revoke roles, auditing every change", async () => {
    const c = await asUser("admin");
    const r = await admitSignIn(c.store, { id: "new-3", email: "sam@konnectorllc.com", emailVerified: true }, NOW, DOMAIN);
    expect(r.ok).toBe(true);
    const team = await teamMembers(c);
    expect(team[0]).toMatchObject({ id: "new-3", role: null }); // pending people first
    expect(team.find((m) => m.id === c.user.id)?.self).toBe(true);

    expect((await setUserRole(c, { user_id: "new-3", role: "recruiter" })).role).toBe("recruiter");
    expect((await setUserRole(c, { user_id: "new-3", role: "bd" })).role).toBe("bd");
    expect((await setUserRole(c, { user_id: "new-3", role: null })).role).toBeNull();
    await setUserRole(c, { user_id: "new-3", role: null }); // no-op, not audited again

    const log = await c.store.list("audit_log", { where: { entity_id: "new-3" }, orderBy: { column: "created_at" } });
    const changes = log.filter((l) => l.action !== "user.pending_created");
    expect(changes.map((l) => [l.action, l.before, l.after, l.actor_id])).toEqual([
      ["user.role_changed", { role: null }, { role: "recruiter" }, c.user.id],
      ["user.role_changed", { role: "recruiter" }, { role: "bd" }, c.user.id],
      ["user.access_revoked", { role: "bd" }, { role: null }, c.user.id],
    ]);
    const notes = await c.store.list("notifications", { where: { user_id: "new-3" } });
    expect(notes.map((n) => n.title)).toEqual(
      expect.arrayContaining(["You have access to the CRM as Recruiter", "Your role is now Business development"]),
    );
  });

  it("is admin only, validates input and never lets an admin change their own role", async () => {
    const c = await asUser("admin");
    const exec = await switchUser(c, "exec");
    await expect(setUserRole(exec, { user_id: c.user.id, role: "bd" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teamMembers(exec)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setUserRole(c, { user_id: c.user.id, role: "bd" })).rejects.toBeInstanceOf(ValidationError);
    await expect(setUserRole(c, { user_id: exec.user.id, role: "owner" as never })).rejects.toThrow(/Pick a role/);
    await expect(setUserRole(c, { user_id: "nobody", role: "bd" })).rejects.toBeInstanceOf(ValidationError);
    expect((await c.store.get("users", c.user.id))?.role).toBe("admin");
  });
});
