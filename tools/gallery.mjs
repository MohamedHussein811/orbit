// Builds the new tab page's Orbit Gallery from Wikimedia Commons: wide videos (NASA's among them)
// under licenses that allow reuse with credit, a dozen per category, with a still frame for each.
// Categories with few good videos are topped up with featured photos, which show as pictures.
// Only the list is stored; the page downloads what a person picks.
//   node tools/gallery.mjs --review=<file.html>   writes numbered candidates (and <file>.json) to pick from
//   node tools/gallery.mjs                        writes extension/src/newtab/gallery.json from PICKS
//   node tools/gallery.mjs --sheet=<file.html>   also writes a contact sheet, for review
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "extension", "src", "newtab", "gallery.json");
const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "OrbitGalleryBuild/2.0 (https://github.com/MohamedHussein811/orbit)";
const PER_CATEGORY = 12;
const MIN_VIDEOS = 5;
const POSTER_WIDTH = 1920;
const PHOTO_WIDTH = 2560;

/** Orbit's categories: Commons searches for videos, and featured picture categories for photos. */
const CATEGORIES = {
  summer: { videos: ["drone beach", "tropical beach", "waves beach 4K", "sea coast aerial"], photos: ["Featured pictures of beaches"] },
  animals: { videos: ["coral reef fish", "wildlife 4K", "birds flying slow motion", "deer", "elephants"], photos: ["Featured pictures of mammals", "Featured pictures of birds"] },
  space: { videos: ["earth from ISS timelapse", "Earth from space 4K", "aurora timelapse", "milky way timelapse", "Solar Dynamics Observatory sun 4K"], photos: ["Featured pictures of astronomy"] },
  travel: { videos: ["drone old town aerial", "castle drone", "aerial view village", "mountain road drone", "drone footage aerial view 4K"], photos: ["Featured pictures of architecture", "Featured pictures of villages"] },
  love: { videos: ["flower field", "flowers blooming timelapse", "sunset timelapse", "sunrise sea"], photos: ["Featured pictures of flowers", "Featured pictures of sunsets"] },
  sport: { videos: ["surfing", "kitesurfing", "skiing", "sailing", "paragliding", "rowing"], photos: ["Featured pictures of sports"] },
  people: { videos: ["festival dance", "street timelapse people", "market crowd", "lantern festival"], photos: ["Featured pictures of people"] },
  city: { videos: ["skyline timelapse", "Hong Kong timelapse", "New York City timelapse", "Tokyo night", "Singapore skyline", "cityscape drone", "city night 4K"], photos: ["Featured pictures of cityscapes", "Featured night photography"] },
  things: { videos: ["candle flame", "hourglass", "vinyl record", "typewriter", "pouring coffee", "bokeh lights", "Foucault pendulum"], photos: ["Featured pictures of objects", "Featured still-life photographs"] },
  nature: { videos: ["waterfall 4K", "forest drone", "clouds timelapse mountains", "mountain lake drone", "river forest"], photos: ["Featured pictures of landscapes", "Featured pictures of waterfalls"] },
  christmas: { videos: ["christmas lights", "christmas market", "christmas tree lights", "snowfall"], photos: ["Featured pictures of Christmas"] },
  abstractions: { videos: ["ink in water", "lava flow", "fractal zoom", "soap bubble", "fire flames slow motion", "Mandelbrot"], photos: ["Featured pictures of geology", "Featured pictures of chemistry"] },
};

const LICENSE = /^(CC0|Public domain|PD|CC BY(-SA)? \d\.\d)/i;

/** Subjects that do not belong behind a new tab page, and artwork rather than photos. */
const UNSUITABLE =
  /operation|crossroads|nuclear|military|armed forces|army|soldier|war\b|weapon|gun|begging|rescue|wounded|veteran|injur|skull|dead|death|funeral|cemetery|grave|protest|president|politic|nude|naked|meal|dinner|table|cuisine|painting|illustration|lithograph|drawing|currier|makovsky|calculator|hard disk|cathode|e match|explod|smilodon|fossil|stromatolit|insect|spider|snake|fly\b|tanzfliege|butcher|slaughter|hunting|bullfight|accident|crash|fire department|burning|wildfire|flood|storm damage|hurricane|tornado|police|riot|interview|speech|lecture|conference|news|trailer|advert|tutorial|how to|portrait|vertical|shorts|selfie|vlog/i;

/** Videos chosen by hand from the review sheet (node tools/gallery.mjs --review=<file.html>). */
const PICKS = {
  summer: [
    "File:Beach filmed with a drone.webm",
    "File:An aerial view of Seacliff beach.webm",
    "File:Drone video of Kauksi beach at the Lake Peipus in Estonia (July 2022).webm",
    "File:Aerial view of sand beach. Top view sea waves. Drone footage.webm",
    "File:DJI 0147 Soothing South Coast Waves.webm",
    "File:Sunset in Pantai Kukup.webm",
    "File:Pärnu coastal meadow hiking trail, beach and town in Estonia.webm",
    "File:Scheveningen beach 122951.webm",
  ],
  animals: [
    "File:Tropical Fish Banner Fish on Coral Reef.webm",
    "File:First record of the species Scarus flavipectoralis at the Chesterfield-Bellona reef complex in the Coral Sea Marine Park (Ifremer 00675-78703).webm",
    "File:First records of fish species at the Chesterfield-Bellona reef complex in the Coral Sea Marine Park (Ifremer 00669-78069 - 31562).webm",
    "File:First records of the species Hemitaurichthys polylepis at the Chesterfield-Bellona reef complex in the Coral Sea Marine Park (Ifremer 00675-78693).webm",
    "File:Sicklefin lemon shark observed at the Chesterfield-Bellona reef complex in the Coral Sea Marine Park (Southwest Pacific) (Ifremer 00669-78071).webm",
    "File:Mule Deer foraging at Okanagan Mountain Provincial Park.webm",
    "File:Fallow deer in Dyrehaven 2.webm",
    "File:Fallow deer in Dyrehaven 3.webm",
    "File:Carduelis sinica bathing and flying x40 slowmotion.webm",
  ],
  space: [
    "File:Crew Earth Observations (4K).webm",
    "File:ISS 4K Crew Earth Observations.webm",
    "File:2016-09 Aurora timelapse Saguenay.webm",
    "File:Nordlys i Kjærfjorden.webm",
    "File:Air traffic in the Swiss night sky as seen from Oeschinensee Video by Giles Laurent.webm",
  ],
  travel: [
    "File:Castle ruins in Germany.webm",
    "File:Lake Bled Slovenia Castle.webm",
    "File:Veveří castle castle drone overview.webm",
    "File:Berat 01.webm",
    "File:Kromberg Museum, Nova Gorica, Slovenia 2022.webm",
    "File:Drone video of Põltsamaa river and castle in Estonia.webm",
    "File:Drone video of Haapsalu castle (June 2022).webm",
    "File:Video of Krka river near Žužemberk Castle by TheTokl - 01.webm",
    "File:Drone video of Rakvere in February 2022.ogv",
    "File:Drone video of ruins of Lihula stronghold, the manor and town (august 2021).webm",
  ],
  love: [
    "File:The Flower Fields at Carlsbad Ranch 9 2019-06-10.webm",
    "File:The Flower Fields at Carlsbad Ranch 3 2019-06-10.webm",
    "File:Helianthus annuus fc04.ogg",
    "File:Yellow flowers (AV1 sample).webm",
    "File:The Flower Fields at Carlsbad Ranch 1 2019-06-10.webm",
    "File:The Flower Fields at Carlsbad Ranch 6 2019-06-10.webm",
    "File:Sunset tokyoarea-timelapse-2019-03-17.webm",
    "File:Sunset timelapse in Funchal - 2014.webm",
    "File:Timelapse Joshua Tree Clouds and Sunset Near West Entrance.webm",
    "File:Sunset Near Hidden Valley timelapse (40734114682).webm",
  ],
  sport: [
    "File:Surfing contest - oahu hawaii - north shore - oct 2015.ogv",
    "File:Surfing in Tel Aviv MVI 3675.webm",
    "File:Die Ewige Welle und Surfers in Augsburg.ogv",
    "File:Surfing-1012628, Dingle Peninsula, Co. Kerry, Ireland.webm",
    "File:Wind Surfing-1025737, Dingle Peninsula, Co. Kerry, Ireland.webm",
    "File:Kite surfing at Viganj 163559 1.webm",
    "File:Timelapse - kitesurfing in Mauritius.webm",
    "File:Sailing to Orebić 151837.webm",
    "File:Sailing from Orebić 104037.webm",
    "File:Sailing in sunrise, Pelješac channel 072745.webm",
  ],
  people: [
    "File:Garba dance during Navaratri festival in Mehsana Gujarat India.ogv",
    "File:Lindy Hop dancing at the 2024 Flurry Festival.webm",
    "File:Appalchian dancers at Rydale Folk Festival.webm",
    "File:Folk dance of Nagaland.webm",
    "File:Budi Gadi dance at Dabanki village.webm",
    "File:Vishvadeep performing Kathak at Khajuraho Dance Festival 2026 001.webm",
    "File:Rabha Hamzar dance of Assam, where culture, energy and heritage come alive in every step.webm",
    "File:Nagasaki lantern festival - 2023 1 28.webm",
    "File:Timelapse at Cantin, Malmö.webm",
  ],
  city: [
    "File:Shanghai Bund, Lujiazui Skyline Timelapse.webm",
    "File:今日係2020年嘅最後一日，我特別去咗深水埗嘉頓山(喃嘸山)睇今年最後一次日落.webm",
    "File:Tampines West.Singapore Skyline.Earth Hour 2016. - Time Lapse 19th March 2016 -.webm",
    "File:Ocean Moon Glint and City Night Lights in 4K.webm",
    "File:Aerial views over Brisbane, Queensland, Australia.webm",
  ],
  things: [
    "File:Candles+camera dolly.ogv",
    "File:028 Lighting and blowing of a candle (normal speed) Video by Giles Laurent.webm",
    "File:Collections in Motion- Valentine Typewriter.webm",
    "File:Triumph-Adler electric 131d.webm",
    "File:Adding a new ribbon to Smith-Corona Galaxie.webm",
    "File:Foucault pendulum 1.webm",
    "File:Foucault pendulum in the rotunda in Griffith Observatory in July 2022.webm",
    "File:Foucault pendulum utexas motion.webm",
  ],
  nature: [
    "File:Rheinfall (Rhine Falls).webm",
    "File:Lenticular cloud over Longs Peak, Colorado (time lapse).ogv",
    "File:Time Lapse Clouds above Steens Mountain (36203941112).webm",
    "File:Lelex Crozet Montoisey01 2016-01-23.webm",
    "File:Aerial views of a car driving in snow through a forest.webm",
    "File:Crooked River (23467104578).webm",
    "File:Crooked River (37288884092).webm",
    "File:Wallowa River (35166286545).webm",
    "File:White Wild and Scenic River (30126165673).webm",
    "File:Klamath River (27693694384).webm",
    "File:Cow Island area of the Upper Missouri River Breaks National Monument (52294177378).webm",
    "File:Timelapse 2025 Kinnaur Monsoon.webm",
  ],
  christmas: [
    "File:Aix-en-Provence 20181224 20.webm",
    "File:Rotary Lights La Crosse.webm",
    "File:Kungsgatan i Stockholm.webm",
    "File:Ortspyramide in Lößnitz. Erzgebirgskreis, Sachsen 2H1A9635.webm",
    "File:Private Weihnachtspyramide in Hohndorf, Erzgebirgskres 2H1A8550.webm",
    "File:Christmas market in Ljubljana city centre - part 3.webm",
    "File:Blauer-Baum-2022.mp4.ogg",
    "File:Riesenrad Augustusmarkt 2022.ogg",
    "File:Weihnachtsengel in Hofer Innenstadt 20221218 C639.webm",
    "File:Santa Claus at Christmas Market.webm",
    "File:Christmas lights - December 2023 - Sarah Stierch.webm",
  ],
  abstractions: [
    "File:Flowing Lava at Kilauea, Hawaii.webm",
    "File:007 Volcano eruption of Litli-Hrútur in Iceland in 2023 Video by Giles Laurent.webm",
    "File:Mandelbrot set zoom 2K.webm",
    "File:Mandelbrot set zoom 4K.webm",
    "File:Тонкая пленка мыльного пузыря 1.webm",
    "File:Тонкая пленка мыльного пузыря 2.webm",
    "File:Тонкая пленка мыльного пузыря 5.webm",
    "File:Тонкая пленка мыльного пузыря 9.webm",
    "File:A freezing soap bubble in McGregor, Minnesota.webm",
    "File:Progressive infinite iterations of the 'Nautilus' section of the Mandelbrot Set.ogv",
    "File:Mandelbrot Set Color Cycling Video 1080p 3.webm",
  ],
};

/** Files looked at and left out by hand. */
const SKIP = new Set([
  "File:Klagenfurt Viktring Quellenstrasse Strom-Verbundnetz 13022010 1580.jpg",
  "File:Three golden statues of the Buddha at Wat Mai with colorful clouds at sunset in Luang Prabang Laos.jpg",
  "File:2017-02-26 Natalie Geisenberger (Siegerehrung) by Sandro Halank–3.jpg",
  "File:Parastoo Ahmadi.jpg",
  "File:Dallos-Nyers Boglárka 2013.jpg",
  "File:Cálice, Patena e Colherinha.jpg",
  "File:Santa Claus - Sunkist Ad (1928).jpg",
  "File:Rhodium powder pressed melted.jpg",
  "File:VitorJubini PaneleirasdeGoiabeiras Vitoria ES (40735316325).jpg",
  // Reviewed for 1.0.2 and left out: low bitrate (the SDO clips, Corona.Candle), black side bars,
  // shaky or blurred footage, and title or advertising cards.
  "File:SDO Video Toolkit (SVS14126 - 4038 Solar Ballet CU mk II).webm",
  "File:SDO Video Toolkit (SVS14126 - Canyon of Fire New-Slow).webm",
  "File:SDO Video Toolkit (SVS14126 - Holiday Lights Blend Move MkIII).webm",
  "File:Timelapse of Milky way changing colors during Aurora - 53921478021.webm",
  "File:Aurora Borealis and Perseids above Germany 12.08.2024.webm",
  "File:Sounds of Earth Yakushima deer walking and eating.webm",
  "File:The Beautiful Blue River - DJI Phantom 4 Drone Footage 4K - Breckenridge Colorado.webm",
  "File:Mount Fuji at sunset (timelapse).webm",
  "File:Timelapse of sunset in Norway - Earth spinning or Sun moving-.webm",
  "File:Skiing in Engelberg Titlis.webm",
  "File:Malibu-Surfrider Beach-First Point.ogg",
  "File:1000 Lanterns Festival (Emukae Sentourou) (975183).webm",
  "File:Timelapse ferry.ogv",
  "File:Corona.Candle.webm",
  "File:Beachfront B-Roll- Record Background (Free to Use Stock Footage).webm",
  "File:Christmas time in Ljubljana.webm",
  "File:Mandelbrot-Zoom 'Seepferdchenbuchtzyklenkumulation' 4K UHD 60 FPS.webm",
]);

/** Seconds to play, for videos with a title card or a closing logo: [start, end]. */
const TRIM = {
  "File:Crew Earth Observations (4K).webm": [7, 60],
  "File:ISS 4K Crew Earth Observations.webm": [7, 60],
};

async function api(params) {
  const url = new URL(API);
  for (const [key, value] of Object.entries({ format: "json", formatversion: "2", ...params })) url.searchParams.set(key, value);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    if (response.ok) return response.json();
    if (attempt >= 3) throw new Error(`${response.status} for ${url}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
}

const plain = (html) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/\s+/g, " ").trim();
const cleanTitle = (title) => title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
const WIKIMEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
const bare = (url) => (url ?? "").replace(/\?.*$/, "");

function credit(meta) {
  return { author: plain(meta.Artist?.value).slice(0, 120), license: plain(meta.LicenseShortName?.value), licenseUrl: meta.LicenseUrl?.value ?? "" };
}

function videoItem(page) {
  const info = page.videoinfo?.[0];
  if (!info) return null;
  const webm = (info.derivatives ?? []).find((item) => /\.1080p\.vp9\.webm$/.test(item.src ?? ""));
  const ratio = info.width / info.height;
  const item = { title: page.title, page: info.descriptionurl, poster: bare(info.thumburl), video: bare(webm?.src), duration: info.duration ?? 0, ...credit(info.extmetadata ?? {}) };
  const usable =
    webm &&
    info.width >= 1920 &&
    ratio >= 1.7 &&
    ratio <= 1.8 &&
    item.duration >= 8 &&
    item.duration <= 75 &&
    WIKIMEDIA.test(item.poster) &&
    WIKIMEDIA.test(item.video) &&
    item.author &&
    LICENSE.test(item.license) &&
    !UNSUITABLE.test(`${item.title} ${item.author}`) &&
    !SKIP.has(item.title);
  return usable ? item : null;
}

const VIDEO_PROPS = { prop: "videoinfo", viprop: "url|size|mime|extmetadata|derivatives", viurlwidth: String(POSTER_WIDTH) };

/** Wide videos with a 1080p VP9 copy on Commons for one search, for review. */
async function search(text) {
  const data = await api({ action: "query", generator: "search", gsrnamespace: "6", gsrlimit: "50", gsrsearch: `filetype:video ${text}`, ...VIDEO_PROPS });
  return (data.query?.pages ?? []).map(videoItem).filter(Boolean);
}

/** The picked videos, in the order given, that still meet the rules. */
async function picked(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const data = await api({ action: "query", titles: titles.slice(i, i + 40).join("|"), ...VIDEO_PROPS });
    const byTitle = new Map((data.query?.pages ?? []).map((page) => [page.title, videoItem(page)]));
    for (const title of titles.slice(i, i + 40)) {
      const item = byTitle.get(title);
      if (item) out.push(item);
      else console.error(`  dropped: ${title}`);
    }
  }
  return out;
}

/** Files in a featured picture category and, one level down, in its subcategories. */
async function files(category, depth = 1) {
  const titles = [];
  let cont;
  do {
    const data = await api({ action: "query", list: "categorymembers", cmtitle: `Category:${category}`, cmlimit: "500", cmtype: depth > 0 ? "file|subcat" : "file", ...(cont ? { cmcontinue: cont } : {}) });
    for (const member of data.query.categorymembers) {
      if (member.ns === 6) titles.push(member.title);
      else if (member.ns === 14 && depth > 0) titles.push(...(await files(member.title.replace(/^Category:/, ""), depth - 1)));
    }
    cont = data.continue?.cmcontinue;
  } while (cont && titles.length < 2000);
  return titles;
}

async function photos(titles) {
  const out = [];
  for (let i = 0; i < titles.length; i += 40) {
    const data = await api({ action: "query", titles: titles.slice(i, i + 40).join("|"), prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(PHOTO_WIDTH) });
    for (const page of data.query.pages) {
      const info = page.imageinfo?.[0];
      if (!info) continue;
      const ratio = info.width / info.height;
      const item = { title: page.title, page: info.descriptionurl, poster: bare(info.thumburl), ...credit(info.extmetadata ?? {}) };
      if (
        info.mime === "image/jpeg" &&
        info.width >= 2400 &&
        ratio >= 1.3 &&
        ratio <= 2.4 &&
        WIKIMEDIA.test(item.poster) &&
        item.author &&
        LICENSE.test(item.license) &&
        !UNSUITABLE.test(`${item.title} ${item.author}`) &&
        !SKIP.has(item.title)
      )
        out.push(item);
    }
  }
  return out;
}

/** A stable shuffle, so rebuilding with the same Commons data gives the same picks. */
function score(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

const escape = (text) => text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const thumb = (item) => escape(item.poster.replace(/\/\d+px-/, "/500px-"));
const SHEET_STYLE = "<style>body{background:#111;color:#ddd;font:12px sans-serif}div{display:flex;flex-wrap:wrap;gap:6px}figure{margin:0;width:240px}img{width:240px;height:135px;object-fit:cover}</style>";

const review = process.argv.find((arg) => arg.startsWith("--review="))?.slice(9);
if (review) {
  const all = {};
  const rows = [];
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice(7).split(",");
  for (const [id, sources] of Object.entries(CATEGORIES)) {
    if (only && !only.includes(id)) continue;
    const found = [];
    for (const text of sources.videos) found.push(...(await search(text)));
    const unique = [...new Map(found.map((item) => [item.title, item])).values()].slice(0, 40);
    all[id] = unique.map((item) => item.title);
    rows.push(`<h2>${id}</h2><div>${unique.map((item, n) => `<figure><img src="${thumb(item)}"><figcaption>${n} ${escape(cleanTitle(item.title)).slice(0, 60)} (${Math.round(item.duration)} s)</figcaption></figure>`).join("")}</div>`);
    console.error(`${id}: ${unique.length} candidates`);
  }
  fs.writeFileSync(review, `<!doctype html><meta charset="utf-8">${SHEET_STYLE}${rows.join("")}`);
  fs.writeFileSync(review.replace(/\.html$/, ".json"), JSON.stringify(all, null, 1));
  console.error(`wrote ${review}`);
  process.exit(0);
}

const gallery = { source: "Wikimedia Commons", built: new Date().toISOString().slice(0, 10), categories: {} };
const used = new Set();
const take = (item) => {
  used.add(item.title);
  const entry = { title: cleanTitle(item.title), page: item.page, poster: item.poster, author: item.author, license: item.license, licenseUrl: item.licenseUrl };
  if (item.video) entry.video = item.video;
  const trim = TRIM[item.title];
  if (trim) {
    [entry.start, entry.end] = trim;
    // The still frame comes from the first second that plays.
    entry.poster = item.poster.replace(/\/(\d+)px--/, `/$1px-seek=${trim[0]}-`);
  }
  return entry;
};
for (const [id, sources] of Object.entries(CATEGORIES)) {
  const chosen = (await picked(PICKS[id] ?? [])).filter((item) => !used.has(item.title)).slice(0, PER_CATEGORY).map(take);
  if (chosen.length < MIN_VIDEOS) {
    const titles = [...new Set((await Promise.all(sources.photos.map((source) => files(source)))).flat())].filter((title) => !used.has(title));
    const candidates = titles.sort((a, b) => score(a) - score(b)).slice(0, 120);
    chosen.push(...(await photos(candidates)).slice(0, MIN_VIDEOS - chosen.length).map(take));
  }
  gallery.categories[id] = chosen;
  console.error(`${id}: ${chosen.filter((item) => item.video).length} videos, ${chosen.filter((item) => !item.video).length} photos`);
}
fs.writeFileSync(OUT, `${JSON.stringify(gallery, null, 1)}
`);
console.error(`wrote ${OUT}`);

const sheet = process.argv.find((arg) => arg.startsWith("--sheet="))?.slice(8);
if (sheet) {
  const rows = Object.entries(gallery.categories).map(([id, items]) => `<h2>${id}</h2><div>${items.map((item) => `<figure><img src="${thumb(item)}"><figcaption>${item.video ? "▶ " : ""}${escape(item.title)}</figcaption></figure>`).join("")}</div>`);
  fs.writeFileSync(sheet, `<!doctype html><meta charset="utf-8">${SHEET_STYLE}${rows.join("")}`);
  console.error(`wrote ${sheet}`);
}
