import { db } from "./index.js";

/** Per-store, merchant-editable settings. */
export interface StoreSettings {
  greeting: string;
  title: string;
  color: string;
  /** Extra persona/behaviour instructions appended to the system prompt. */
  systemExtra: string;
  /** Per-store human-handoff targets (fall back to global env if blank). */
  escalationEmail: string;
  slackWebhook: string;
}

export const DEFAULT_SETTINGS: StoreSettings = {
  greeting: "Hi! 👋 How can I help you today?",
  title: "Chat with us",
  color: "#2d6cdf",
  systemExtra: "",
  escalationEmail: "",
  slackWebhook: "",
};

interface SettingsRow {
  greeting: string | null;
  title: string | null;
  color: string | null;
  system_extra: string | null;
  escalation_email: string | null;
  slack_webhook: string | null;
}

/** Current settings for a store, filled with defaults for any missing field. */
export function getSettings(storeHash: string): StoreSettings {
  const row = db
    .prepare("SELECT * FROM store_settings WHERE store_hash = ?")
    .get(storeHash) as SettingsRow | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    greeting: row.greeting ?? DEFAULT_SETTINGS.greeting,
    title: row.title ?? DEFAULT_SETTINGS.title,
    color: row.color ?? DEFAULT_SETTINGS.color,
    systemExtra: row.system_extra ?? DEFAULT_SETTINGS.systemExtra,
    escalationEmail: row.escalation_email ?? DEFAULT_SETTINGS.escalationEmail,
    slackWebhook: row.slack_webhook ?? DEFAULT_SETTINGS.slackWebhook,
  };
}

/** Merge a partial update into a store's settings. */
export function saveSettings(storeHash: string, patch: Partial<StoreSettings>): StoreSettings {
  const next = { ...getSettings(storeHash), ...patch };
  db.prepare(
    `INSERT INTO store_settings
       (store_hash, greeting, title, color, system_extra, escalation_email, slack_webhook)
     VALUES (@store_hash, @greeting, @title, @color, @system_extra, @escalation_email, @slack_webhook)
     ON CONFLICT(store_hash) DO UPDATE SET
       greeting=excluded.greeting, title=excluded.title, color=excluded.color,
       system_extra=excluded.system_extra, escalation_email=excluded.escalation_email,
       slack_webhook=excluded.slack_webhook`,
  ).run({
    store_hash: storeHash,
    greeting: next.greeting,
    title: next.title,
    color: next.color,
    system_extra: next.systemExtra,
    escalation_email: next.escalationEmail,
    slack_webhook: next.slackWebhook,
  });
  return next;
}
