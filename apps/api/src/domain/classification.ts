// Pure PII classification (07 §3–§5). Two deterministic signals — header-name
// regex + value-pattern sampling — resolved into one draft tag, OR flagged
// `needsAi` when genuinely ambiguous. NO API calls here: the Claude Haiku refine
// and DB caching live in services/ (Phase 2B). Regex resolves ~95% of columns;
// an explicit NONE is still a *resolved* tag and counts toward coverage (07 §5).
import type { PiiCategory, Sensitivity, TagSource } from "@assay/shared";
import { CLASSIFY } from "../lib/config";

export interface ClassifyInput {
  header: string;
  sampleValues: string[];
}

export interface ClassifyResult {
  category: PiiCategory;
  sensitivity: Sensitivity;
  confidence: number | null; // match share, HEADER_CONFIDENCE, or null (explicit NONE)
  source: TagSource; // always AUTO_REGEX here — AUTO_AI/MANUAL are set in services/
  needsAi: boolean; // true = ambiguous; Phase 2B may refine with Claude (category is a best-guess)
}

// Default sensitivity per category (07 §1 / 00-SPEC §8).
const DEFAULT_SENSITIVITY: Record<PiiCategory, Sensitivity> = {
  EMAIL: "HIGH",
  PHONE: "HIGH",
  ID_NUMBER: "HIGH",
  CREDIT_CARD: "HIGH",
  DATE_OF_BIRTH: "HIGH",
  NAME: "MEDIUM",
  ADDRESS: "MEDIUM",
  IP_ADDRESS: "MEDIUM",
  POSTAL_CODE: "LOW",
  OTHER: "LOW",
  NONE: "NONE",
};

// --- Signal A: header-name heuristics (07 §3) ----------------------------
const norm = (h: string) => h.toLowerCase().replace(/[\s_\-]+/g, " ").trim();

// Evaluated top-to-bottom; first hit wins (specific categories beat generic NAME/ADDRESS).
const HEADER_PATTERNS: [PiiCategory, RegExp][] = [
  ["EMAIL", /\bemail\b|\be ?mail\b/i],
  ["IP_ADDRESS", /\b(ip|ip ?addr(?:ess)?|ipv4|ipv6|client ip|remote addr)\b/i],
  ["CREDIT_CARD", /\b(credit card|card ?(?:no|num|number)|cc ?(?:no|num|number)?|pan)\b/i],
  ["ID_NUMBER", /\b(ssn|social security(?: (?:no|number))?|national id|passport(?: (?:no|number))?|aadhaar|aadhar|tax id|ein|nino|government id|gov id)\b/i],
  ["PHONE", /\b(phone|mobile|cell(?: ?phone)?|telephone|tel|msisdn|fax)\b|\bcontact ?(?:no|num|number)\b/i],
  ["DATE_OF_BIRTH", /\b(dob|date of birth|birth ?date|birthday|bday)\b/i],
  ["POSTAL_CODE", /\b(zip(?: ?code)?|postal ?code|post ?code|postcode|pin ?code|pincode)\b/i],
  ["NAME", /\b((?:first|last|full|given|middle|sur) ?name|f ?name|l ?name|surname|name)\b/i],
  ["ADDRESS", /\b(address|addr|street(?: address)?|mailing address|billing address)\b/i],
];

const headerCategory = (h: string): PiiCategory | null =>
  HEADER_PATTERNS.find(([, re]) => re.test(norm(h)))?.[0] ?? null;

// --- Signal B: value-pattern sampling (07 §4) ----------------------------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const IPV6_RE = /^(?:[A-F0-9]{1,4}:){2,7}[A-F0-9]{1,4}$/i;
const PHONE_RE = /^\+?[0-9][0-9\s().\-]{5,20}[0-9]$/;
const CARD_RE = /^(?:\d[ \-]?){13,19}$/;
const SSN_RE = /^\d{3}-?\d{2}-?\d{4}$/;
const DATE_RE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})$/;
const POSTAL_RE = /^\d{5}(?:-\d{4})?$/;

// Strong = high-precision value signal; two disagreeing strong signals → AMBIGUOUS (07 §5).
const STRONG = new Set<PiiCategory>(["EMAIL", "PHONE", "IP_ADDRESS", "CREDIT_CARD"]);
const isStrong = (c: PiiCategory) => STRONG.has(c);

const digitsOf = (s: string) => s.replace(/\D/g, "");

// Luhn checksum — turns the noisy 13–19-digit shape into a high-precision card signal (07 §4).
const luhnOk = (s: string): boolean => {
  const d = digitsOf(s);
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

// DATE_OF_BIRTH and POSTAL_CODE value shapes are ambiguous (any date; any 5-digit int),
// so they only count when the header hints the category — this is the signup_date→NONE
// and 5-digit-ID→NONE false-positive guard (07 §4).
function valueMatches(cat: PiiCategory, v: string, headerCat: PiiCategory | null): boolean {
  switch (cat) {
    case "EMAIL":
      return EMAIL_RE.test(v);
    case "IP_ADDRESS":
      return IPV4_RE.test(v) || IPV6_RE.test(v);
    case "PHONE": {
      const d = digitsOf(v);
      return PHONE_RE.test(v) && d.length >= 7 && d.length <= 15 && !DATE_RE.test(v);
    }
    case "CREDIT_CARD":
      return CARD_RE.test(v) && luhnOk(v);
    case "ID_NUMBER":
      return SSN_RE.test(v);
    case "DATE_OF_BIRTH":
      return headerCat === "DATE_OF_BIRTH" && DATE_RE.test(v);
    case "POSTAL_CODE":
      return headerCat === "POSTAL_CODE" && POSTAL_RE.test(v);
    default:
      return false;
  }
}

// Value-precision order; NAME/ADDRESS are header-led (no reliable value regex — 07 §4).
const VALUE_CATEGORIES: PiiCategory[] = [
  "EMAIL",
  "IP_ADDRESS",
  "CREDIT_CARD",
  "PHONE",
  "ID_NUMBER",
  "DATE_OF_BIRTH",
  "POSTAL_CODE",
];

function bestValueCategory(
  sample: string[],
  headerCat: PiiCategory | null,
): { best: PiiCategory | null; share: number } {
  const vals = sample.map((v) => (v ?? "").trim()).filter((v) => v !== "");
  const n = vals.length;
  if (n === 0) return { best: null, share: 0 };
  let best: PiiCategory | null = null;
  let share = 0;
  for (const cat of VALUE_CATEGORIES) {
    let m = 0;
    for (const v of vals) if (valueMatches(cat, v, headerCat)) m++;
    const s = m / n;
    // On a tie, prefer the header category: SSN-shaped values match PHONE too, but an
    // `ssn` header must resolve ID_NUMBER, not PHONE (07 §5 — header + values agree).
    if (s > share || (s === share && s > 0 && cat === headerCat)) {
      share = s;
      best = cat;
    }
  }
  return { best, share };
}

// --- Combine & resolve (07 §5) -------------------------------------------
interface Draft {
  category: PiiCategory;
  sensitivity: Sensitivity;
  confidence: number | null;
  source: TagSource;
}

const tag = (category: PiiCategory, confidence: number | null): Draft => ({
  category,
  sensitivity: DEFAULT_SENSITIVITY[category],
  confidence,
  source: "AUTO_REGEX",
});

function resolveTag(header: string, sample: string[]): Draft | "AMBIGUOUS" {
  const h = headerCategory(header);
  const { best, share } = bestValueCategory(sample, h);

  // 1. Decisive value evidence (≥ threshold): values win, unless two strong signals disagree.
  if (best && share >= CLASSIFY.CLASSIFY_THRESHOLD) {
    if (h && h !== best && isStrong(h) && isStrong(best)) return "AMBIGUOUS";
    return tag(best, share);
  }

  // 2. Header hint, values did not confirm.
  if (h) {
    if (isStrong(h) && share >= CLASSIFY.AMBIGUOUS_MIN) return "AMBIGUOUS"; // partial 0.30–0.70 on a strong cat
    return tag(h, CLASSIFY.HEADER_CONFIDENCE); // weak-value cats (NAME/ADDRESS) resolve on header alone
  }

  // 3. No header, partial value signal → ambiguous.
  if (share >= CLASSIFY.AMBIGUOUS_MIN) return "AMBIGUOUS";

  // 4. No signal at all → explicit NONE (counts toward ClassificationCoverage — 07 §5).
  return tag("NONE", null);
}

/**
 * Classify one column from its header + sampled values (07 §3–§5). Pure & deterministic.
 * An ambiguous column returns a regex best-guess with `needsAi: true` (fallback order §6.5:
 * value-band winner → header category → NONE); Phase 2B may overwrite it with Claude Haiku.
 */
export function classifyColumn({ header, sampleValues }: ClassifyInput): ClassifyResult {
  const draft = resolveTag(header, sampleValues);
  if (draft !== "AMBIGUOUS") return { ...draft, needsAi: false };

  const h = headerCategory(header);
  const { best, share } = bestValueCategory(sampleValues, h);
  const useValue = best !== null && share >= CLASSIFY.AMBIGUOUS_MIN;
  const guess: PiiCategory = useValue ? best : (h ?? "NONE");
  const confidence = useValue ? share : h ? CLASSIFY.HEADER_CONFIDENCE : null;
  return {
    category: guess,
    sensitivity: DEFAULT_SENSITIVITY[guess],
    confidence,
    source: "AUTO_REGEX",
    needsAi: true,
  };
}
