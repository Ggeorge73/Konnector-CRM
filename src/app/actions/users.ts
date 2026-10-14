"use server";
import { run } from "@/lib/services/action";
import { setUserRole, type RoleInputT } from "@/lib/services/users";

export async function setUserRoleAction(input: RoleInputT) {
  return run(
    async (c) => {
      const u = await setUserRole(c, input);
      return { id: u.id, role: u.role };
    },
    ["/settings", "/audit"],
  );
}
