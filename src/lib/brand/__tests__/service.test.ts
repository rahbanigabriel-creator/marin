import assert from "node:assert/strict";
import test from "node:test";

import type { BrandWriteInput } from "@/lib/brand/types";

import {
  cleanStringList,
  normalizeBrandWriteInput,
} from "../service";

test("cleanStringList trims values, drops blanks and non-strings, and enforces limits", () => {
  const longItem = "x".repeat(310);
  const input: unknown[] = [
    `  ${longItem}  `,
    "   ",
    42,
    ...Array.from({ length: 31 }, (_, index) => `  item-${index + 1}  `),
  ];

  const cleaned = cleanStringList(input);

  assert.equal(cleaned?.length, 30);
  assert.equal(cleaned?.[0], "x".repeat(300));
  assert.equal(cleaned?.[1], "item-1");
  assert.equal(cleaned?.at(-1), "item-29");
});

test("cleanStringList preserves omitted input and rejects a non-list value", () => {
  assert.equal(cleanStringList(undefined), undefined);
  assert.throws(
    () => cleanStringList("audience"),
    /Expected a list of text values/,
  );
});

test("normalizeBrandWriteInput trims text and uppercases currency", () => {
  const normalized = normalizeBrandWriteInput({
    name: "  Marpin  ",
    websiteUrl: "  https://www.marpin.ai  ",
    summary: "   ",
    audience: ["  Solo founders  ", "  "],
    voice: ["  Direct  ", "  Practical  "],
    locale: "  en-GB  ",
    timezone: "  Europe/Madrid  ",
    currency: " eur ",
  });

  assert.deepEqual(normalized, {
    name: "Marpin",
    websiteUrl: "https://www.marpin.ai",
    summary: null,
    audience: ["Solo founders"],
    voice: ["Direct", "Practical"],
    offers: undefined,
    competitors: undefined,
    proofPoints: undefined,
    visualStyle: undefined,
    locale: "en-GB",
    timezone: "Europe/Madrid",
    currency: "EUR",
  });
});

test("normalizeBrandWriteInput permits an omitted name for partial updates", () => {
  const normalized = normalizeBrandWriteInput({ summary: "  Updated summary  " });

  assert.equal(normalized.name, undefined);
  assert.equal(normalized.summary, "Updated summary");
});

test("normalizeBrandWriteInput rejects supplied blank or null names", () => {
  assert.throws(
    () => normalizeBrandWriteInput({ name: "   " }),
    /Brand name is required/,
  );
  assert.throws(
    () => normalizeBrandWriteInput({ name: null } as unknown as BrandWriteInput),
    /Brand name is required/,
  );
});

test("normalizeBrandWriteInput rejects invalid scalar and list types", () => {
  assert.throws(
    () => normalizeBrandWriteInput({ name: 123 } as unknown as BrandWriteInput),
    /Expected text value/,
  );
  assert.throws(
    () =>
      normalizeBrandWriteInput({
        name: "Marpin",
        audience: "founders",
      } as unknown as BrandWriteInput),
    /Expected a list of text values/,
  );
});

test("normalizeBrandWriteInput validates regional defaults", () => {
  assert.equal(normalizeBrandWriteInput({ locale: "en_ES" }).locale, "en-ES");
  assert.throws(() => normalizeBrandWriteInput({ locale: "not_a_locale_!" }), /Invalid locale/);
  assert.throws(() => normalizeBrandWriteInput({ timezone: "Barcelona" }), /Invalid timezone/);
  assert.throws(() => normalizeBrandWriteInput({ currency: "EURO" }), /Invalid currency/);
});
