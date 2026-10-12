"use server";
import { run } from "@/lib/services/action";
import { disconnect, mailStatus, sendFromRecord, syncConnection, type SendEmailInputT } from "@/lib/services/mail";

export async function mailStatusAction() {
  return run((c) => mailStatus(c));
}
export async function syncNowAction(connectionId: string) {
  return run((c) => syncConnection(c, connectionId), ["/connections"]);
}
export async function disconnectMailAction(connectionId: string) {
  return run((c) => disconnect(c, connectionId), ["/connections"]);
}
export async function sendEmailAction(input: SendEmailInputT) {
  const path = { account: "/accounts/", contact: "/contacts/", opportunity: "/opportunities/" }[input.related_type];
  return run((c) => sendFromRecord(c, input), [`${path}${input.related_id}`, "/connections"]);
}
