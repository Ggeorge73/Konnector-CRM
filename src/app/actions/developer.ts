"use server";
import { run } from "@/lib/services/action";
import { createApiKey, revokeApiKey, type ApiKeyInputT } from "@/lib/services/api-keys";
import {
  createSubscription,
  deleteSubscription,
  retryDelivery,
  sendTestEvent,
  updateSubscription,
  type SubscriptionInputT,
} from "@/lib/services/webhooks";

export async function createApiKeyAction(input: ApiKeyInputT) {
  return run((c) => createApiKey(c, input), ["/developer"]);
}
export async function revokeApiKeyAction(id: string) {
  return run((c) => revokeApiKey(c, id), ["/developer"]);
}
export async function createWebhookAction(input: SubscriptionInputT) {
  return run((c) => createSubscription(c, input), ["/developer"]);
}
export async function setWebhookActiveAction(id: string, active: boolean) {
  return run((c) => updateSubscription(c, id, { active }), ["/developer"]);
}
export async function deleteWebhookAction(id: string) {
  return run((c) => deleteSubscription(c, id), ["/developer"]);
}
export async function sendTestEventAction(id: string) {
  return run((c) => sendTestEvent(c, id), ["/developer"]);
}
export async function retryDeliveryAction(id: string) {
  return run((c) => retryDelivery(c, id), ["/developer"]);
}
