// Build data/countries.json from the cached sources and the reviewed corrections in
// data/curated/. Also write the country options into index.html.
// Run: node tools/build-data.mjs (after npm run fetch and node tools/build-geometry.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { paths, readJson, requireFile, root, readGeonames, cityCandidates } from './lib/sources.mjs';
import { loadRegions, sortKey } from './lib/regions.mjs';
import * as factbook from './lib/factbook.mjs';
import { rankCities } from './lib/cities.mjs';
import { indexWikidataLakes, largestLake } from './lib/lakes.mjs';
import { loadLakeLayers, findLakeShapes, mapLakes, lakeTopology } from './lib/lake-shapes.mjs';
import { readEmdat, deadliestDisaster } from './lib/disasters.mjs';
import { readPew, readM49, factbookShares, mainReligion, groupNames } from './lib/religion.mjs';
import { loadRiverLines, splitLines, shapeIndex, linkLines, lengthKm, riverTopology } from './lib/rivers.mjs';
import { feature } from 'topojson-client';
import { geoContains, geoCentroid } from 'd3-geo';

const collected = '30 October 2026';
const curated = name => readJson(`${root}data/curated/${name}.json`);
const languages = curated('languages');
const elevationFixes = curated('elevation');
const cityFixes = curated('cities');
const lakeFixes = curated('lakes');
const capitalFixes = curated('capitals');
const religionFixes = curated('religion');
const riverFixes = curated('rivers');

const regions = loadRegions();

// The focus of each region is the focus of its largest shape on the globe.
const world = readJson(`${root}data/world.json`);
const focus = new Map();
for (const geometry of world.objects.countries.geometries) {
  const { id, focus: view } = geometry.properties;
  if (!focus.has(id) || focus.get(id)[2] < view[2]) focus.set(id, view);
}
const missingShapes = regions.filter(region => !focus.has(region.id)).map(region => region.id);
if (missingShapes.length) throw new Error(`No globe shape for ${missingShapes.join(', ')}`);

// Shapes of each region, to test whether a place lies in it.
const shapesById = new Map();
for (const shape of feature(world, world.objects.countries).features) {
  if (!shapesById.has(shape.properties.id)) shapesById.set(shape.properties.id, []);
  shapesById.get(shape.properties.id).push(shape);
}
const inRegion = (id, point) => (shapesById.get(id) ?? []).some(shape => geoContains(shape, point));
const regionAt = point => [...shapesById.keys()].find(id => inRegion(id, point)) ?? null;
const round3 = ([lon, lat]) => [Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000];

const notes = {
  CYP: 'The data includes Northern Cyprus.',
  SOM: 'The data includes Somaliland.',
  FIN: 'The data includes the Åland Islands.',
  FRA: 'The data includes the overseas regions of France.',
  NOR: 'The data includes Svalbard and Jan Mayen.',
  NLD: 'The data includes the Caribbean Netherlands.',
  PSE: 'The data includes the West Bank and the Gaza Strip.',
  ESH: 'This is a disputed territory.',
  KAS: 'This is a disputed area between India and Pakistan. The sources give no country data for it.',
};
const unassigned = new Set(['KAS']);

/* GDP: the World Bank first, then the IMF, then The World Factbook. */
const worldBank = new Map();
for (const row of readJson(requireFile(paths.worldBank))[1]) {
  if (row.value === null) continue;
  const year = Number(row.date);
  const known = worldBank.get(row.countryiso3code);
  if (!known || known.year < year) worldBank.set(row.countryiso3code, { usd: row.value, year });
}
const imf = readJson(requireFile(paths.imf)).values.NGDPD;

function gdp(region, entries) {
  const bank = worldBank.get(region.worldBank);
  if (bank && bank.year >= 2023) return { usd: Math.round(bank.usd), year: bank.year, source: 'World Bank' };
  // The IMF values after 2025 are projections. Use the latest year up to 2025.
  const series = imf[region.imf] ?? {};
  const year = Object.keys(series).map(Number).filter(y => y <= 2025 && series[y] !== null).sort((a, b) => b - a)[0];
  if (year) return { usd: Math.round(series[year] * 1e9), year, source: 'IMF' };
  if (bank) return { usd: Math.round(bank.usd), year: bank.year, source: 'World Bank' };
  const fromFactbook = entries.map(factbook.gdp).filter(Boolean).sort((a, b) => b.usd - a.usd)[0];
  return fromFactbook ? { usd: Math.round(fromFactbook.usd), year: fromFactbook.year, source: 'The World Factbook' } : null;
}

/* Population: the World Bank, then The World Factbook. */
const worldBankPopulation = new Map();
for (const row of readJson(requireFile(paths.worldBankPopulation))[1]) {
  if (row.value === null) continue;
  const known = worldBankPopulation.get(row.countryiso3code);
  if (!known || known.year < Number(row.date)) worldBankPopulation.set(row.countryiso3code, { count: row.value, year: Number(row.date) });
}
function population(region, entries) {
  const bank = worldBankPopulation.get(region.worldBank);
  if (bank) return { ...bank, source: 'World Bank' };
  for (const entry of entries) {
    const text = factbook.clean(entry['People and Society']?.Population?.total?.text ?? '');
    const match = text.match(/^([\d,]+)\s*\((?:[^)]*?)(\d{4})/);
    if (match) return { count: Number(match[1].replace(/,/g, '')), year: Number(match[2]), source: 'The World Factbook' };
  }
  return null;
}

/* Elevation: the Factbook point, with reviewed corrections. A point gets a position
   when Wikidata states the same point for the country, or when a place with its
   name lies in the country. A point at sea level on the coast has no position. */
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
const extremes = readJson(requireFile(paths.wikidataExtremes));
const mountainWords = /\b(mount|mont|monte|mt|pico|pic|pik|cerro|gora|hora|jabal|jebel|kuh|kuh-e|phnum|puncak|gunung|volcan|nevado|peak|hill|river|delta|lake|lac|lago|the|of|de|del|la|el|on|in)\b/g;
const placeWords = name => new Set(String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(mountainWords, ' ').split(/\s+/).filter(word => word.length > 2));
const samePlace = (a, b) => [...placeWords(a)].some(word => placeWords(b).has(word));
function locate(region, key, point) {
  if (!point || (/^unnamed|ocean|\bsea\b|gulf|strait|channel|bay of/i.test(point.name) && point.m >= 0)) return null;
  for (const stated of extremes[region.id]?.[key] ?? []) {
    const close = stated.m !== null && Math.abs(stated.m - point.m) <= Math.max(15, Math.abs(point.m) * 0.03);
    if (samePlace(stated.label, point.name) || close) return round3(stated.at);
  }
  const name = point.name.replace(/\s*\(.*\)\s*/g, ' ').split(/ on | in the /)[0].trim();
  const found = (extremes._search?.[name] ?? []).find(candidate => inRegion(region.id, candidate.at));
  return found ? round3(found.at) : null;
}
function elevation(region, entries) {
  const points = entries.map(factbook.elevation);
  const highest = points.map(p => p.highest).filter(Boolean).sort((a, b) => b.m - a.m)[0] ?? null;
  const lowest = points.map(p => p.lowest).filter(Boolean).sort((a, b) => a.m - b.m)[0] ?? null;
  const fixes = elevationFixes[region.id] ?? {};
  const tidy = (point, key) => {
    if (!point) return null;
    const at = locate(region, key, point);
    return { name: capitalize(point.name), m: point.m, ...(at ? { at } : {}) };
  };
  return { highest: tidy(fixes.highest ?? highest, 'highest'), lowest: tidy(fixes.lowest ?? lowest, 'lowest') };
}

/* Disasters: EM-DAT entries, named with Wikidata events. */
const emdat = readEmdat(requireFile(paths.disasters));
const emdatExtra = { FRA: ['GLP', 'MTQ', 'GUF', 'REU', 'MYT'], NOR: ['SJM'], NLD: ['BES'], FIN: ['ALA'] };
const regionByWikidata = new Map(regions.map(region => [region.wikidata, region.id]));
const disasterFixes = curated('disasters');
function byRegion(list) {
  const result = new Map();
  for (const event of list) {
    let ids = [...new Set(event.countries.map(id => regionByWikidata.get(id)).filter(Boolean))];
    if (!ids.length && event.at) ids = [regionAt(event.at)].filter(Boolean);
    for (const id of ids) {
      if (!result.has(id)) result.set(id, []);
      result.get(id).push({ ...event, countryCount: ids.length });
    }
  }
  return result;
}
const wikidataDisasters = readJson(requireFile(paths.wikidataDisasters));
const tollsByRegion = byRegion(wikidataDisasters.tolls);
const eventsByRegion = byRegion(wikidataDisasters.events);

/* Religion: Pew Research Center for 2020, then The World Factbook. */
const pew = readPew(requireFile(paths.religion));
const m49 = readM49(requireFile(paths.geonamesCountries));
function religionOf(region, entries) {
  const counted = pew.get(m49.get(region.id));
  const found = counted
    ? { shares: counted.shares, year: 2020, source: 'Pew Research Center' }
    : entries.map(factbookShares).filter(Boolean).map(result => ({ ...result, source: 'The World Factbook' }))[0];
  const main = found?.first ? { name: groupNames[found.first], share: null } : found && mainReligion(found.shares);
  if (!main) return null;
  if (religionFixes[region.id]?.name) main.name = religionFixes[region.id].name;
  return { ...main, year: found.year, source: found.source };
}

/* Rivers: the longest Wikidata river with a Natural Earth line through or along the
   region. A region without such a line gets its longest Wikidata river, which the
   globe does not draw. */
const wikidataRivers = readJson(requireFile(paths.wikidataRivers));
const riverLinks = linkLines(splitLines(loadRiverLines(paths.naturalEarthRivers), riverFixes._split), wikidataRivers,
  shapeIndex(feature(world, world.objects.countries).features), riverFixes._join);
const riverRegions = new Map([...riverLinks].map(([item, lines]) => [item, new Set(lines.flatMap(line => [...line.regions]))]));
// A reviewed river of a region also lists that region among its countries.
for (const [id, fix] of Object.entries(riverFixes)) if (fix?.item && riverRegions.has(fix.item)) riverRegions.get(fix.item).add(id);
const drawnRivers = new Map();
const regionNames = new Map(regions.map(region => [region.id, region.name]));
function riverOf(region) {
  const fix = riverFixes[region.id];
  if (fix === null) return null;
  // A reviewed river without a Wikidata length, with the length from its source.
  if (fix?.name && !fix.item) return { name: fix.name, km: fix.km ?? null, shared: [] };
  const longest = ids => ids.sort((a, b) => lengthKm(wikidataRivers[b]) - lengthKm(wikidataRivers[a]))[0];
  const drawn = [...riverRegions].filter(([, through]) => through.has(region.id)).map(([item]) => item);
  const item = fix?.item ?? longest(drawn) ?? longest(Object.keys(wikidataRivers).filter(id => wikidataRivers[id].regions.includes(region.id)));
  if (!item) return null;
  const river = wikidataRivers[item];
  const through = riverRegions.get(item) ?? new Set(river.regions);
  if (riverLinks.has(item)) {
    if (!drawnRivers.has(item)) drawnRivers.set(item, { lines: riverLinks.get(item), regions: new Set() });
    drawnRivers.get(item).regions.add(region.id);
  }
  return {
    name: fix?.name ?? riverFixes._names?.[item] ?? river.label ?? river.names[0],
    km: fix?.km ?? lengthKm(river),
    shared: [...through].filter(id => id !== region.id && regionNames.has(id)).map(id => regionNames.get(id)).sort(),
    ...(riverLinks.has(item) ? { drawn: true } : {}),
  };
}

/* Exports: the Factbook list of the five largest commodities by value. */
function exportsOf(entries) {
  const found = entries.map(factbook.exports).find(Boolean);
  if (!found) return null;
  return { items: found.items.map(item => item.replace(/\s+\d+(\.\d+)?%$/, '')).slice(0, 5), year: found.year };
}

/* Cities */
const geonames = readGeonames();
const pool = cityCandidates(geonames);
const cityFacts = readJson(requireFile(paths.wikidataCities));
function cities(region) {
  const candidates = region.geonames.flatMap(code => pool.get(code) ?? []);
  candidates.sort((a, b) => b.population - a.population);
  return rankCities(candidates, cityFacts, cityFixes);
}

/* Capitals: the GeoNames capital of the region's main country code, with reviewed
   changes. A capital among the ten cities points to its row. Another capital gets a
   position of its own. */
const capitalByCountry = new Map(geonames.filter(row => row.code === 'PPLC').map(row => [row.country, row]));
const placeById = new Map(geonames.map(row => [row.geonameId, row]));
function capitalOf(region, ranked) {
  if (capitalFixes[region.id] === null) return null;
  const fix = capitalFixes[region.id] ?? {};
  const place = fix.at ? null : placeById.get(fix.geonameId) ?? capitalByCountry.get(region.geonames[0]);
  if (!place && !fix.at) return null;
  const index = place ? ranked.findIndex(city => city.geonameId === place.geonameId) : -1;
  const name = fix.name ?? (index >= 0 ? ranked[index].name : place.name);
  return {
    name,
    ...(index >= 0 ? { city: index } : { at: round3(fix.at ?? [place.lon, place.lat]) }),
    ...(fix.note ? { note: fix.note } : {}),
  };
}

/* Lakes */
const wikidataLakes = indexWikidataLakes(readJson(requireFile(paths.wikidataLakes)), new Set(Object.keys(lakeFixes.excludeItems ?? {})));
const lakePoints = readJson(requireFile(paths.wikidataLakePoints));
const lakeLayers = loadLakeLayers();
const lakeShapes = mapLakes(lakeLayers).map(entry => ({ entry, map: true }));
const namesByWikidata = new Map(regions.map(region => [region.wikidata, region.name]));

function languagesOf(region) {
  const entry = languages[region.id];
  if (!entry) throw new Error(`No reviewed languages for ${region.id}`);
  return Array.isArray(entry) ? { list: entry } : { list: entry.list, ...(entry.note ? { note: entry.note } : {}) };
}

const output = {};
for (const region of regions) {
  const entries = region.factbook.map(factbook.entry).filter(Boolean);
  const record = { name: region.name, focus: focus.get(region.id) };
  if (notes[region.id]) record.note = notes[region.id];
  if (unassigned.has(region.id)) {
    record.unassigned = true;
    record.cities = [];
    output[region.id] = record;
    continue;
  }
  const ranked = cities(region);
  record.population = population(region, entries);
  record.gdp = gdp(region, entries);
  const capital = capitalOf(region, ranked);
  if (capital) record.capital = capital;
  record.languages = languagesOf(region);
  record.religion = religionOf(region, entries);
  Object.assign(record, elevation(region, entries));
  const lakeFix = lakeFixes[region.id];
  record.lake = lakeFix !== undefined
    ? lakeFix && { item: lakeFix.item, name: lakeFix.name, km2: lakeFix.km2, ...(lakeFix.kind ? { kind: lakeFix.kind } : {}), shared: lakeFix.shared ?? [] }
    : largestLake(region, wikidataLakes, entries.flatMap(factbook.lakes), namesByWikidata, lakeFixes.skipFactbook);
  if (record.lake) {
    // An outline from Natural Earth, or else a position for a lake symbol.
    const found = findLakeShapes(record.lake, { focus: record.focus }, lakeLayers);
    for (const entry of found) lakeShapes.push({ entry, region: region.id });
    const point = lakePoints[record.lake.item] ?? (found.length ? geoCentroid(found[0].feature) : null);
    if (found.length) record.lake.outline = true;
    else if (point) record.lake.at = round3(point);
    delete record.lake.source;
    delete record.lake.item;
  }
  record.river = riverOf(region);
  const fix = disasterFixes[region.id];
  record.disaster = deadliestDisaster({ id: region.id, emdatCodes: [region.worldBank, ...(emdatExtra[region.id] ?? [])] },
    emdat, tollsByRegion.get(region.id) ?? [], eventsByRegion.get(region.id) ?? [],
    fix?.deaths ? { name: fix.name, type: fix.type, year: fix.year, deaths: fix.deaths, source: fix.source } : null);
  // A reviewed name or type for the record of that year.
  if (fix && !fix.deaths && record.disaster?.year === fix.year) {
    if (fix.name) record.disaster.name = fix.name;
    if (fix.type) record.disaster.type = fix.type;
  }
  record.exports = exportsOf(entries);
  record.cities = ranked.map(city =>
    [city.name, city.population, city.year, Math.round(city.lat * 1000) / 1000, Math.round(city.lon * 1000) / 1000]);
  output[region.id] = record;
}

writeFileSync(`${root}data/lakes.json`, JSON.stringify(lakeTopology(lakeShapes)));
writeFileSync(`${root}data/rivers.json`, JSON.stringify(riverTopology([...drawnRivers.values()])));

// One region per line keeps the file small and its history readable.
const lines = Object.entries(output).map(([id, record]) => `${JSON.stringify(id)}:${JSON.stringify(record)}`);
writeFileSync(`${root}data/countries.json`, `{"collected":${JSON.stringify(collected)},"regions":{\n${lines.join(',\n')}\n}}\n`);

// The country list in the page is static HTML, so it works before the script runs.
const escape = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const options = regions
  .slice().sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)))
  .map(region => `            <option value="${region.id}">${escape(region.name)}</option>`).join('\n');
const page = readFileSync(`${root}index.html`, 'utf8');
const marked = /(<!-- countries:start -->)[\s\S]*?(\s*<!-- countries:end -->)/;
if (!marked.test(page)) throw new Error('index.html has no countries markers.');
writeFileSync(`${root}index.html`, page.replace(marked, `$1\n${options}$2`));
console.log(`Wrote ${regions.length} regions to data/countries.json and index.html.`);
