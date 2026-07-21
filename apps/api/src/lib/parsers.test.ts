import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseCsv, parseXlsx } from "./parsers";

describe("parseCsv", () => {
  it("returns headers and rows for a well-formed CSV buffer", () => {
    const csv = "email,name,age\nada@x.io,Ada,36\ngrace@x.io,Grace,45";
    const { headers, rows, ragged } = parseCsv(Buffer.from(csv));
    expect(headers).toEqual(["email", "name", "age"]);
    expect(rows).toEqual([
      ["ada@x.io", "Ada", "36"],
      ["grace@x.io", "Grace", "45"],
    ]);
    expect(ragged).toBe(false);
  });

  it("null-pads short rows and drops extra fields, flagging ragged", () => {
    const csv = "a,b,c\n1,2\n4,5,6,7";
    const { rows, ragged } = parseCsv(Buffer.from(csv));
    expect(rows).toEqual([
      ["1", "2", null], // short row -> null-padded to width 3
      ["4", "5", "6"], // extra field dropped
    ]);
    expect(ragged).toBe(true);
  });

  it("preserves duplicate headers by position", () => {
    const { headers } = parseCsv(Buffer.from("id,name,name\n1,a,b"));
    expect(headers).toEqual(["id", "name", "name"]);
  });

  it("keeps empty interior cells as empty strings (not padding)", () => {
    const { rows } = parseCsv(Buffer.from("a,b,c\n1,,3"));
    expect(rows).toEqual([["1", "", "3"]]);
  });
});

describe("parseXlsx", () => {
  it("reads the first sheet only and returns headers and rows", () => {
    const wb = XLSX.utils.book_new();
    const s1 = XLSX.utils.aoa_to_sheet([
      ["email", "age"],
      ["ada@x.io", "36"],
      ["grace@x.io", "45"],
    ]);
    const s2 = XLSX.utils.aoa_to_sheet([["ignored"], ["should not appear"]]);
    XLSX.utils.book_append_sheet(wb, s1, "First");
    XLSX.utils.book_append_sheet(wb, s2, "Second");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const { headers, rows } = parseXlsx(buf);
    expect(headers).toEqual(["email", "age"]);
    expect(rows).toEqual([
      ["ada@x.io", "36"],
      ["grace@x.io", "45"],
    ]);
  });
});
