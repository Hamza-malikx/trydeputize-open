import assert from "node:assert/strict";
import { test } from "node:test";

const model = (await import(
  new URL("./barcode-model.ts", import.meta.url).href
)) as typeof import("./barcode-model");

const by = (id: string) => model.symbologyById(id);

test("mod-10 check digits match published GS1 examples", () => {
  assert.equal(model.mod10CheckDigit("400638133393"), 1); // EAN-13 4006381333931
  assert.equal(model.mod10CheckDigit("9638507"), 4); // EAN-8 96385074
  assert.equal(model.mod10CheckDigit("03600029145"), 2); // UPC-A 036000291452
  assert.equal(model.mod10CheckDigit("1234567890123"), 1); // ITF-14 12345678901231
});

test("EAN-13 adds the check digit to 12 digits and says so", () => {
  const prepared = by("ean13").prepare("400638133393");
  assert.deepEqual(prepared, { ok: true, value: "4006381333931", note: "Check digit 1 added." });
});

test("EAN-13 accepts spaces and hyphens the way people type ISBNs", () => {
  const prepared = by("ean13").prepare("978-3-16-148410-0");
  assert.ok(prepared.ok);
  assert.equal(prepared.value, "9783161484100");
  assert.equal(prepared.note, "Check digit verified.");
});

test("EAN-13 rejects a wrong check digit and names the right one", () => {
  const prepared = by("ean13").prepare("4006381333935");
  assert.ok(!prepared.ok);
  assert.match(prepared.message, /it is 1, not 5/);
});

test("EAN-13 explains the length it needs", () => {
  const prepared = by("ean13").prepare("12345");
  assert.ok(!prepared.ok);
  assert.match(prepared.message, /needs 12 digits .* or all 13\. You typed 5/);
});

test("digit-only symbologies name the foreign characters", () => {
  const prepared = by("upca").prepare("0360002914A");
  assert.ok(!prepared.ok);
  assert.match(prepared.message, /digits only\. Remove: A\./);
});

test("EAN-8, UPC-A and ITF-14 take body-plus-check like EAN-13", () => {
  assert.deepEqual(by("ean8").prepare("9638507"), {
    ok: true,
    value: "96385074",
    note: "Check digit 4 added.",
  });
  assert.deepEqual(by("upca").prepare("03600029145"), {
    ok: true,
    value: "036000291452",
    note: "Check digit 2 added.",
  });
  assert.deepEqual(by("itf14").prepare("1234567890123"), {
    ok: true,
    value: "12345678901231",
    note: "Check digit 1 added.",
  });
});

test("UPC-E expands to the UPC-A it stands for", () => {
  // 123456 with last digit 6 squeezes to 01234500006 + check.
  assert.equal(model.upceToUpca("123456", "0"), "012345000065");
  // Last digit 0: XX00000XXX.
  assert.equal(model.upceToUpca("654320", "0"), "065000004328");
});

test("UPC-E takes six digits, rejects seven, and verifies eight", () => {
  const six = by("upce").prepare("123456");
  assert.ok(six.ok);
  assert.equal(six.value, "123456");
  assert.equal(six.note, "Reads as UPC-A 012345000065.");

  const seven = by("upce").prepare("1234567");
  assert.ok(!seven.ok);
  assert.match(seven.message, /ambiguous/);

  const eight = by("upce").prepare("01234565");
  assert.ok(eight.ok);
  assert.equal(eight.value, "01234565");

  const wrong = by("upce").prepare("01234561");
  assert.ok(!wrong.ok);
  assert.match(wrong.message, /it is 5, not 1/);

  const system = by("upce").prepare("21234565");
  assert.ok(!system.ok);
  assert.match(system.message, /starts with 0 or 1/);
});

test("Code 128 takes any printable ASCII and rejects the rest by name", () => {
  assert.deepEqual(by("code128").prepare("  TD-2026/0001 x  "), {
    ok: true,
    value: "TD-2026/0001 x",
  });
  const accented = by("code128").prepare("café");
  assert.ok(!accented.ok);
  assert.match(accented.message, /ASCII only.*Remove: é\./);
  const long = by("code128").prepare("x".repeat(81));
  assert.ok(!long.ok);
  assert.match(long.message, /under 80 characters.*This one is 81/);
});

test("Code 39 capitalises and says so, and names foreign characters", () => {
  assert.deepEqual(by("code39").prepare("asset 4471"), {
    ok: true,
    value: "ASSET 4471",
    note: "Shown in capitals: Code 39 has no lowercase letters.",
  });
  const plain = by("code39").prepare("ASSET 4471");
  assert.ok(plain.ok);
  assert.equal(plain.note, undefined);
  const bad = by("code39").prepare("A&B");
  assert.ok(!bad.ok);
  assert.match(bad.message, /Remove: &\./);
});

test("Codabar wraps bare digits in A start and stop letters and keeps explicit ones", () => {
  const bare = by("codabar").prepare("31117013206375");
  assert.ok(bare.ok);
  assert.equal(bare.value, "A31117013206375A");
  assert.match(bare.note ?? "", /Start and stop letters/);
  assert.deepEqual(by("codabar").prepare("b12345c"), { ok: true, value: "B12345C" });
  const bad = by("codabar").prepare("A12x45B");
  assert.ok(!bad.ok);
  assert.match(bad.message, /Remove: X\./);
  const half = by("codabar").prepare("A12345");
  assert.ok(!half.ok);
  assert.match(half.message, /start letter and one stop letter/);
});

test("every symbology's example prepares cleanly", () => {
  for (const symbology of model.SYMBOLOGIES) {
    const prepared = symbology.prepare(symbology.example);
    assert.ok(prepared.ok, `${symbology.id}: ${prepared.ok ? "" : prepared.message}`);
  }
});

test("parseLines keeps non-empty trimmed lines and caps the batch", () => {
  assert.deepEqual(model.parseLines("  one \n\n two\r\n\n"), { codes: ["one", "two"], dropped: 0 });
  const many = Array.from({ length: model.MAX_CODES + 3 }, (_, i) => `c${i}`).join("\n");
  const parsed = model.parseLines(many);
  assert.equal(parsed.codes.length, model.MAX_CODES);
  assert.equal(parsed.dropped, 3);
});

test("fileStem names the file after the symbology and the value", () => {
  assert.equal(model.fileStem("ean13", "4006381333931"), "ean13-4006381333931");
  assert.equal(model.fileStem("code128", "Hello, world! / 2026"), "code128-Hello-world-2026");
  assert.equal(model.fileStem("code128", "///"), "code128");
  assert.equal(model.fileStem("code39", "A".repeat(60)).length, "code39-".length + 40);
});

test("encoderOptions turns transparent into jsbarcode's empty background", () => {
  const opaque = model.encoderOptions(model.DEFAULT_LOOK);
  assert.equal(opaque.background, "#ffffff");
  assert.equal(opaque.lineColor, "#000000");
  assert.equal(opaque.width, 2);
  const clear = model.encoderOptions({ ...model.DEFAULT_LOOK, transparent: true });
  assert.equal(clear.background, "");
});

const fakeSvg = (width: number, height: number, body: string) =>
  `<svg width="${width}px" height="${height}px" x="0px" y="0px" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" version="1.1" style="transform: translate(0,0)">${body}</svg>`;

test("svgSize reads the pixel size jsbarcode wrote", () => {
  assert.deepEqual(model.svgSize(fakeSvg(212, 128, "")), { width: 212, height: 128 });
});

test("composeSheet stacks codes vertically, centred on the widest", () => {
  const sheet = model.composeSheet(
    [fakeSvg(100, 50, "<rect id='a'/>"), fakeSvg(200, 80, "<rect id='b'/>")],
    20,
  );
  assert.match(sheet, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="200" height="150" viewBox="0 0 200 150">/);
  assert.match(sheet, /<g transform="translate\(50, 0\)"><rect id='a'\/><\/g>/);
  assert.match(sheet, /<g transform="translate\(0, 70\)"><rect id='b'\/><\/g>/);
  assert.equal(model.composeSheet([]), '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" viewBox="0 0 0 0"></svg>');
});
