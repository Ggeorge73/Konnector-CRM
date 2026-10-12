"use server";
import type { z } from "zod";
import { run } from "@/lib/services/action";
import {
  runComplianceReminders,
  saveRegistration,
  saveVetting,
  updateSettings,
  type RegistrationInputT,
  type SettingsInput,
  type VettingInputT,
} from "@/lib/services/capture";

export async function saveRegistrationAction(input: RegistrationInputT, id?: string) {
  return run((c) => saveRegistration(c, input, id), ["/registrations", "/"]);
}
export async function runRemindersAction() {
  return run((c) => runComplianceReminders(c), ["/registrations", "/vetting", "/notifications"]);
}
export async function saveVettingAction(input: VettingInputT, id?: string) {
  return run((c) => saveVetting(c, input, id), ["/vetting"]);
}
export async function updateSettingsAction(input: z.input<typeof SettingsInput>) {
  return run((c) => updateSettings(c, input), ["/settings", "/"]);
}
