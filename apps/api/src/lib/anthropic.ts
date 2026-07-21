// Optional Claude layer (07 §6, 10 §3 Task 2.5). The client is `null` when
// ANTHROPIC_API_KEY is unset — the tested local/default path — so ingestion runs
// regex-only and never touches the network. Every call here is best-effort: any
// missing key, network error, timeout, or unparseable body resolves to `null`, and
// the caller falls back to the deterministic regex result (R8). AI never breaks ingestion.
//
// R8 — structured-output shape verified against the installed @anthropic-ai/sdk (0.112.3):
// `messages.create({ output_config: { format: { type: "json_schema", schema } } })`
// returns a Message whose text block holds the schema-constrained JSON. We parse
// DEFENSIVELY: prefer a structured field if present, else JSON.parse the text block,
// else give up (→ regex). Model id pinned by 00-SPEC §8 / 07 §6.
import Anthropic from "@anthropic-ai/sdk";
import type { PiiCategory, Sensitivity } from "@assay/shared";
import { DEFAULT_SENSITIVITY } from "../domain/classification";

const key = process.env.ANTHROPIC_API_KEY;

/** null ⇒ AI disabled (no key). Callers treat this as "use regex" (07 §6.1). */
export const anthropic = key ? new Anthropic({ apiKey: key }) : null;

const MODEL = "claude-haiku-4-5-20251001";
const AI_SAMPLE_SIZE = 10;

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

// Defensive extractor (R8): structured field first, then JSON in any text block, else null.
function extractJson(res: unknown): unknown {
  if (res && typeof res === "object") {
    const r = res as { parsed_output?: unknown; content?: unknown };
    if (r.parsed_output != null) return r.parsed_output; // structured/parse() shape
    if (Array.isArray(r.content)) {
      for (const block of r.content) {
        const text = block?.type === "text" ? block.text : undefined;
        if (typeof text === "string") {
          try {
            return JSON.parse(text);
          } catch {
            /* try the next block */
          }
        }
      }
    }
  }
  return null;
}

/**
 * Refine one genuinely-ambiguous column with Claude Haiku (07 §6). Returns the validated
 * classification, or `null` on no key / any error / invalid response — the caller then keeps
 * the regex best-guess. Only ≤10 sampled values are sent (07 §7 — minimal PII egress); no raw
 * value is ever logged, on success or failure.
 */
export async function classifyColumnAI(name: string, sampleValues: string[]): Promise<AiClassification | null> {
  if (!anthropic) return null;
  try {
    const sample = sampleValues.slice(0, AI_SAMPLE_SIZE);
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "You classify ONE dataset column into a PII category. Use ONLY the column name and " +
        "the sampled values. Reply with JSON only; never echo the sample values back. If none " +
        "apply, use NONE. If PII-like but no category fits, use OTHER.",
      messages: [
        {
          role: "user",
          content:
            `Column name: ${name}\n` +
            `Sampled values (${sample.length}): ${JSON.stringify(sample)}\n` +
            `Categories: ${CATEGORIES.join(", ")}`,
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              category: { type: "string", enum: [...CATEGORIES] },
              sensitivity: { type: "string", enum: [...SENSITIVITIES] },
              confidence: { type: "number" },
            },
            required: ["category", "sensitivity", "confidence"],
            additionalProperties: false,
          },
        },
      },
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
  if (!anthropic) return null;
  try {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 256,
      system:
        "Summarize this dataset's quality, trust, and sensitivity in 2–3 plain sentences for a " +
        "data catalog. No preamble.",
      messages: [{ role: "user", content: summary }],
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    return typeof text === "string" && text.trim() ? text.trim() : null;
  } catch (err) {
    console.warn("AI health narrative failed — leaving it null.", errName(err));
    return null;
  }
}

const errName = (err: unknown): string => (err instanceof Error ? err.name : "unknown error");
