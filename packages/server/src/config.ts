import { z } from "zod";

/**
 * Environment configuration, validated at boot. Import `config` anywhere;
 * the process exits with a clear message if anything required is missing.
 */
const schema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  // BigCommerce
  BC_STORE_HASH: z.string().min(1, "BC_STORE_HASH is required"),
  BC_ACCESS_TOKEN: z.string().min(1, "BC_ACCESS_TOKEN is required"),

  // Server
  PORT: z.coerce.number().int().positive().default(3000),
  ALLOWED_ORIGINS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  // Escalation — email (SMTP)
  ESCALATION_EMAIL: z.string().email().optional().or(z.literal("")),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  // Escalation — Slack
  SLACK_WEBHOOK_URL: z.string().url().optional().or(z.literal("")),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const config = parsed.data;

/** True when SMTP email escalation is fully configured. */
export const emailEnabled = Boolean(
  config.ESCALATION_EMAIL &&
    config.SMTP_HOST &&
    config.SMTP_PORT &&
    config.SMTP_FROM,
);

/** True when Slack escalation is configured. */
export const slackEnabled = Boolean(config.SLACK_WEBHOOK_URL);
