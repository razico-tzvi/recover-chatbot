import { z } from "zod";

/**
 * Environment configuration, validated at boot. Import `config` anywhere;
 * the process exits with a clear message if anything required is missing.
 */
const schema = z.object({
  // LLM provider selection. "anthropic" (default, production) or "openai"
  // (any OpenAI-compatible endpoint — Ollama, LM Studio, llama.cpp — for local
  // testing / self-hosting).
  LLM_PROVIDER: z.enum(["anthropic", "openai"]).default("anthropic"),

  // Anthropic (required when LLM_PROVIDER=anthropic)
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-sonnet-4-6"),

  // OpenAI-compatible (required when LLM_PROVIDER=openai)
  OPENAI_BASE_URL: z.string().url().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().default("not-needed"),

  // BigCommerce (required unless MOCK_BIGCOMMERCE=true)
  MOCK_BIGCOMMERCE: z
    .string()
    .default("false")
    .transform((s) => s.toLowerCase() === "true"),
  BC_STORE_HASH: z.string().optional(),
  BC_ACCESS_TOKEN: z.string().optional(),

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

const parsed = schema
  .superRefine((v, ctx) => {
    if (v.LLM_PROVIDER === "anthropic" && !v.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ANTHROPIC_API_KEY"],
        message: "required when LLM_PROVIDER=anthropic",
      });
    }
    if (v.LLM_PROVIDER === "openai" && (!v.OPENAI_BASE_URL || !v.OPENAI_MODEL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OPENAI_BASE_URL"],
        message: "OPENAI_BASE_URL and OPENAI_MODEL are required when LLM_PROVIDER=openai",
      });
    }
    if (!v.MOCK_BIGCOMMERCE && (!v.BC_STORE_HASH || !v.BC_ACCESS_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["BC_STORE_HASH"],
        message: "BC_STORE_HASH and BC_ACCESS_TOKEN are required unless MOCK_BIGCOMMERCE=true",
      });
    }
  })
  .safeParse(process.env);

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
