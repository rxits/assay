import { describe, it, expect } from "vitest";
import { classifyColumn } from "./classification";

// 08 §3.2 — one true-positive (asserts category + sensitivity) and one false-positive
// (must resolve away — the precision guard) per category, plus the threshold boundary.

describe("classifyColumn — true positives", () => {
  it("EMAIL → HIGH on real addresses", () => {
    const r = classifyColumn({ header: "email", sampleValues: ["ada@x.io", "bob@y.com", "c@z.org"] });
    expect(r.category).toBe("EMAIL");
    expect(r.sensitivity).toBe("HIGH");
    expect(r.confidence).toBeCloseTo(1, 5);
    expect(r.needsAi).toBe(false);
  });

  it("PHONE → HIGH on domestic + international numbers", () => {
    const r = classifyColumn({ header: "phone", sampleValues: ["+1 (415) 555-0132", "9876543210"] });
    expect(r.category).toBe("PHONE");
    expect(r.sensitivity).toBe("HIGH");
  });

  it("ID_NUMBER → HIGH on SSN-shaped values", () => {
    const r = classifyColumn({ header: "ssn", sampleValues: ["123-45-6789", "078-05-1120"] });
    expect(r.category).toBe("ID_NUMBER");
    expect(r.sensitivity).toBe("HIGH");
  });

  it("CREDIT_CARD → HIGH only when Luhn-valid", () => {
    const r = classifyColumn({ header: "cc", sampleValues: ["4111 1111 1111 1111", "5500 0000 0000 0004"] });
    expect(r.category).toBe("CREDIT_CARD");
    expect(r.sensitivity).toBe("HIGH");
  });

  it("DATE_OF_BIRTH → HIGH when header hints DOB", () => {
    const r = classifyColumn({ header: "date_of_birth", sampleValues: ["1985-04-12", "1990-11-30"] });
    expect(r.category).toBe("DATE_OF_BIRTH");
    expect(r.sensitivity).toBe("HIGH");
  });

  it("NAME → MEDIUM, header-led at 0.60", () => {
    const r = classifyColumn({ header: "full_name", sampleValues: ["Ada Lovelace", "Grace Hopper"] });
    expect(r.category).toBe("NAME");
    expect(r.sensitivity).toBe("MEDIUM");
    expect(r.confidence).toBeCloseTo(0.6, 5);
  });

  it("ADDRESS → MEDIUM, header-led", () => {
    const r = classifyColumn({ header: "address", sampleValues: ["221B Baker St", "10 Downing St"] });
    expect(r.category).toBe("ADDRESS");
    expect(r.sensitivity).toBe("MEDIUM");
  });

  it("IP_ADDRESS → MEDIUM on valid IPv4", () => {
    const r = classifyColumn({ header: "ip_address", sampleValues: ["192.168.1.1", "10.0.0.5"] });
    expect(r.category).toBe("IP_ADDRESS");
    expect(r.sensitivity).toBe("MEDIUM");
  });

  it("POSTAL_CODE → LOW when header hints postal", () => {
    const r = classifyColumn({ header: "zip_code", sampleValues: ["94107", "94107-1234"] });
    expect(r.category).toBe("POSTAL_CODE");
    expect(r.sensitivity).toBe("LOW");
  });

  it("NONE → a plain metric column is explicitly classified (counts toward coverage)", () => {
    const r = classifyColumn({ header: "score", sampleValues: ["87", "91", "78"] });
    expect(r.category).toBe("NONE");
    expect(r.sensitivity).toBe("NONE");
    expect(r.source).toBe("AUTO_REGEX");
    expect(r.needsAi).toBe(false);
  });
});

describe("classifyColumn — false positives (precision guards)", () => {
  it("EMAIL: handles / no-TLD strings are not email", () => {
    const r = classifyColumn({ header: "handle", sampleValues: ["@ada", "a@b", "not-an-email"] });
    expect(r.category).not.toBe("EMAIL");
  });

  it("PHONE: dates and 16-digit numbers are not phones", () => {
    expect(classifyColumn({ header: "ref", sampleValues: ["2020-01-01", "2021-06-15"] }).category).not.toBe("PHONE");
    // 16 digits > E.164 max of 15
    expect(classifyColumn({ header: "num", sampleValues: ["4111111111111111", "4111111111111111"] }).category).not.toBe("PHONE");
  });

  it("ID_NUMBER: a surrogate key of sequential ints stays NONE (headline guard)", () => {
    const r = classifyColumn({ header: "customer_id", sampleValues: ["1", "2", "3", "4", "5"] });
    expect(r.category).toBe("NONE");
    expect(r.sensitivity).toBe("NONE");
  });

  it("CREDIT_CARD: a number that fails Luhn is not a card", () => {
    const r = classifyColumn({ header: "ref", sampleValues: ["4111 1111 1111 1112", "4111 1111 1111 1113"] });
    expect(r.category).not.toBe("CREDIT_CARD");
  });

  it("DATE_OF_BIRTH: an ordinary date column is not DOB", () => {
    const r = classifyColumn({ header: "signup_date", sampleValues: ["2023-01-15", "2023-02-20"] });
    expect(r.category).toBe("NONE");
  });

  it("NAME: two capitalized words without a name header are not NAME", () => {
    const r = classifyColumn({ header: "city", sampleValues: ["New York", "St. Louis"] });
    expect(r.category).not.toBe("NAME");
  });

  it("ADDRESS: a lone token / city is not an address", () => {
    const r = classifyColumn({ header: "city", sampleValues: ["Baker", "St. Louis"] });
    expect(r.category).not.toBe("ADDRESS");
  });

  it("IP_ADDRESS: out-of-range octets and wrong arity are not IPs", () => {
    const r = classifyColumn({ header: "val", sampleValues: ["999.1.1.1", "1.2.3", "256.256.256.256"] });
    expect(r.category).not.toBe("IP_ADDRESS");
  });

  it("POSTAL_CODE: 4-digit years and bare 5-digit IDs are not postal", () => {
    expect(classifyColumn({ header: "year", sampleValues: ["2024", "2023"] }).category).not.toBe("POSTAL_CODE");
    expect(classifyColumn({ header: "user_id", sampleValues: ["12345", "23456"] }).category).not.toBe("POSTAL_CODE");
  });
});

describe("classifyColumn — value threshold (confidence = match share)", () => {
  const emails = (n: number) => Array.from({ length: 100 }, (_, i) => (i < n ? `u${i}@x.io` : `plain${i}`));

  it("share 0.71 classifies as EMAIL with confidence = share", () => {
    const r = classifyColumn({ header: "field", sampleValues: emails(71) });
    expect(r.category).toBe("EMAIL");
    expect(r.confidence).toBeCloseTo(0.71, 2);
    expect(r.needsAi).toBe(false);
  });

  it("share 0.69 is ambiguous (deferred to AI), not auto-classified", () => {
    const r = classifyColumn({ header: "field", sampleValues: emails(69) });
    expect(r.needsAi).toBe(true);
  });

  it("empty sample with no header signal → explicit NONE", () => {
    const r = classifyColumn({ header: "whatever", sampleValues: [] });
    expect(r.category).toBe("NONE");
    expect(r.needsAi).toBe(false);
  });
});
