// Optional LLM layer (07 §6, 10 §3 Task 2.5). Groq via its OpenAI-compatible
// Chat Completions endpoint, so the official `openai` SDK is the client and the
// provider is a base URL — swapping to any other OpenAI-compatible host is an env
// change, not a code change.
//
// The client is `null` when GROQ_API_KEY is unset — the tested local/default path —
// so ingestion runs regex-only and never touches the network. Every call here is
// best-effort: missing key, network error, timeout, rate limit, or unparseable body
// all resolve to `null`, and the caller falls back to the deterministic regex result
// (R8). AI never breaks ingestion.
//
// R8 (defensive parse) still applies, just against the OpenAI response shape: prefer a
// structured `message.parsed` field if the provider supplies one, else `JSON.parse` the
// message content, else give up (→ regex). Never trust the model's field values either —
// both enums are re-validated below before anything is returned.
import OpenAI from "openai";
import type { PiiCategory, Sensitivity } from "@assay/shared";
import { DEFAULT_SENSITIVITY } from "../domain/classification";
import { CLASSIFY } from "./config";

const key = process.env.GROQ_API_KEY;

/** Groq's OpenAI-compatible base. Overridable so any compatible host can be pointed at. */
const BASE_URL = process.env.LLM_BASE_URL || "https://api.groq.com/openai/v1";

/** null ⇒ AI disabled (no key). Callers treat this as "use regex" (07 §6.1). */
export const llm = key ? new OpenAI({ apiKey: key, baseURL: BASE_URL }) : null;

/** Exported so GET /api/system can name the provider model. */
export const LLM_MODEL = process.env.LLM_MODEL || "llama-3.3-70b-versatile";
const AI_SAMPLE_SIZE = CLASSIFY.AI_SAMPLE_SIZE;

const CATEGORIES: PiiCategory[] = [
  "EMAIL", "PHONE", "ID_NUMBER", "CREDIT_CARD", "DATE_OF_BIRTH",
  "NAME", "ADDRESS", "IP_ADDRESS", "POSTAL_CODE", "NONE", "OTHER",
];
const SENSITIVITIES: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];

export interface AiClassification {
  category: PiiCategory;
  sensitivity: Sensitivity;
  confidence: number | null;
}

/** First text answer in the completion, or null if the response isn't the shape we expect. */
function messageText(res: unknown): string | null {
  const choice = (res as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0];
  const content = choice?.message?.content;
  return typeof content === "string" && content.trim() ? content : null;
}

// Defensive extractor (R8): structured field first, then JSON in the message text, else null.
function extractJson(res: unknown): unknown {
  const parsed = (res as { choices?: { message?: { parsed?: unknown } }[] } | null)?.choices?.[0]?.message
    ?.parsed;
  if (parsed != null) return parsed; // structured-output shape, when the host supplies one
  const text = messageText(res);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null; // ⇒ regex
  }
}

/**
 * Refine one genuinely-ambiguous column with the configured model (07 §6). Returns the
 * validated classification, or `null` on no key / any error / invalid response — the caller
 * then keeps the regex best-guess. Only ≤10 sampled values are sent (07 §7 — minimal PII
 * egress); no raw value is ever logged, on success or failure.
 */
export async function classifyColumnAI(name: string, sampleValues: string[]): Promise<AiClassification | null> {
  if (!llm) return null;
  try {
    const sample = sampleValues.slice(0, AI_SAMPLE_SIZE);
    const res = await llm.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 256,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You classify ONE dataset column into a PII category. Use ONLY the column name and " +
            "the sampled values. Reply with a JSON object holding exactly the keys " +
            '"category", "sensitivity" and "confidence"; never echo the sample values back. ' +
            "If no category applies, use NONE. If PII-like but no category fits, use OTHER.",
        },
        {
          role: "user",
          content:
            `Column name: ${name}\n` +
            `Sampled values (${sample.length}): ${JSON.stringify(sample)}\n` +
            `Categories: ${CATEGORIES.join(", ")}\n` +
            `Sensitivities: ${SENSITIVITIES.join(", ")}\n` +
            "confidence is a number from 0 to 1.",
        },
      ],
    });

    const parsed = extractJson(res) as { category?: unknown; sensitivity?: unknown; confidence?: unknown } | null;
    if (!parsed || typeof parsed !== "object") return null;

    const category = CATEGORIES.includes(parsed.category as PiiCategory) ? (parsed.category as PiiCategory) : null;
    if (!category) return null; // unknown category ⇒ distrust the whole response
    const sensitivity = SENSITIVITIES.includes(parsed.sensitivity as Sensitivity)
      ? (parsed.sensitivity as Sensitivity)
      : DEFAULT_SENSITIVITY[category];
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : null;
    return { category, sensitivity, confidence };
  } catch (err) {
    // Log column name + attempted category only — never the sampled values (07 §7).
    console.warn(`AI classification failed for column "${name}" — falling back to regex.`, errName(err));
    return null;
  }
}

/**
 * One plain-English health summary per dataset (07 §6.6). Input is the already-computed
 * profile summary string — never raw rows. Returns free text, or `null` on no key / any error;
 * the field is nullable and its absence never blocks ingestion (00-SPEC §6).
 */
export async function generateHealthNarrative(summary: string): Promise<string | null> {
  if (!llm) return null;
  try {
    const res = await llm.chat.completions.create({
      model: LLM_MODEL,
      max_tokens: 256,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "Summarize this dataset's quality, trust, and sensitivity in 2–3 plain sentences for a " +
            "data catalog. No preamble.",
        },
        { role: "user", content: summary },
      ],
    });
    return messageText(res)?.trim() ?? null;
  } catch (err) {
    console.warn("AI health narrative failed — leaving it null.", errName(err));
    return null;
  }
}

const errName = (err: unknown): string => (err instanceof Error ? err.name : "unknown error");
