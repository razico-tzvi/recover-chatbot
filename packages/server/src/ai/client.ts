import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";

/** Singleton Anthropic client. API key is read from config (env). */
export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

export const MODEL = config.ANTHROPIC_MODEL;
