// Download the source snapshot into .cache/. Run: npm run fetch [-- step ...]
// Steps: geography, geonames, factbook, gdp, cities, lakes. Without a step, run all.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { paths, readGeonames, cityCandidates, readJson, requireFile } from './lib/sources.mjs';
import { sparql, qid, api, areaKm2 } from './lib/wikidata.mjs';

const naturalEarth = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';

async function download(url, path) {
  mkdirSync(dirname(path), { recursive: true });
  const response = await fetch(url, { headers: { 'User-Agent': 'jehlp-gazetteer/1.0 (https://jehlp.net/gazetteer/)' } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  console.log(`Saved ${path.replace(paths.manifest.replace('manifest.json', ''), '.cache/')}`);
}

const steps = {
  async geography() {
    await download(`${naturalEarth}ne_50m_admin_0_countries.geojson`, paths.naturalEarth);
    await download(`${naturalEarth}ne_10m_admin_0_countries.geojson`, paths.naturalEarthDetail);
  },

  async geonames() {
    await download('https://download.geonames.org/export/dump/cities500.zip', paths.geonamesZip);
    execFileSync('unzip', ['-o', '-q', paths.geonamesZip, '-d', dirname(paths.geonames)]);
  },

  async factbook() {
    // The World Factbook stopped in February 2026. This mirror holds its final edition.
    await download('https://codeload.github.com/factbook/factbook.json/tar.gz/refs/heads/master', paths.factbookArchive);
    execFileSync('tar', ['xzf', paths.factbookArchive, '-C', dirname(paths.factbookArchive)]);
  },

  async gdp() {
    await download('https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=20000&date=2010:2026', paths.worldBank);
    await download('https://www.imf.org/external/datamapper/api/v1/NGDPD', paths.imf);
  },

  // Identify each candidate settlement on Wikidata by its GeoNames ID. Classes show
  // whether the place is a city or a district of a city. Populations come with dates.
  async cities() {
    const pool = cityCandidates(readGeonames());
    const ids = [...pool.values()].flat().map(row => row.geonameId);
    const facts = {};
    for (let start = 0; start < ids.length; start += 350) {
      const values = ids.slice(start, start + 350).map(id => `"${id}"`).join(' ');
      const identity = await sparql(`SELECT ?gn ?item ?itemLabel ?class ?classLabel WHERE {
        VALUES ?gn { ${values} }
        ?item wdt:P1566 ?gn .
        OPTIONAL { ?item wdt:P31 ?class . }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      }`);
      for (const row of identity) {
        const gn = row.gn.value, item = qid(row.item.value);
        facts[gn] ??= {};
        facts[gn][item] ??= { label: row.itemLabel?.value, classes: {}, populations: [] };
        if (row.class) facts[gn][item].classes[qid(row.class.value)] = row.classLabel?.value;
      }
      const counts = await sparql(`SELECT ?gn ?item ?pop ?date WHERE {
        VALUES ?gn { ${values} }
        ?item wdt:P1566 ?gn ; p:P1082 ?st .
        ?st a wikibase:BestRank ; ps:P1082 ?pop .
        OPTIONAL { ?st pq:P585 ?date . }
      }`);
      for (const row of counts) {
        const record = facts[row.gn.value]?.[qid(row.item.value)];
        record?.populations.push({ value: Number(row.pop.value), date: row.date?.value?.slice(0, 10) ?? null });
      }
      console.log(`Cities: ${Math.min(start + 350, ids.length)} of ${ids.length} candidates`);
    }
    mkdirSync(dirname(paths.wikidataCities), { recursive: true });
    writeFileSync(paths.wikidataCities, JSON.stringify(facts));
  },

  // Lakes, reservoirs and lagoons with an area. One query for each water type takes
  // every body larger than 20 km². A second pass uses the search index to find
  // smaller ones for the countries that have none of that size. A last query marks
  // lakes with a dissolution date.
  async lakes() {
    const types = ['Q23397', 'Q131681', 'Q188025', 'Q187223', 'Q204324', 'Q9019918', 'Q211302', 'Q1140477', 'Q3215290', 'Q3511952'];
    const parse = (rows, type) => rows.map(row => ({
      item: qid(row.lake.value), label: row.lakeLabel.value, area: Number(row.area.value) / 1e6,
      type: type ?? qid(row.type.value), countries: row.countries.value.split(' ').filter(Boolean).map(qid),
    }));
    // The per-type results are kept, so a rerun after a failed second pass is quick.
    const partial = `${paths.wikidataLakes}.types.json`;
    const lakes = existsSync(partial) ? readJson(partial) : [];
    if (!lakes.length) {
      for (const type of types) {
        lakes.push(...parse(await sparql(`SELECT ?lake ?lakeLabel ?area (GROUP_CONCAT(DISTINCT ?country; separator=" ") AS ?countries) WHERE {
          hint:Query hint:optimizer "None" .
          ?lake wdt:P31 wd:${type} ; p:P2046/psn:P2046/wikibase:quantityAmount ?area .
          FILTER(?area > 2e7)
          ?lake wdt:P17 ?country .
          SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
        } GROUP BY ?lake ?lakeLabel ?area`), type));
        console.log(`Lakes: type ${type}, ${lakes.length} so far`);
      }
      mkdirSync(dirname(partial), { recursive: true });
      writeFileSync(partial, JSON.stringify(lakes));
    }
    const covered = new Set(lakes.flatMap(lake => lake.countries));
    const remaining = [...new Set(readJson(requireFile(paths.naturalEarth)).features
      .map(feature => feature.properties.WIKIDATAID))].filter(id => id && !covered.has(id));
    // Smaller water bodies of the remaining countries, from the search index.
    for (const [index, country] of remaining.entries()) {
      const items = [];
      let offset = 0;
      do {
        const data = await api({
          action: 'query', list: 'search', srnamespace: '0', srlimit: '500', sroffset: String(offset),
          srsearch: `haswbstatement:P17=${country} haswbstatement:${types.map(type => `P31=${type}`).join('|')}`,
        });
        items.push(...data.query.search.map(result => result.title));
        offset = data.continue?.sroffset;
      } while (offset && items.length < 2000);
      for (let start = 0; start < items.length; start += 50) {
        const data = await api({ action: 'wbgetentities', ids: items.slice(start, start + 50).join('|'), props: 'labels|claims', languages: 'en' });
        for (const entity of Object.values(data.entities ?? {})) {
          const area = areaKm2(entity.claims?.P2046);
          const label = entity.labels?.en?.value;
          if (!area || !label) continue;
          const claimed = claim => claim.mainsnak?.datavalue?.value?.id;
          const kinds = (entity.claims.P31 ?? []).map(claimed).filter(type => types.includes(type));
          const countries = (entity.claims.P17 ?? []).map(claimed).filter(Boolean);
          for (const type of kinds) lakes.push({ item: entity.id, label, area, type, countries });
        }
      }
      if ((index + 1) % 10 === 0 || index + 1 === remaining.length) {
        console.log(`Lakes: ${index + 1} of ${remaining.length} smaller countries`);
      }
    }
    const ids = [...new Set(lakes.map(lake => lake.item))];
    const gone = new Set();
    for (let start = 0; start < ids.length; start += 400) {
      const rows = await sparql(`SELECT ?lake WHERE {
        VALUES ?lake { ${ids.slice(start, start + 400).map(id => `wd:${id}`).join(' ')} }
        ?lake wdt:P576 ?end .
      }`);
      for (const row of rows) gone.add(qid(row.lake.value));
    }
    for (const lake of lakes) lake.dissolved = gone.has(lake.item);
    mkdirSync(dirname(paths.wikidataLakes), { recursive: true });
    writeFileSync(paths.wikidataLakes, JSON.stringify(lakes));
  },
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(steps)) {
  if (!steps[name]) throw new Error(`Unknown step ${name}. Use ${Object.keys(steps).join(', ')}.`);
  await steps[name]();
}
