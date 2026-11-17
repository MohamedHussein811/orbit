// Builds the new tab page's Orbit Gallery from Pixabay: wide HD videos, a dozen per category, with
// a still frame for each. Only the list is stored; the page downloads what a person picks straight
// from Pixabay's CDN, so the API key is used here only, never by the browser.
// The key is read from PIXABAY_KEY or keys/pixabay.txt.
//   node tools/gallery.mjs --candidates=<file.json>   writes candidates per category to pick from
//   node tools/gallery.mjs                            writes extension/src/newtab/gallery.json from PICKS
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "extension", "src", "newtab", "gallery.json");
const API = "https://pixabay.com/api/videos/";
const VIDEO_WIDTH = 1920;
/** The page keeps the chosen video on the device, so very large files are left out. */
const MAX_VIDEO_BYTES = 40_000_000;
const CANDIDATES = 36;
const LICENSE = "Pixabay Content License";
const LICENSE_URL = "https://pixabay.com/service/license-summary/";

/** Pixabay searches for each of Orbit's categories, and tags a result must carry to count. */
const CATEGORIES = {
  summer: { q: ["beach", "tropical beach", "ocean waves", "palm beach", "beach drone"], must: /beach|ocean|sea|waves|palm|coast|tropical/ },
  animals: { q: ["animals", "wildlife", "fish reef", "jellyfish", "birds", "deer", "horses", "whale"], must: /animal|wildlife|fish|jellyfish|bird|deer|horse|whale|tiger|lion|wolf|fox|turtle|swan|dolphin|elephant|kangaroo|bear|owl|eagle/ },
  space: { q: ["space", "galaxy", "nebula", "stars", "aurora", "milky way", "earth space", "planet"], must: /space|galaxy|nebula|\bstars?\b|aurora|milky way|universe|cosmos|planet|astronomy|night sky|moon/ },
  travel: { q: ["travel", "old town", "castle", "venice", "santorini", "mountain road", "village"], must: /travel|town|castle|venice|santorini|road|village|city|tourism|landmark|architecture|lake/ },
  love: { q: ["love", "romantic", "flowers", "roses", "hearts", "cherry blossom", "sunset couple"], must: /love|romantic|romance|flower|rose|heart|blossom|couple|valentine|tulip/ },
  sport: { q: ["sport", "surfing", "skiing", "snowboard", "sailing", "paragliding", "cycling", "kayak"], must: /sport|surf|\bski|snowboard|sail|paraglid|cycl|bike|kayak|climb|\brun|skate|athlete/ },
  people: { q: ["people", "crowd", "festival", "dancing", "lanterns", "friends", "street people"], must: /people|person|crowd|festival|danc|lantern|friends|woman|\bman\b|girl|boy|family|children|pedestrian/ },
  city: { q: ["city", "skyline", "city night", "cityscape", "downtown", "skyscraper", "city traffic"], must: /city|skyline|urban|downtown|skyscraper|metropolis|cityscape|buildings/ },
  things: { q: ["candle", "coffee", "vinyl", "hourglass", "bokeh", "fireplace", "books", "clock"], must: /candle|coffee|vinyl|record|hourglass|bokeh|fireplace|book|clock|tea|lamp|watch|globe|guitar|piano/ },
  nature: { q: ["nature", "waterfall", "forest", "mountains", "lake", "river", "clouds mountains"], must: /nature|waterfall|forest|mountain|lake|river|landscape|trees|valley|meadow/ },
  christmas: { q: ["christmas", "christmas tree", "christmas lights", "snowfall", "winter village", "santa"], must: /christmas|xmas|santa|snow|winter|ornament|holiday|advent/ },
  abstractions: { q: ["abstract", "ink water", "fluid", "smoke", "particles", "liquid", "fractal"], must: /abstract|ink|fluid|smoke|particle|liquid|fractal|pattern|texture|psychedelic|kaleidoscope|bubbles/ },
};

/** Subjects that do not belong behind a new tab page. */
const UNSUITABLE = /war|weapon|gun|blood|dead|death|funeral|cemetery|protest|police|accident|crash|fire truck|burning|smoking|cigarette|alcohol|beer|wine|nude|bikini|meat|insect|spider|snake|text|logo|countdown|green screen|chroma|vertical|portrait/i;

/** Videos chosen by hand from the candidates (node tools/gallery.mjs --candidates=<file.json>). */
const PICKS = {
  summer: [140111, 70796, 135658, 24216, 6399, 204565, 199001, 19609, 65560, 28268, 53127, 7262],
  animals: [13704, 21723, 27400, 1287, 46026, 2797, 26818, 145320, 85674, 213616, 51594, 79087],
  space: [169951, 90877, 137087, 107129, 29238, 17246, 232408, 106311, 90875, 20763, 121878, 164014],
  travel: [11490, 178732, 3581, 153167, 292827, 23232, 24746, 175876, 277097, 89244, 31556, 25171],
  love: [16453, 3654, 152798, 163869, 10737, 20454, 153999, 268528, 164215, 32021, 16459, 42814],
  sport: [81945, 110734, 3588, 36609, 8558, 82636, 69371, 41347, 275498, 50109, 49509, 6415],
  people: [6387, 84973, 23258, 91, 6096, 1630, 3630, 188778, 24603, 12333, 27057, 13777],
  city: [21985, 19627, 91744, 3134, 80724, 173137, 31956, 180386, 7260, 88921, 63970, 3249],
  things: [65390, 27230, 8437, 57307, 143419, 34855, 46989, 3595, 15629, 70216, 190776, 4878],
  nature: [37088, 23881, 49981, 59291, 18420, 7127, 24515, 14205, 174860, 158229, 22512, 31175],
  christmas: [142579, 192649, 3565, 21061, 141964, 12396, 568, 8124, 28919, 93455, 14362, 13236],
  abstractions: [21536, 20072, 27803, 91069, 13100, 58193, 35506, 3068, 98064, 107303, 27915, 183136],
};

function apiKey() {
  const fromEnv = process.env.PIXABAY_KEY?.trim();
  if (fromEnv) return fromEnv;
  const file = path.join(ROOT, "keys", "pixabay.txt");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  throw new Error("Set PIXABAY_KEY or write the key to keys/pixabay.txt");
}

const KEY = apiKey();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One API request, kept well under the limit of 100 requests a minute. */
async function api(params) {
  await sleep(800);
  const response = await fetch(`${API}?${new URLSearchParams({ key: KEY, ...params })}`);
  if (!response.ok) throw new Error(`Pixabay ${response.status} ${await response.text()}`);
  return response.json();
}

/** The rendition closest to full HD that is at least that wide. */
function rendition(videos) {
  return Object.values(videos ?? {})
    .filter((file) => file?.url && file.width >= VIDEO_WIDTH && file.width / file.height >= 1.7)
    .sort((a, b) => a.width - b.width || a.size - b.size)[0];
}

function titleOf(hit) {
  const text = String(hit.description || hit.name || hit.tags || "").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function itemOf(hit) {
  const file = rendition(hit.videos);
  if (!file || file.size > MAX_VIDEO_BYTES || hit.isAiGenerated || hit.isLowQuality || hit.isGRated === false) return null;
  if (hit.duration < 8 || hit.duration > 120) return null;
  if (UNSUITABLE.test(`${hit.tags} ${hit.description ?? ""}`)) return null;
  return {
    id: hit.id,
    title: titleOf(hit),
    page: hit.pageURL,
    poster: file.thumbnail,
    video: file.url,
    author: hit.user,
    license: LICENSE,
    licenseUrl: LICENSE_URL,
    likes: hit.likes,
    size: file.size,
  };
}

async function candidates(category) {
  const seen = new Map();
  const { q: queries, must } = CATEGORIES[category];
  for (const q of queries) {
    const data = await api({ q, video_type: "film", order: "popular", min_width: String(VIDEO_WIDTH), safesearch: "true", per_page: "60" });
    for (const hit of data.hits ?? []) {
      const item = itemOf(hit);
      if (item && must.test(hit.tags) && !seen.has(item.id)) seen.set(item.id, item);
    }
  }
  return [...seen.values()].sort((a, b) => b.likes - a.likes).slice(0, CANDIDATES);
}

const review = process.argv.find((arg) => arg.startsWith("--candidates="))?.slice(13);
if (review) {
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
  const out = fs.existsSync(review) ? JSON.parse(fs.readFileSync(review, "utf8")) : {};
  for (const category of Object.keys(CATEGORIES)) {
    if (only && !only.includes(category)) continue;
    out[category] = await candidates(category);
    console.log(`${category}: ${out[category].length}`);
  }
  fs.writeFileSync(review, JSON.stringify(out, null, 1));
  process.exit(0);
}

const gallery = { source: "Pixabay", built: new Date().toISOString().slice(0, 10), categories: {} };
for (const [category, ids] of Object.entries(PICKS)) {
  gallery.categories[category] = [];
  for (const id of ids) {
    const item = itemOf((await api({ id: String(id) })).hits?.[0] ?? {});
    if (!item) {
      console.error(`  dropped: ${category} ${id}`);
      continue;
    }
    const { id: _id, likes: _likes, size: _size, ...kept } = item;
    gallery.categories[category].push(kept);
  }
  console.log(`${category}: ${gallery.categories[category].length}`);
}
fs.writeFileSync(OUT, `${JSON.stringify(gallery, null, 1)}\n`);
console.log(`wrote ${OUT}`);
