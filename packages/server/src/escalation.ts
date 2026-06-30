import nodemailer from "nodemailer";
import { config, emailEnabled, slackEnabled } from "./config.js";
import type { ChatMessage } from "@recover/shared";

export interface EscalationInput {
  /** What the shopper needs help with, summarized by the assistant. */
  summary: string;
  /** Shopper contact info so a human can follow up. */
  contactEmail: string;
  contactName?: string;
  /** Recent conversation, for context. */
  transcript: ChatMessage[];
}

export interface EscalationResult {
  delivered: boolean;
  channels: string[];
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth:
        config.SMTP_USER && config.SMTP_PASS
          ? { user: config.SMTP_USER, pass: config.SMTP_PASS }
          : undefined,
    });
  }
  return transporter;
}

function formatTranscript(transcript: ChatMessage[]): string {
  return transcript
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Shopper" : "Assistant"}: ${m.content}`)
    .join("\n");
}

/**
 * Deliver an escalation to whichever channels are configured (email, Slack).
 * Never throws to the caller — returns which channels succeeded so the
 * assistant can tell the shopper truthfully whether they'll be contacted.
 */
export async function escalate(input: EscalationInput): Promise<EscalationResult> {
  const channels: string[] = [];
  const transcript = formatTranscript(input.transcript);
  const body =
    `New chatbot escalation\n\n` +
    `From: ${input.contactName ?? "(no name)"} <${input.contactEmail}>\n\n` +
    `Summary:\n${input.summary}\n\n` +
    `Recent transcript:\n${transcript}\n`;

  if (emailEnabled) {
    try {
      await getTransporter().sendMail({
        from: config.SMTP_FROM,
        to: config.ESCALATION_EMAIL,
        replyTo: input.contactEmail,
        subject: `Chatbot escalation from ${input.contactEmail}`,
        text: body,
      });
      channels.push("email");
    } catch (err) {
      console.error("Email escalation failed:", err);
    }
  }

  if (slackEnabled) {
    try {
      const res = await fetch(config.SLACK_WEBHOOK_URL as string, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "```" + body + "```" }),
      });
      if (res.ok) channels.push("slack");
      else console.error("Slack escalation failed:", res.status);
    } catch (err) {
      console.error("Slack escalation failed:", err);
    }
  }

  return { delivered: channels.length > 0, channels };
}
