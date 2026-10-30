// Build data/countries.json from the cached sources and the reviewed corrections in
// data/curated/. Also write the country options into index.html.
// Run: node tools/build-data.mjs (after npm run fetch and node tools/build-geometry.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { paths, readJson, requireFile, root, readGeonames, cityCandidates } from './lib/sources.mjs';
import { regions as listRegions, sortKey } from './lib/regions.mjs';
import * as factbook from './lib/factbook.mjs';
import { rankCities } from './lib/cities.mjs';
import { indexWikidataLakes, largestLake } from './lib/lakes.mjs';

const collected = '30 October 2026';
const curated = name => readJson(`${root}data/curated/${name}.json`);
const languages = curated('languages');
const elevationFixes = curated('elevation');
const cityFixes = curated('cities');
const lakeFixes = curated('lakes');

// Regions follow the globe shapes: Natural Earth features after the Christmas
// Island and Cocos split, with Gibraltar from the 1:10m set.
const naturalEarth = readJson(requireFile(paths.naturalEarth)).features.filter(f => f.properties.ADM0_A3 !== 'IOA');
const gibraltar = readJson(requireFile(paths.naturalEarthDetail)).features.find(f => f.properties.ADM0_A3 === 'GIB');
const islands = ['CXR', 'CCK'].map(code => ({ properties: { ADM0_A3: code, ISO_A3_EH: 'AUS', ISO_A2_EH: '-99', FIPS_10: '-99' } }));
const regions = listRegions([...naturalEarth, gibraltar, ...islands]);

// The focus of each region is the focus of its largest shape on the globe.
const world = readJson(`${root}data/world.json`);
const focus = new Map();
for (const geometry of world.objects.countries.geometries) {
  const { id, focus: view } = geometry.properties;
  if (!focus.has(id) || focus.get(id)[2] < view[2]) focus.set(id, view);
}
const missingShapes = regions.filter(region => !focus.has(region.id)).map(region => region.id);
if (missingShapes.length) throw new Error(`No globe shape for ${missingShapes.join(', ')}`);

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

/* Elevation: the Factbook point, with reviewed corrections. */
const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);
function elevation(region, entries) {
  const points = entries.map(factbook.elevation);
  const highest = points.map(p => p.highest).filter(Boolean).sort((a, b) => b.m - a.m)[0] ?? null;
  const lowest = points.map(p => p.lowest).filter(Boolean).sort((a, b) => a.m - b.m)[0] ?? null;
  const fixes = elevationFixes[region.id] ?? {};
  const tidy = point => point && { name: capitalize(point.name), m: point.m };
  return { highest: tidy(fixes.highest ?? highest), lowest: tidy(fixes.lowest ?? lowest) };
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
  return rankCities(candidates, cityFacts, cityFixes).map(city =>
    [city.name, city.population, city.year, Math.round(city.lat * 1000) / 1000, Math.round(city.lon * 1000) / 1000]);
}

/* Lakes */
const wikidataLakes = indexWikidataLakes(readJson(requireFile(paths.wikidataLakes)), new Set(Object.keys(lakeFixes.excludeItems ?? {})));
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
  record.gdp = gdp(region, entries);
  record.languages = languagesOf(region);
  Object.assign(record, elevation(region, entries));
  const lakeFix = lakeFixes[region.id];
  record.lake = lakeFix !== undefined
    ? lakeFix && { name: lakeFix.name, km2: lakeFix.km2, ...(lakeFix.kind ? { kind: lakeFix.kind } : {}), shared: lakeFix.shared ?? [] }
    : largestLake(region, wikidataLakes, entries.flatMap(factbook.lakes), namesByWikidata, lakeFixes.skipFactbook);
  if (record.lake) delete record.lake.source;
  record.exports = exportsOf(entries);
  record.cities = cities(region);
  output[region.id] = record;
}

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
