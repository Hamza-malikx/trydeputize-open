/**
 * The barcode generator's rules, kept apart from the component so they can be
 * tested without a browser. The encoder itself is jsbarcode; this file decides
 * what each symbology accepts, adds and verifies check digits so the tool can
 * say what it did ("Check digit 1 added") rather than silently changing the
 * number, and lays several codes out on one sheet.
 */

export type SymbologyId =
  | "code128"
  | "code39"
  | "ean13"
  | "ean8"
  | "upca"
  | "upce"
  | "itf14"
  | "codabar";

export type Prepared =
  | { ok: true; value: string; note?: string }
  | { ok: false; message: string };

export interface Symbology {
  id: SymbologyId;
  label: string;
  /** jsbarcode's name for it. */
  format: "CODE128" | "CODE39" | "EAN13" | "EAN8" | "UPC" | "UPCE" | "ITF14" | "codabar";
  /** One sentence for the strip above the desk: what it holds and where it is used. */
  hint: string;
  example: string;
  prepare: (raw: string) => Prepared;
}

/** Codes on one sheet. Past this the sheet stops being printable on a page. */
export const MAX_CODES = 100;
/** Code 128 and Code 39 have no fixed length; past this scanners struggle. */
export const MAX_LENGTH = 80;

/**
 * The GS1 modulo-10 check digit shared by EAN-13, EAN-8, UPC-A and ITF-14:
 * weights 3 and 1 alternate from the rightmost digit of the body.
 */
export function mod10CheckDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const weight = (body.length - i) % 2 === 1 ? 3 : 1;
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Expand the six middle digits of a UPC-E to the twelve-digit UPC-A they
 * stand for, including its check digit. The last of the six digits says which
 * zeros were squeezed out (the GS1 rule jsbarcode implements too).
 */
export function upceToUpca(middle: string, numberSystem: "0" | "1"): string {
  const patterns = [
    "XX00000XXX",
    "XX10000XXX",
    "XX20000XXX",
    "XXX00000XX",
    "XXXX00000X",
    "XXXXX00005",
    "XXXXX00006",
    "XXXXX00007",
    "XXXXX00008",
    "XXXXX00009",
  ];
  const pattern = patterns[Number(middle[5])];
  let next = 0;
  let body = numberSystem;
  for (const char of pattern) body += char === "X" ? middle[next++] : char;
  return body + mod10CheckDigit(body);
}

const stripDigitSeparators = (raw: string) => raw.replace(/[\s-]/g, "");

function listChars(chars: string[]): string {
  const unique = [...new Set(chars)].slice(0, 6);
  return unique.map((c) => (c === " " ? "space" : c)).join(" ");
}

/** EAN-13, EAN-8, UPC-A and ITF-14: a fixed body plus one check digit. */
function fixedDigits(label: string, raw: string, bodyLength: number): Prepared {
  const digits = stripDigitSeparators(raw);
  const foreign = digits.match(/[^0-9]/g);
  if (foreign) {
    return { ok: false, message: `${label} holds digits only. Remove: ${listChars(foreign)}.` };
  }
  if (digits.length === bodyLength) {
    const check = mod10CheckDigit(digits);
    return { ok: true, value: digits + check, note: `Check digit ${check} added.` };
  }
  if (digits.length === bodyLength + 1) {
    const body = digits.slice(0, -1);
    const expected = mod10CheckDigit(body);
    if (Number(digits[bodyLength]) !== expected) {
      return {
        ok: false,
        message: `The check digit does not match: for ${body} it is ${expected}, not ${digits[bodyLength]}. Type the first ${bodyLength} digits and it is added for you.`,
      };
    }
    return { ok: true, value: digits, note: "Check digit verified." };
  }
  return {
    ok: false,
    message: `${label} needs ${bodyLength} digits (the check digit is added for you) or all ${bodyLength + 1}. You typed ${digits.length}.`,
  };
}

function prepareCode128(raw: string): Prepared {
  const value = raw.trim();
  if (!value) return { ok: false, message: "Type something first." };
  const foreign = value.match(/[^\x20-\x7e]/g);
  if (foreign) {
    return {
      ok: false,
      message: `Code 128 holds ASCII only: letters, digits and the symbols on a keyboard. Remove: ${listChars(foreign)}.`,
    };
  }
  if (value.length > MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep it under ${MAX_LENGTH} characters: long codes are hard for scanners to read. This one is ${value.length}.`,
    };
  }
  return { ok: true, value };
}

function prepareCode39(raw: string): Prepared {
  const trimmed = raw.trim();
  const value = trimmed.toUpperCase();
  if (!value) return { ok: false, message: "Type something first." };
  const foreign = value.match(/[^0-9A-Z\-. $/+%]/g);
  if (foreign) {
    return {
      ok: false,
      message: `Code 39 holds digits, capital letters, space and - . $ / + %. Remove: ${listChars(foreign)}.`,
    };
  }
  if (value.length > MAX_LENGTH) {
    return {
      ok: false,
      message: `Keep it under ${MAX_LENGTH} characters: long codes are hard for scanners to read. This one is ${value.length}.`,
    };
  }
  return {
    ok: true,
    value,
    note: value !== trimmed ? "Shown in capitals: Code 39 has no lowercase letters." : undefined,
  };
}

function prepareUpcE(raw: string): Prepared {
  const digits = stripDigitSeparators(raw);
  const foreign = digits.match(/[^0-9]/g);
  if (foreign) {
    return { ok: false, message: `UPC-E holds digits only. Remove: ${listChars(foreign)}.` };
  }
  if (digits.length === 6) {
    return { ok: true, value: digits, note: `Reads as UPC-A ${upceToUpca(digits, "0")}.` };
  }
  if (digits.length === 7) {
    return {
      ok: false,
      message:
        "A 7-digit UPC-E is ambiguous. Type the 6 middle digits, or all 8 with the number system first and the check digit last.",
    };
  }
  if (digits.length === 8) {
    const system = digits[0];
    if (system !== "0" && system !== "1") {
      return { ok: false, message: "An 8-digit UPC-E starts with 0 or 1, the number system." };
    }
    const upca = upceToUpca(digits.slice(1, 7), system);
    const expected = upca[11];
    if (digits[7] !== expected) {
      return {
        ok: false,
        message: `The check digit does not match: for ${digits.slice(0, 7)} it is ${expected}, not ${digits[7]}. Type the 6 middle digits and it is worked out for you.`,
      };
    }
    return { ok: true, value: digits, note: `Reads as UPC-A ${upca}.` };
  }
  return {
    ok: false,
    message: `UPC-E needs 6 digits, or all 8. You typed ${digits.length}.`,
  };
}

function prepareCodabar(raw: string): Prepared {
  const value = raw.trim().toUpperCase();
  if (!value) return { ok: false, message: "Type something first." };
  if (/^[0-9\-$:./+]+$/.test(value)) {
    return {
      ok: true,
      value: `A${value}A`,
      note: "Start and stop letters (A) added. Scanners expect them and do not show them.",
    };
  }
  if (/^[A-D][0-9\-$:./+]+[A-D]$/.test(value)) return { ok: true, value };
  const foreign = value.match(/[^0-9A-D\-$:./+]/g);
  return {
    ok: false,
    message: foreign
      ? `Codabar holds digits and - $ : / . + between start and stop letters A to D. Remove: ${listChars(foreign)}.`
      : "Codabar needs the digits between one start letter and one stop letter, each from A to D.",
  };
}

export const SYMBOLOGIES: readonly Symbology[] = [
  {
    id: "code128",
    label: "Code 128",
    format: "CODE128",
    hint: "Any text: letters, digits and keyboard symbols. The usual choice for labels, tickets and internal IDs.",
    example: "TD-2026-0001",
    prepare: prepareCode128,
  },
  {
    id: "code39",
    label: "Code 39",
    format: "CODE39",
    hint: "Digits, capital letters and - . $ / + %. Older and wider than Code 128, read by every scanner.",
    example: "ASSET 4471",
    prepare: prepareCode39,
  },
  {
    id: "ean13",
    label: "EAN-13",
    format: "EAN13",
    hint: "The 13-digit retail number on products sold outside North America. Type 12 digits and the check digit is added.",
    example: "400638133393",
    prepare: (raw) => fixedDigits("EAN-13", raw, 12),
  },
  {
    id: "ean8",
    label: "EAN-8",
    format: "EAN8",
    hint: "The short retail code for small packages. Type 7 digits and the check digit is added.",
    example: "9638507",
    prepare: (raw) => fixedDigits("EAN-8", raw, 7),
  },
  {
    id: "upca",
    label: "UPC-A",
    format: "UPC",
    hint: "The 12-digit retail code used in the US and Canada. Type 11 digits and the check digit is added.",
    example: "03600029145",
    prepare: (raw) => fixedDigits("UPC-A", raw, 11),
  },
  {
    id: "upce",
    label: "UPC-E",
    format: "UPCE",
    hint: "The compressed six-digit UPC for small packages. Type the 6 digits, or all 8.",
    example: "123456",
    prepare: prepareUpcE,
  },
  {
    id: "itf14",
    label: "ITF-14",
    format: "ITF14",
    hint: "The 14-digit code on shipping cartons. Type 13 digits and the check digit is added.",
    example: "1234567890123",
    prepare: (raw) => fixedDigits("ITF-14", raw, 13),
  },
  {
    id: "codabar",
    label: "Codabar",
    format: "codabar",
    hint: "Digits and - $ : / . + between start and stop letters A to D. Libraries, blood banks and courier labels.",
    example: "31117013206375",
    prepare: prepareCodabar,
  },
];

export function symbologyById(id: string): Symbology {
  return SYMBOLOGIES.find((s) => s.id === id) ?? SYMBOLOGIES[0];
}

/** One code per non-empty line, capped at MAX_CODES; `dropped` says how many were cut. */
export function parseLines(text: string): { codes: string[]; dropped: number } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { codes: lines.slice(0, MAX_CODES), dropped: Math.max(0, lines.length - MAX_CODES) };
}

/** A file name that says which code it is: "ean13-4006381333931", "code128-Hello-world". */
export function fileStem(id: SymbologyId, value: string): string {
  const slug = value
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug ? `${id}-${slug}` : id;
}

/** What jsbarcode draws with. Kept as data so the preview and both exports agree. */
export interface Look {
  /** Width of the narrowest bar, in pixels. */
  barWidth: number;
  /** Bar height in pixels. */
  height: number;
  showText: boolean;
  fontSize: number;
  margin: number;
  bars: string;
  background: string;
  transparent: boolean;
}

export const DEFAULT_LOOK: Look = {
  barWidth: 2,
  height: 80,
  showText: true,
  fontSize: 16,
  margin: 12,
  bars: "#000000",
  background: "#ffffff",
  transparent: false,
};

export const BAR_WIDTHS = [1, 2, 3, 4] as const;
export const HEIGHT_RANGE = { min: 20, max: 300 } as const;
export const FONT_RANGE = { min: 8, max: 40 } as const;
export const MARGIN_RANGE = { min: 0, max: 60 } as const;

export const clampInt = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value)));

/**
 * jsbarcode's options for a Look. The font is a system stack on purpose: the
 * PNG is drawn by loading the SVG as an image, which cannot see the page's web
 * fonts, so a page font would preview one way and export another.
 */
export function encoderOptions(look: Look) {
  return {
    width: look.barWidth,
    height: look.height,
    displayValue: look.showText,
    fontSize: look.fontSize,
    font: "Helvetica Neue, Helvetica, Arial, sans-serif",
    textMargin: 4,
    margin: look.margin,
    lineColor: look.bars,
    // An empty background is how jsbarcode is told to draw no background rect.
    background: look.transparent ? "" : look.background,
  };
}

/** The pixel size jsbarcode wrote on an SVG it rendered. */
export function svgSize(svg: string): { width: number; height: number } {
  const open = svg.match(/^<svg\b[^>]*>/)?.[0] ?? "";
  const read = (name: string) => Number(open.match(new RegExp(`\\b${name}="([\\d.]+)`))?.[1] ?? 0);
  return { width: read("width"), height: read("height") };
}

/**
 * Several rendered codes stacked on one SVG sheet, centred on the widest, so a
 * batch prints as one page of labels. Each code keeps its own background.
 */
export function composeSheet(svgs: string[], gap = 24): string {
  const items = svgs.map((svg) => {
    const inner = svg.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>\s*$/)?.[1] ?? "";
    return { inner, ...svgSize(svg) };
  });
  const width = Math.max(0, ...items.map((item) => item.width));
  const height =
    items.reduce((sum, item) => sum + item.height, 0) + gap * Math.max(0, items.length - 1);
  let y = 0;
  const groups = items.map((item) => {
    const group = `<g transform="translate(${(width - item.width) / 2}, ${y})">${item.inner}</g>`;
    y += item.height + gap;
    return group;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${groups.join("")}</svg>`;
}
