import { test } from "node:test";
import assert from "node:assert/strict";
import { generateProceduralPortrait } from "../js/portraitGenerator.js";

test("generateProceduralPortrait is deterministic: the same character id always yields the exact same image", () => {
  const a = generateProceduralPortrait({ id: "npc_123", sex: "M", name: "Juan" });
  const b = generateProceduralPortrait({ id: "npc_123", sex: "M", name: "Juan" });
  assert.equal(a, b);
});

test("generateProceduralPortrait returns a well-formed SVG data URI", () => {
  const uri = generateProceduralPortrait({ id: "npc_1", sex: "M" });
  assert.match(uri, /^data:image\/svg\+xml,/);
  const svg = decodeURIComponent(uri.replace("data:image/svg+xml,", ""));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 100 100">/);
  assert.match(svg, /<\/svg>$/);
  // Every inner element (everything but the outer <svg>...</svg> wrapper) should be self-closed —
  // a mismatch here would mean truncated/malformed markup from the string concatenation.
  const innerOpens = (svg.match(/<(circle|ellipse|path|rect)\b/g) || []).length;
  const selfClosings = (svg.match(/\/>/g) || []).length;
  assert.equal(innerOpens, selfClosings, "every inner element should be self-closed (no unclosed tags)");
});

test("generateProceduralPortrait produces meaningfully varied output across different characters", () => {
  const outputs = new Set();
  for (let i = 0; i < 40; i++) {
    outputs.add(generateProceduralPortrait({ id: `npc_${i}`, sex: i % 2 === 0 ? "M" : "F" }));
  }
  // With 6 skin tones x 7 hair colors x 5 eye colors x 7 backgrounds x several hairstyles/facial-hair/
  // eyebrow/mouth combinations, 40 distinct ids should essentially never collide onto the same image.
  assert.ok(outputs.size > 35, `expected strong variety across 40 different ids, got ${outputs.size} distinct outputs`);
});

test("generateProceduralPortrait never gives female characters facial hair", () => {
  for (let i = 0; i < 30; i++) {
    const uri = generateProceduralPortrait({ id: `npc_f_${i}`, sex: "F" });
    const svg = decodeURIComponent(uri.replace("data:image/svg+xml,", ""));
    // A crude but effective check: none of the facial-hair path shapes' distinctive Y-coordinates
    // (used only by mustache/goatee/beard/stubble) should appear when sex is female.
    assert.doesNotMatch(svg, /M40 49 Q50 53 60 49/, `female portrait ${i} unexpectedly has a mustache/goatee shape`);
    assert.doesNotMatch(svg, /M34 44 Q34 62 50 64/, `female portrait ${i} unexpectedly has a full beard shape`);
  }
});

test("generateProceduralPortrait works for names/ids containing special characters without throwing", () => {
  const chars = [
    { id: "npc_ñ_1", sex: "M", name: 'José "El Guero" Núñez' },
    { id: "npc_2", sex: "F", name: "" },
    { id: "npc_3", sex: undefined },
  ];
  for (const c of chars) {
    assert.doesNotThrow(() => generateProceduralPortrait(c));
  }
});
