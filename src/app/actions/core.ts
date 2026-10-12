"use server";
import { run } from "@/lib/services/action";
import {
  bulkUpdateAccounts,
  createAccount,
  createContact,
  createTask,
  importAccountsCsv,
  logActivity,
  markRead,
  setTaskStatus,
  toggleReaction,
  updateAccount,
  updateContact,
  type AccountInputT,
  type ActivityInputT,
  type ContactInputT,
  type TaskInputT,
} from "@/lib/services/core";
import { deleteSavedView, saveView } from "@/lib/services/views";

export async function createAccountAction(input: AccountInputT) {
  return run((c) => createAccount(c, input), ["/accounts"]);
}
export async function updateAccountAction(id: string, patch: Partial<AccountInputT>) {
  return run((c) => updateAccount(c, id, patch), ["/accounts", `/accounts/${id}`]);
}
export async function bulkAccountsAction(ids: string[], patch: Parameters<typeof bulkUpdateAccounts>[2]) {
  return run((c) => bulkUpdateAccounts(c, ids, patch), ["/accounts"]);
}
export async function importAccountsAction(csv: string) {
  return run((c) => importAccountsCsv(c, csv), ["/accounts"]);
}
export async function createContactAction(input: ContactInputT) {
  return run((c) => createContact(c, input), ["/contacts", `/accounts/${input.account_id}`]);
}
export async function updateContactAction(id: string, patch: Partial<ContactInputT>) {
  return run((c) => updateContact(c, id, patch), ["/contacts", `/contacts/${id}`]);
}
export async function logActivityAction(input: ActivityInputT) {
  return run((c) => logActivity(c, input), ["/", "/my-work"]);
}
export async function reactAction(activityId: string, emoji: string) {
  return run((c) => toggleReaction(c, activityId, emoji));
}
export async function createTaskAction(input: TaskInputT) {
  return run((c) => createTask(c, input), ["/my-work"]);
}
export async function setTaskStatusAction(id: string, status: "open" | "done") {
  return run((c) => setTaskStatus(c, id, status), ["/my-work"]);
}
export async function markReadAction(ids: string[] | "all") {
  return run((c) => markRead(c, ids), ["/notifications"]);
}
export async function saveViewAction(
  entity: "accounts" | "contacts" | "opportunities" | "consultants",
  name: string,
  query: Record<string, string>,
  shared: boolean,
) {
  return run((c) => saveView(c, entity, name, query, shared), [`/${entity}`]);
}
export async function deleteViewAction(id: string, entity: string) {
  return run((c) => deleteSavedView(c, id), [`/${entity}`]);
}
