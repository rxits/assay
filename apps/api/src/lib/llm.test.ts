// The no-key path is the tested default (07 §6.1): without GROQ_API_KEY the client is
// null, so ingestion is regex-only and the process never opens a socket to a provider.
// The paid path is exercised by hand — mocking the SDK to test our own mock proves nothing.
// ponytail: no key ⇒ null contract only; add a nock/msw round-trip if the parse shape drifts.
import { describe, it, expect } from "vitest";
import { classifyColumnAI, generateHealthNarrative, llm } from "./llm";

describe("llm adapter without GROQ_API_KEY", () => {
  it("has no client", () => {
    expect(process.env.GROQ_API_KEY).toBeUndefined();
    expect(llm).toBeNull();
  });

  it("resolves null instead of throwing, so callers fall back to regex", async () => {
    await expect(classifyColumnAI("customer_ref", ["A-1", "A-2"])).resolves.toBeNull();
    await expect(generateHealthNarrative("4 columns, 1 with missing values")).resolves.toBeNull();
  });
});
