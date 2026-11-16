/**
 * Checks for the From / To picker: place search, tying picks to the network,
 * and the trips planned between them.   npm run test:picker
 */
import assert from "node:assert/strict";
import seed from "../data/lagos-routes.json";
import type { RouteKB } from "../lib/prompt";
import { composeAnswer, composeNoTrip } from "../lib/compose-answer";
import { PICKER_PLACES, isInLagosArea, nearestPlaces, placeById, searchPlaces } from "../lib/lagos-places";
import { LAGOS_STOPS, haversineKm, type LatLng } from "../lib/lagos-stops";
import { planBetween, resolveToNetwork } from "../lib/route-planner";

const kb = seed as unknown as RouteKB;
let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${(e as Error).message}`);
    process.exitCode = 1;
  }
}

const at = (id: string) => {
  const p = placeById(id);
  assert.ok(p, `unknown place ${id}`);
  const r = resolveToNetwork(kb, p.name, p.pos);
  assert.ok(r, `${p.name} is not within reach of a served stop`);
  return r;
};
const trip = (from: string, to: string) => planBetween(kb, at(from), at(to));

console.log(`${PICKER_PLACES.length} places in the picker`);

check("every place has a unique id and sits inside Lagos", () => {
  const ids = new Set(PICKER_PLACES.map((p) => p.id));
  assert.equal(ids.size, PICKER_PLACES.length);
  // Stops reach into Ogun on purpose; the gazetteer must not.
  for (const p of PICKER_PLACES.filter((p) => p.kind !== "stop")) {
    assert.ok(isInLagosArea(p.pos), `${p.name} is outside Lagos: ${p.pos}`);
    assert.ok(p.lga, `${p.name} has no LGA`);
  }
});

check("gazetteer covers all 20 LGAs", () => {
  const lgas = new Set(PICKER_PLACES.map((p) => p.lga).filter(Boolean));
  assert.equal(lgas.size, 20, `only ${lgas.size}: ${[...lgas].join(", ")}`);
});

check("search finds names, aliases and misspellings", () => {
  assert.equal(searchPlaces("yaba")[0].name, "Yaba");
  assert.equal(searchPlaces("VI")[0].name, "Victoria Island");
  assert.equal(searchPlaces("oshodhi")[0].name, "Oshodi");
  assert.equal(searchPlaces("Ọ̀ṣọ́dì")[0].name, "Oshodi");
  assert.ok(searchPlaces("lek").some((p) => p.name === "Lekki Phase 1"));
  assert.ok(searchPlaces("unilag").some((p) => p.name === "University of Lagos"));
  assert.ok(searchPlaces("computer vil").some((p) => p.name === "Computer Village"));
  assert.equal(searchPlaces("otigba")[0].name, "Computer Village");
  assert.deepEqual(searchPlaces("zzzzqq"), []);
});

check("empty search offers hubs, or what is nearby", () => {
  assert.ok(searchPlaces("").length >= 6);
  const nearYaba = searchPlaces("", 5, LAGOS_STOPS["Yaba"]);
  assert.ok(nearYaba.some((p) => p.name === "Yaba"));
  assert.ok(nearestPlaces(LAGOS_STOPS["Ikeja"], 3).every((p) => haversineKm(p.pos, LAGOS_STOPS["Ikeja"]) < 6));
});

check("stop to stop: same trip as a typed request", () => {
  const plan = trip("stop:CMS", "stop:Ikeja");
  assert.equal(plan.status, "ok");
  assert.equal(plan.best!.from, "CMS");
  assert.equal(plan.best!.to, "Ikeja");
  assert.ok(plan.best!.fare[0] > 0);
});

check("place to place: access legs start and end at the picked places", () => {
  const plan = trip("place:computer-village", "place:university-of-lagos");
  assert.equal(plan.status, "ok");
  const legs = plan.best!.legs;
  assert.equal(plan.best!.from, "Computer Village");
  assert.equal(plan.best!.to, "University of Lagos");
  assert.ok(legs.some((l) => !["walk", "keke"].includes(l.mode)), "no bus leg");
  const text = composeAnswer(plan, "en")!;
  assert.match(text, /Computer Village/);
  assert.match(text, /University of Lagos/);
  assert.match(text, /₦/);
});

check("two near places: a walk or keke, not a bus detour", () => {
  const a = at("stop:CMS");
  const b = at("stop:Marina");
  const plan = planBetween(kb, a, b);
  assert.equal(plan.status, "ok");
  assert.equal(plan.best!.legs.length, 1);
  assert.equal(plan.best!.legs[0].mode, "walk");
  assert.doesNotMatch(composeAnswer(plan, "en")!, /How to pay/);
});

check("same place is refused, not routed", () => {
  const plan = trip("stop:Yaba", "stop:Yaba");
  assert.equal(plan.status, "same-place");
  assert.match(composeNoTrip(plan, "en")!, /already at Yaba/);
});

check("current location: starts with the way to the nearest served stop", () => {
  // 700 m north-east of Yaba bus stop.
  const here: LatLng = [LAGOS_STOPS["Yaba"][0] + 0.005, LAGOS_STOPS["Yaba"][1] + 0.004];
  const origin = resolveToNetwork(kb, "your location", here);
  assert.ok(origin);
  assert.equal(origin.stop, "Yaba");
  const plan = planBetween(kb, origin, at("stop:Ajah"), "location");
  assert.equal(plan.status, "ok");
  assert.equal(plan.best!.legs[0].mode, "walk");
  assert.equal(plan.best!.legs[0].from, "your location");
  assert.match(composeAnswer(plan, "en")!, /Starting from Yaba, the stop nearest to you/);
});

check("a position far from any served stop is not tied to one", () => {
  assert.equal(resolveToNetwork(kb, "the lagoon", [6.2, 3.9]), null);
});

check("every pair of picks gives a trip or an honest refusal, in all five languages", () => {
  const sample = PICKER_PLACES.filter((_, i) => i % 7 === 0);
  let ok = 0;
  let total = 0;
  for (const a of sample) {
    const from = resolveToNetwork(kb, a.name, a.pos);
    if (!from) continue;
    for (const b of sample) {
      if (a === b) continue;
      const to = resolveToNetwork(kb, b.name, b.pos);
      if (!to) continue;
      total++;
      const plan = planBetween(kb, from, to);
      for (const lang of ["en", "pcm", "yo", "ig", "ha"] as const) {
        const text = plan.best ? composeAnswer(plan, lang) : composeNoTrip(plan, lang);
        assert.ok(text && text.length > 20, `${a.name} → ${b.name} (${lang}) has no answer`);
        assert.doesNotMatch(text, /undefined|NaN|null/, `${a.name} → ${b.name} (${lang}): ${text}`);
      }
      if (plan.best) {
        ok++;
        assert.equal(plan.best.from, a.name);
        assert.equal(plan.best.to, b.name);
        assert.ok(plan.best.fare[0] <= plan.best.fare[1]);
      }
    }
  }
  console.log(`      ${ok}/${total} sampled pairs planned`);
  assert.ok(ok / total > 0.9, `only ${ok}/${total} pairs planned`);
});

console.log(process.exitCode ? "\nFAILED" : `\n${passed} checks passed`);
