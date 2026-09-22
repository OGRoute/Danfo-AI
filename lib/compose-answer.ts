/**
 * The complete answer for a planned trip, written from the computed plan in
 * the rider's language: a summary, one numbered step per vehicle (where to
 * board, where to get off, fare, time), how to pay, the best alternative with
 * a computed comparison, and tips.
 *
 * Yoruba, Igbo and Hausa answers come from these sentence templates rather
 * than the 0G testnet model, which can't write those languages reliably.
 * Place names, boarding points and ₦ amounts stay exactly as in the route data.
 */
import type { LangCode } from "./language-detect";
import {
  formatMinutes,
  formatNaira,
  type Itinerary,
  type TripLeg,
  type TripPlan,
} from "./route-planner";

const PAYS_BY_CARD = new Set(["brt", "rail", "ferry"]);
// Walking costs nothing, so it never appears in "how to pay".
const FREE_MODES = new Set(["walk"]);
const ROAD_MODES = new Set(["danfo", "brt", "keke"]);

const range = ([lo, hi]: [number, number]) => (lo === hi ? `${lo}` : `${lo}–${hi}`);
const distance = (km?: number) =>
  km == null ? "" : km < 1 ? `${Math.round((km * 1000) / 50) * 50} m` : `${km.toFixed(1)} km`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const unique = (items: string[]) => Array.from(new Set(items));
/** The place itself, without the extra instructions some boarding points carry. */
const boardPlace = (leg: TripLeg) => leg.board.split(" — ")[0];
const lineSuffix = (leg: TripLeg) => (leg.line && leg.mode !== "danfo" ? ` (${leg.line})` : "");

/** -1 = cheaper / faster, 1 = dearer / slower, 0 = about the same. */
function compare(alt: Itinerary, best: Itinerary) {
  const mid = (r: [number, number]) => (r[0] + r[1]) / 2;
  const cost = mid(alt.fare) - mid(best.fare);
  const time = alt.duration && best.duration ? mid(alt.duration) - mid(best.duration) : 0;
  return {
    money: cost < -50 ? -1 : cost > 50 ? 1 : 0,
    speed: time < -5 ? -1 : time > 5 ? 1 : 0,
  } as const;
}

interface Writer {
  /** Vehicle name as used in a sentence ("the BRT bus", "ọkọ̀ BRT"). */
  vehicle: Record<string, string>;
  /** Walking to or from a street the rider named. */
  walk: (n: number, leg: TripLeg, dist: string, time: string | null) => string;
  /** Shorter vehicle name for lists ("BRT bus"); defaults to `vehicle`. */
  short?: Record<string, string>;
  time: (minutes: [number, number]) => string;
  summary: (it: Itinerary, fare: string, time: string | null) => string;
  nearest: (stop: string) => string;
  substitute: (requested: string, used: string, km: number) => string;
  step: (n: number, leg: TripLeg, fare: string, time: string | null) => string;
  pay: (cash: string[], card: string[]) => string;
  alternative: (alt: Itinerary, legs: string, fare: string, time: string | null, cmp: ReturnType<typeof compare>) => string;
  altLeg: (vehicle: string, to: string) => string;
  then: string;
  tips: (it: Itinerary) => string;
}

const EN: Writer = {
  vehicle: { danfo: "a danfo (yellow bus)", brt: "the BRT bus", rail: "the train", ferry: "the ferry", keke: "a keke", walk: "a walk" },
  short: { danfo: "danfo", brt: "BRT bus", rail: "train", ferry: "ferry", keke: "keke", walk: "walk" },
  walk: (n, leg, dist, time) =>
    `${n}. Walk about ${dist} from ${leg.from} to ${leg.to}${time ? ` (about ${time})` : ""}.`,
  time: formatMinutes,
  summary: (it, fare, time) =>
    `From ${it.from} to ${it.to}: ${it.legs.length === 1 ? "1 vehicle" : `${it.legs.length} vehicles`}, ${fare} in total${time ? `, about ${time}` : ""}.`,
  nearest: (stop) => `Starting from ${stop}, the stop nearest to you.`,
  substitute: (requested, used, km) =>
    `${requested} isn't on a mapped route, so the trip uses ${used} (about ${km} km away — a short keke ride).`,
  step: (n, leg, fare, time) =>
    `${n}. Take ${EN.vehicle[leg.mode] ?? leg.mode}${lineSuffix(leg)} from ${leg.board}. Get off at ${leg.alight}. ` +
    `Fare: ${fare}${leg.estimated ? " (estimate)" : ""}${time ? `, about ${time}` : ""}.`,
  pay: (cash, card) => {
    const parts: string[] = [];
    if (cash.length) parts.push(`pay cash on the ${cash.join(" and ")} (exact change helps)`);
    if (card.length) parts.push(`use a Cowry card on the ${card.join(" and ")} (buy or top up at the terminal)`);
    return `How to pay: ${parts.join("; ")}.`;
  },
  altLeg: (vehicle, to) => `${vehicle} to ${to}`,
  then: ", then ",
  alternative: (alt, legs, fare, time, cmp) =>
    `Other option: ${capitalise(legs)} — ${fare}${time ? `, about ${time}` : ""}. ` +
    `Board the first one at ${boardPlace(alt.legs[0])}. ` +
    `It ${["is cheaper", "costs about the same", "costs more"][cmp.money + 1]} and ${["is faster", "takes about as long", "is slower"][cmp.speed + 1]}.`,
  tips: (it) => {
    // Practical notes from the route data, minus what the answer already covers.
    const notes: string[] = [];
    for (const leg of it.legs) {
      for (const sentence of (leg.notes ?? "").split(/(?<=\.)\s+/)) {
        const s = sentence.trim();
        if (!s || /fare|₦|cowry card/i.test(s) || notes.includes(s)) continue;
        notes.push(/[.!?]$/.test(s) ? s : `${s}.`);
      }
    }
    return `Tips: ${[...notes.slice(0, 3), "Fares change often, so treat these prices as estimates."].join(" ")}`;
  },
};

const PCM: Writer = {
  vehicle: { danfo: "danfo", brt: "BRT bus", rail: "train", ferry: "ferry", keke: "keke", walk: "waka" },
  walk: (n, leg, dist, time) =>
    `${n}. Waka small — about ${dist} from ${leg.from} go ${leg.to}${time ? ` (e fit take ${time})` : ""}.`,
  time: (r) => `${range(r)} minutes`,
  summary: (it, fare, time) =>
    `From ${it.from} go ${it.to}: ${it.legs.length === 1 ? "na one motor you go enter" : `you go enter ${it.legs.length} motor`}, ` +
    `e go cost you ${fare} altogether${time ? `, e fit take about ${time}` : ""}.`,
  nearest: (stop) => `We start from ${stop}, the bus stop wey near you pass.`,
  substitute: (requested, used, km) =>
    `${requested} no dey our route list, so we use ${used} (about ${km} km from there — take keke reach am).`,
  step: (n, leg, fare, time) =>
    `${n}. Enter ${PCM.vehicle[leg.mode] ?? leg.mode}${lineSuffix(leg)} for ${boardPlace(leg)}` +
    `${leg.towards ? ` (the one wey dey go ${leg.towards})` : ""}. Drop for ${leg.alight}. ` +
    `Fare: ${fare}${leg.estimated ? " (na estimate)" : ""}${time ? `, about ${time}` : ""}.`,
  pay: (cash, card) => {
    const parts: string[] = [];
    if (cash.length) parts.push(`pay cash for the ${cash.join(" and ")} (get change ready)`);
    if (card.length) parts.push(`use Cowry card for the ${card.join(" and ")} (buy or top am up for the terminal)`);
    return `How you go pay: ${parts.join("; ")}.`;
  },
  altLeg: (vehicle, to) => `${vehicle} reach ${to}`,
  then: ", then ",
  alternative: (alt, legs, fare, time, cmp) =>
    `Another way: ${capitalise(legs)} — ${fare}${time ? `, about ${time}` : ""}. ` +
    `Enter the first one for ${boardPlace(alt.legs[0])}. ` +
    `Dis one ${["cheap pass", "cost near the same", "cost pass"][cmp.money + 1]}, and ${["e fast pass", "e go take near the same time", "e go take more time"][cmp.speed + 1]}.`,
  tips: (it) =>
    `Tips: ${it.legs.some((l) => ROAD_MODES.has(l.mode)) ? "For rush hour (6–9 for morning, 4–8 for evening), add 30–60 minutes. " : ""}` +
    "Fare dey change well well, so take these prices as estimate.",
};

const YO: Writer = {
  vehicle: { danfo: "ọkọ̀ danfo", brt: "ọkọ̀ BRT", rail: "ọkọ̀ ojú irin", ferry: "ọkọ̀ ojú omi", keke: "kẹ̀kẹ́ Maruwa", walk: "ìrìn" },
  walk: (n, leg, dist, time) =>
    `${n}. Rìn nǹkan bí ${dist} láti ${leg.from} sí ${leg.to}${time ? ` (ó máa gbà tó ${time})` : ""}.`,
  time: (r) => `ìṣẹ́jú ${range(r)}`,
  summary: (it, fare, time) =>
    `Láti ${it.from} sí ${it.to}: ${it.legs.length === 1 ? "ọkọ̀ kan ṣoṣo ni o máa wọ̀" : `ọkọ̀ ${it.legs.length} ni o máa wọ̀`}. ` +
    `Owó ọkọ̀ lápapọ̀ jẹ́ ${fare}${time ? `, ó sì máa gbà tó ${time}` : ""}.`,
  nearest: (stop) => `A bẹ̀rẹ̀ láti ${stop}, ibùdókọ̀ tó sún mọ́ ọ jù lọ.`,
  substitute: (requested, used, km) =>
    `${requested} kò sí lára àwọn ọ̀nà wa, nítorí náà a lo ${used} (tó jìnnà tó ${km} km — gun kẹ̀kẹ́ débẹ̀).`,
  step: (n, leg, fare, time) =>
    `${n}. Wọ ${YO.vehicle[leg.mode] ?? leg.mode}${lineSuffix(leg)} ní ${boardPlace(leg)}` +
    `${leg.towards ? ` (èyí tó ń lọ sí ${leg.towards})` : ""}. Bọ́ sílẹ̀ ní ${leg.alight}. ` +
    `Owó ọkọ̀: ${fare}${leg.estimated ? " (ìṣirò ni)" : ""}${time ? `, tó ${time}` : ""}.`,
  pay: (cash, card) => {
    const parts: string[] = [];
    if (cash.length) parts.push(`san owó ní ọwọ́ fún ${cash.join(" àti ")} (mú ṣẹ́ǹjì dání)`);
    if (card.length) parts.push(`lo káàdì Cowry fún ${card.join(" àti ")} (ra á tàbí fi owó kún un ní ibùdókọ̀)`);
    return `Bí o ṣe máa sanwó: ${parts.join("; ")}.`;
  },
  altLeg: (vehicle, to) => `${vehicle} dé ${to}`,
  then: ", lẹ́yìn náà ",
  alternative: (alt, legs, fare, time, cmp) =>
    `Ọ̀nà mìíràn: ${capitalise(legs)} — ${fare}${time ? `, tó ${time}` : ""}. ` +
    `Wọ èkínní ní ${boardPlace(alt.legs[0])}. ` +
    `Ọ̀nà yìí ${["kò wọ́n tó", "fẹ́rẹ̀ẹ́ jẹ́ owó kan náà", "wọ́n jù"][cmp.money + 1]}, ó sì ${["yára jù", "fẹ́rẹ̀ẹ́ gba àkókò kan náà", "pẹ́ jù"][cmp.speed + 1]}.`,
  tips: (it) =>
    `Ìmọ̀ràn: ${it.legs.some((l) => ROAD_MODES.has(l.mode)) ? "Ní àkókò súnkẹrẹ-fàkẹrẹ (aago 6–9 àárọ̀ àti 4–8 ìrọ̀lẹ́), fi ìṣẹ́jú 30–60 kún àkókò rẹ. " : ""}` +
    "Owó ọkọ̀ máa ń yípadà, nítorí náà ìṣirò ni àwọn owó wọ̀nyí.",
};

const IG: Writer = {
  vehicle: { danfo: "ụgbọ ala danfo", brt: "ụgbọ ala BRT", rail: "ụgbọ oloko", ferry: "ụgbọ mmiri", keke: "keke", walk: "ije ụkwụ" },
  walk: (n, leg, dist, time) =>
    `${n}. Jiri ụkwụ gaa ihe dị ka ${dist} site na ${leg.from} ruo ${leg.to}${time ? ` (ihe dị ka ${time})` : ""}.`,
  time: (r) => `nkeji ${range(r)}`,
  summary: (it, fare, time) =>
    `Site na ${it.from} gaa ${it.to}: ${it.legs.length === 1 ? "ị ga-abanye naanị otu ụgbọ" : `ị ga-abanye ụgbọ ${it.legs.length}`}. ` +
    `Ego ụgbọ niile bụ ${fare}${time ? `, ọ ga-ewe ihe dị ka ${time}` : ""}.`,
  nearest: (stop) => `Anyị malitere na ${stop}, ọdụ ụgbọ kacha nso gị.`,
  substitute: (requested, used, km) =>
    `${requested} anọghị n'ụzọ anyị ma, ya mere anyị jiri ${used} (ihe dị ka ${km} km — jiri keke ruo ebe ahụ).`,
  step: (n, leg, fare, time) =>
    `${n}. Banye ${IG.vehicle[leg.mode] ?? leg.mode}${lineSuffix(leg)} na ${boardPlace(leg)}` +
    `${leg.towards ? ` (nke na-aga ${leg.towards})` : ""}. Rịdata na ${leg.alight}. ` +
    `Ụgwọ ụgbọ: ${fare}${leg.estimated ? " (atụmatụ)" : ""}${time ? `, ihe dị ka ${time}` : ""}.`,
  pay: (cash, card) => {
    const parts: string[] = [];
    if (cash.length) parts.push(`kwụọ ego n'aka maka ${cash.join(" na ")} (jikere obere ego)`);
    if (card.length) parts.push(`jiri kaadị Cowry maka ${card.join(" na ")} (zụta ya ma ọ bụ tinye ego na ya n'ọdụ ụgbọ)`);
    return `Otu ị ga-esi kwụọ ụgwọ: ${parts.join("; ")}.`;
  },
  altLeg: (vehicle, to) => `${vehicle} ruo ${to}`,
  then: ", mgbe ahụ ",
  alternative: (alt, legs, fare, time, cmp) =>
    `Ụzọ ọzọ: ${capitalise(legs)} — ${fare}${time ? `, ihe dị ka ${time}` : ""}. ` +
    `Banye nke mbụ na ${boardPlace(alt.legs[0])}. ` +
    `Ụzọ a ${["dị ọnụ ala karịa", "fọrọ nke nta ka ọ hà n'ego", "dị oke ọnụ karịa"][cmp.money + 1]}, ọ ${["na-adị ngwa karịa", "na-ewe ihe dị ka otu oge", "na-ewe oge karịa"][cmp.speed + 1]}.`,
  tips: (it) =>
    `Ndụmọdụ: ${it.legs.some((l) => ROAD_MODES.has(l.mode)) ? "N'oge okporo ụzọ juru (elekere 6–9 ụtụtụ na 4–8 mgbede), gbakwunye nkeji 30–60. " : ""}` +
    "Ego ụgbọ na-agbanwe mgbe niile, ya mere were ego ndị a dị ka atụmatụ.",
};

const HA: Writer = {
  vehicle: { danfo: "motar danfo", brt: "motar BRT", rail: "jirgin ƙasa", ferry: "jirgin ruwa", keke: "keke napep", walk: "tafiya" },
  walk: (n, leg, dist, time) =>
    `${n}. Yi tafiya kusan ${dist} daga ${leg.from} zuwa ${leg.to}${time ? ` (kusan ${time})` : ""}.`,
  time: (r) => `minti ${range(r)}`,
  summary: (it, fare, time) =>
    `Daga ${it.from} zuwa ${it.to}: ${it.legs.length === 1 ? "mota ɗaya kawai za ka hau" : `za ka hau mota ${it.legs.length}`}. ` +
    `Kuɗin mota gaba ɗaya ${fare}${time ? `, zai ɗauki kusan ${time}` : ""}.`,
  nearest: (stop) => `Mun fara daga ${stop}, tashar da ta fi kusa da kai.`,
  substitute: (requested, used, km) =>
    `${requested} ba ya cikin hanyoyinmu, don haka mun yi amfani da ${used} (kusan ${km} km — hau keke napep zuwa can).`,
  step: (n, leg, fare, time) =>
    `${n}. Hau ${HA.vehicle[leg.mode] ?? leg.mode}${lineSuffix(leg)} a ${boardPlace(leg)}` +
    `${leg.towards ? ` (wadda ke zuwa ${leg.towards})` : ""}. Sauka a ${leg.alight}. ` +
    `Kuɗin mota: ${fare}${leg.estimated ? " (ƙiyasi)" : ""}${time ? `, kusan ${time}` : ""}.`,
  pay: (cash, card) => {
    const parts: string[] = [];
    if (cash.length) parts.push(`biya da kuɗi hannu a ${cash.join(" da ")} (ka shirya canji)`);
    if (card.length) parts.push(`yi amfani da katin Cowry a ${card.join(" da ")} (saya ko ka saka masa kuɗi a tasha)`);
    return `Yadda za ka biya: ${parts.join("; ")}.`;
  },
  altLeg: (vehicle, to) => `${vehicle} zuwa ${to}`,
  then: ", sannan ",
  alternative: (alt, legs, fare, time, cmp) =>
    `Wata hanya: ${capitalise(legs)} — ${fare}${time ? `, kusan ${time}` : ""}. ` +
    `Ka hau ta farko a ${boardPlace(alt.legs[0])}. ` +
    `Wannan hanyar ${["ta fi araha", "kuɗinta kusan ɗaya ne", "ta fi tsada"][cmp.money + 1]}, kuma ${["ta fi sauri", "lokacinta kusan ɗaya ne", "ta fi ɗaukar lokaci"][cmp.speed + 1]}.`,
  tips: (it) =>
    `Shawara: ${it.legs.some((l) => ROAD_MODES.has(l.mode)) ? "A lokacin cunkoso (ƙarfe 6–9 na safe da 4–8 na yamma), ƙara minti 30–60. " : ""}` +
    "Kuɗin mota yana canzawa, don haka ka ɗauki waɗannan farashin a matsayin ƙiyasi.",
};

const WRITERS: Record<LangCode, Writer> = { en: EN, pcm: PCM, yo: YO, ig: IG, ha: HA };

export function composeAnswer(plan: TripPlan, language: LangCode = "en"): string | null {
  const best = plan.best;
  if (!best) return null;
  const w = WRITERS[language];
  const time = (r?: [number, number]) => (r ? w.time(r) : null);
  const short = (mode: string) => (w.short ?? w.vehicle)[mode] ?? mode;

  const lines = [w.summary(best, formatNaira(best.fare), time(best.duration))];
  if (plan.originSource === "location") lines.push(w.nearest(best.from));
  for (const s of plan.substitutions) lines.push(w.substitute(s.requested, s.used, s.km));

  lines.push(
    "",
    ...best.legs.map((leg, i) =>
      leg.mode === "walk"
        ? w.walk(i + 1, leg, distance(leg.km), time(leg.duration))
        : w.step(i + 1, leg, formatNaira(leg.fare), time(leg.duration))
    )
  );

  const kinds = (card: boolean) =>
    unique(
      best.legs
        .filter((l) => !FREE_MODES.has(l.mode) && PAYS_BY_CARD.has(l.mode) === card)
        .map((l) => short(l.mode))
    );
  lines.push("", w.pay(kinds(false), kinds(true)));

  const alt = plan.alternatives[0];
  if (alt) {
    const legs = alt.legs.map((l) => w.altLeg(short(l.mode), l.to)).join(w.then);
    lines.push("", w.alternative(alt, legs, formatNaira(alt.fare), time(alt.duration), compare(alt, best)));
  }

  lines.push("", w.tips(best));
  return lines.join("\n");
}
