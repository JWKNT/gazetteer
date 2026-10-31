// Download the source snapshot into .cache/. Run: npm run fetch [-- step ...]
// Steps: geography, geonames, factbook, gdp, population, cities, lakes, lakepoints,
// extremes, disasters, rivers, memberships, religion. Without a step, run all. Later steps read earlier results.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { paths, readGeonames, cityCandidates, readJson, requireFile, root } from './lib/sources.mjs';
import { sparql, qid, api, areaKm2 } from './lib/wikidata.mjs';
import { loadRegions } from './lib/regions.mjs';
import * as factbook from './lib/factbook.mjs';
import { organizations } from './lib/organizations.mjs';

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
    for (const path of [...paths.naturalEarthLakes, paths.naturalEarthMarine, ...paths.naturalEarthRivers]) await download(`${naturalEarth}${path.split('/').pop()}`, path);
  },

  async geonames() {
    await download('https://download.geonames.org/export/dump/cities500.zip', paths.geonamesZip);
    execFileSync('unzip', ['-o', '-q', paths.geonamesZip, '-d', dirname(paths.geonames)]);
    await download('https://download.geonames.org/export/dump/countryInfo.txt', paths.geonamesCountries);
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

  async population() {
    await download('https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&date=2015:2026', paths.worldBankPopulation);
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

  // Positions of lakes, for a lake that has no outline in Natural Earth.
  async lakepoints() {
    const curated = readJson(`${root}data/curated/lakes.json`);
    const items = new Set(readJson(requireFile(paths.wikidataLakes)).map(lake => lake.item));
    for (const value of Object.values(curated)) if (value?.item) items.add(value.item);
    const ids = [...items];
    const points = {};
    for (let start = 0; start < ids.length; start += 400) {
      const rows = await sparql(`SELECT ?lake ?coord WHERE {
        VALUES ?lake { ${ids.slice(start, start + 400).map(id => `wd:${id}`).join(' ')} }
        ?lake wdt:P625 ?coord .
      }`);
      for (const row of rows) points[qid(row.lake.value)] ??= row.coord.value.match(/-?[\d.]+/g).map(Number);
    }
    writeFileSync(paths.wikidataLakePoints, JSON.stringify(points));
    console.log(`Lake points: ${Object.keys(points).length} of ${ids.length} lakes`);
  },

  // Highest and lowest points with their positions. Wikidata states them for most
  // countries. For a Factbook point with another name, the search index supplies
  // candidate places. The build keeps a candidate only if it is in the country.
  async extremes() {
    const regions = loadRegions();
    const byQid = new Map(regions.map(region => [region.wikidata, region]));
    const result = {};
    const rows = await sparql(`SELECT ?country ?prop ?point ?pointLabel ?coord ?elevation WHERE {
      VALUES ?country { ${[...byQid.keys()].filter(Boolean).map(id => `wd:${id}`).join(' ')} }
      VALUES ?prop { wdt:P610 wdt:P1589 }
      ?country ?prop ?point .
      ?point wdt:P625 ?coord .
      OPTIONAL { ?point wdt:P2044 ?elevation }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`);
    for (const row of rows) {
      const region = byQid.get(qid(row.country.value));
      if (!region) continue;
      const key = row.prop.value.endsWith('P610') ? 'highest' : 'lowest';
      const entry = (result[region.id] ??= { highest: [], lowest: [], search: {} });
      entry[key].push({
        item: qid(row.point.value), label: row.pointLabel.value,
        at: row.coord.value.match(/-?[\d.]+/g).map(Number), m: row.elevation ? Number(row.elevation.value) : null,
      });
    }
    // Search for each named Factbook point. Unnamed points and sea level have no place to find.
    const fixes = readJson(`${root}data/curated/elevation.json`);
    const names = new Set();
    for (const region of regions) {
      for (const key of ['highest', 'lowest']) {
        const parsed = region.factbook.map(factbook.entry).filter(Boolean).map(entry => factbook.elevation(entry)[key]).filter(Boolean);
        const point = fixes[region.id]?.[key] ?? parsed[0];
        if (!point || /^unnamed|ocean|\bsea\b|gulf|strait|channel|bay of/i.test(point.name) && point.m >= 0) continue;
        names.add(point.name.replace(/\s*\(.*\)\s*/g, ' ').split(/ on | in the /)[0].trim());
      }
    }
    for (const name of names) {
      const found = await api({ action: 'wbsearchentities', search: name, language: 'en', type: 'item', limit: '5' });
      const ids = found.search.map(hit => hit.id);
      if (!ids.length) continue;
      const entities = (await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels', languages: 'en' })).entities;
      for (const id of ids) {
        const value = entities[id]?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
        if (!value) continue;
        (result._search ??= {})[name] ??= [];
        result._search[name].push({ item: id, label: entities[id].labels?.en?.value ?? name, at: [value.longitude, value.latitude] });
      }
    }
    writeFileSync(paths.wikidataExtremes, JSON.stringify(result));
    console.log(`Extremes: ${Object.keys(result).length - 1} countries, ${names.size} names searched`);
  },

  // EM-DAT deaths by country, year and type, as published by Our World in Data, and
  // named disaster events from Wikidata to give a name to an EM-DAT entry.
  async disasters() {
    await download('https://ourworldindata.org/grapher/natural-disasters-deaths.csv?metric=total_number&timespan=annual&type=all_stacked&v=1&csvType=full&useColumnShortNames=true', paths.disasters);
    // Classes of natural disasters, events with a death toll, then the details of the events.
    const roots = ['Q8065', 'Q7944', 'Q8070', 'Q8092', 'Q8068', 'Q7692360', 'Q8081', 'Q167903', 'Q43059', 'Q169950', 'Q81054', 'Q215864', 'Q642683'];
    const classes = new Map();
    for (const row of await sparql(`SELECT DISTINCT ?type ?root WHERE {
      VALUES ?root { ${roots.map(id => `wd:${id}`).join(' ')} }
      ?type wdt:P279* ?root .
    }`)) {
      const type = qid(row.type.value);
      if (!classes.has(type)) classes.set(type, new Set());
      classes.get(type).add(qid(row.root.value));
    }
    const events = new Map();
    for (const row of await sparql(`SELECT ?event ?deaths ?type WHERE { ?event wdt:P1120 ?deaths ; wdt:P31 ?type . FILTER(?deaths >= 20) }`)) {
      const type = qid(row.type.value);
      if (!classes.has(type)) continue;
      const event = events.get(qid(row.event.value)) ?? { deaths: 0, roots: new Set() };
      event.deaths = Math.max(event.deaths, Number(row.deaths.value));
      for (const root of classes.get(type)) event.roots.add(root);
      events.set(qid(row.event.value), event);
    }
    const ids = [...events.keys()];
    const details = [];
    for (let start = 0; start < ids.length; start += 200) {
      const rows = await sparql(`SELECT ?event ?eventLabel ?time ?coord (GROUP_CONCAT(DISTINCT ?country; separator=" ") AS ?countries) WHERE {
        VALUES ?event { ${ids.slice(start, start + 200).map(id => `wd:${id}`).join(' ')} }
        OPTIONAL { ?event wdt:P17 ?country }
        OPTIONAL { ?event wdt:P585 ?pointInTime } OPTIONAL { ?event wdt:P580 ?start }
        BIND(COALESCE(?pointInTime, ?start) AS ?time)
        OPTIONAL { ?event wdt:P625 ?coord }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } GROUP BY ?event ?eventLabel ?time ?coord`);
      const seen = new Set(details.map(detail => detail.item));
      for (const row of rows) {
        const item = qid(row.event.value);
        if (seen.has(item)) continue;
        seen.add(item);
        const event = events.get(item);
        details.push({
          item, label: row.eventLabel.value, deaths: event.deaths, roots: [...event.roots],
          year: row.time ? Number(row.time.value.slice(0, 4)) : null,
          at: row.coord ? row.coord.value.match(/-?[\d.]+/g).map(Number) : null,
          countries: row.countries.value.split(' ').filter(Boolean).map(qid),
        });
      }
    }
    // All events of these classes since 1900, with or without a death toll. They name the
    // EM-DAT entries. The country comes from the event or from its location.
    const named = [];
    const typeList = [...classes.keys()];
    for (let start = 0; start < typeList.length; start += 40) {
      const rows = await sparql(`SELECT ?event ?eventLabel ?type ?time ?links ?coord
        (GROUP_CONCAT(DISTINCT ?country; separator=" ") AS ?countries) WHERE {
        hint:Query hint:optimizer "None" .
        VALUES ?type { ${typeList.slice(start, start + 40).map(id => `wd:${id}`).join(' ')} }
        ?event wdt:P31 ?type .
        ?event wdt:P585|wdt:P580 ?time . FILTER(YEAR(?time) >= 1900)
        ?event wikibase:sitelinks ?links .
        OPTIONAL { ?event wdt:P625 ?coord }
        OPTIONAL { { ?event wdt:P17 ?country } UNION { ?event wdt:P276 ?country } UNION { ?event wdt:P276/wdt:P17 ?country } }
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } GROUP BY ?event ?eventLabel ?type ?time ?links ?coord`);
      for (const row of rows) {
        named.push({
          item: qid(row.event.value), label: row.eventLabel.value, roots: [...classes.get(qid(row.type.value))],
          year: Number(row.time.value.slice(0, 4)), links: Number(row.links.value),
          at: row.coord ? row.coord.value.match(/-?[\d.]+/g).map(Number) : null,
          countries: row.countries.value.split(' ').filter(Boolean).map(qid),
        });
      }
    }
    // Join the rows of one event, which can have several classes and dates.
    const merged = new Map();
    for (const event of named) {
      const known = merged.get(event.item);
      if (!known) { merged.set(event.item, event); continue; }
      known.roots = [...new Set([...known.roots, ...event.roots])];
      known.countries = [...new Set([...known.countries, ...event.countries])];
      known.year = Math.min(known.year, event.year);
      known.at ??= event.at;
    }
    writeFileSync(paths.wikidataDisasters, JSON.stringify({ tolls: details, events: [...merged.values()] }));
    console.log(`Disasters: ${details.length} events with a death toll, ${merged.size} events since 1900`);
  },

  // The 300 longest Wikidata rivers of each region, with their lengths in metres and
  // their names in all languages. The names identify the Natural Earth river lines.
  async rivers() {
    const regions = loadRegions().filter(region => region.wikidata);
    // A large country has many thousands of rivers with a length. Rivers of 100 km or more
    // keep its query short. A country with few such rivers gets all of its rivers.
    const query = (item, minimum) => sparql(`SELECT ?river ?meters ?rank WHERE {
      ?river wdt:P17 wd:${item} ; wdt:P31 wd:Q4022 ; p:P2043 ?length .
      ?length psn:P2043/wikibase:quantityAmount ?meters ; wikibase:rank ?rank .
      FILTER(?rank != wikibase:DeprecatedRank && ?meters >= ${minimum})
    } ORDER BY DESC(?meters) LIMIT 300`);
    // Results so far, so that a failed run can continue where it stopped.
    const partial = `${paths.wikidataRivers}.regions.json`;
    const byRegion = existsSync(partial) ? readJson(partial) : {};
    for (const region of regions) {
      if (byRegion[region.id]) continue;
      let rows = await query(region.wikidata, 100000);
      if (rows.length < 20) rows = await query(region.wikidata, 0);
      byRegion[region.id] = rows.map(row => [qid(row.river.value), Number(row.meters.value), row.rank.value.endsWith('PreferredRank')]);
      writeFileSync(partial, JSON.stringify(byRegion));
      console.log(`Rivers: ${region.id} ${rows.length}`);
    }
    // Some long rivers belong to a subclass of river, such as "main stem" (the Zambezi).
    // These classes have few items, so one query for each class covers all countries.
    // Wadis and arroyos are dry most of the year and are not included.
    const regionByItem = new Map(regions.map(region => [region.wikidata, region.id]));
    const subclasses = ['Q573344', 'Q4366834', 'Q108822533', 'Q98242145', 'Q98242280', 'Q12099220', 'Q16465938',
      'Q1074069', 'Q11514609', 'Q3073652', 'Q115327931', 'Q4733366', 'Q56297530', 'Q590219'];
    for (const kind of subclasses) {
      const rows = await sparql(`SELECT ?river ?meters ?rank ?country WHERE {
        ?river wdt:P31 wd:${kind} ; wdt:P17 ?country ; p:P2043 ?length .
        ?length psn:P2043/wikibase:quantityAmount ?meters ; wikibase:rank ?rank .
        FILTER(?rank != wikibase:DeprecatedRank && ?meters >= 20000)
      }`);
      for (const row of rows) {
        const id = regionByItem.get(qid(row.country.value));
        if (!id) continue;
        byRegion[id] ??= [];
        const entry = [qid(row.river.value), Number(row.meters.value), row.rank.value.endsWith('PreferredRank')];
        if (!byRegion[id].some(known => known.join() === entry.join())) byRegion[id].push(entry);
      }
      console.log(`Rivers: class ${kind} ${rows.length}`);
    }
    const rivers = {};
    for (const [id, rows] of Object.entries(byRegion)) {
      for (const [item, m, preferred] of rows) {
        const river = rivers[item] ??= { lengths: [], regions: [], names: [] };
        if (!river.lengths.some(length => length.m === m && length.preferred === preferred)) river.lengths.push({ m, preferred });
        if (!river.regions.includes(id)) river.regions.push(id);
      }
    }
    const ids = Object.keys(rivers);
    for (let start = 0; start < ids.length; start += 250) {
      const rows = await sparql(`SELECT ?river ?kind ?name WHERE {
        VALUES ?river { ${ids.slice(start, start + 250).map(id => `wd:${id}`).join(' ')} }
        VALUES ?kind { rdfs:label skos:altLabel }
        ?river ?kind ?name .
      }`);
      for (const row of rows) {
        const river = rivers[qid(row.river.value)];
        if (row.kind.value.endsWith('#label') && row.name['xml:lang'] === 'en') river.label = row.name.value;
        if (!river.names.includes(row.name.value)) river.names.push(row.name.value);
      }
    }
    writeFileSync(paths.wikidataRivers, JSON.stringify(rivers));
    console.log(`Rivers: ${ids.length} rivers with a length`);
  },

  // Membership statements of the regions in the organizations on the card, with their
  // start and end dates and any role, such as observer.
  async memberships() {
    const regionByItem = new Map(loadRegions().map(region => [region.wikidata, region.id]));
    const byItem = new Map(organizations.filter(org => org.wikidata).map(org => [org.wikidata, org.key]));
    const rows = await sparql(`SELECT ?org ?country ?start ?end ?roleLabel ?rank WHERE {
      VALUES ?org { ${[...byItem.keys()].map(id => `wd:${id}`).join(' ')} }
      ?country p:P463 ?statement . ?statement ps:P463 ?org ; wikibase:rank ?rank .
      OPTIONAL { ?statement pq:P580 ?start } OPTIONAL { ?statement pq:P582 ?end }
      OPTIONAL { ?statement pq:P2868 ?role }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }`);
    const result = {};
    for (const row of rows) {
      const id = regionByItem.get(qid(row.country.value));
      if (!id) continue;
      (result[byItem.get(qid(row.org.value))] ??= []).push({
        id, start: row.start?.value.slice(0, 10) ?? null, end: row.end?.value.slice(0, 10) ?? null,
        role: row.roleLabel?.value ?? null, rank: row.rank.value.split('#')[1],
      });
    }
    writeFileSync(paths.wikidataMemberships, JSON.stringify(result));
    console.log(`Memberships: ${rows.length} statements`);
  },

  // Pew Research Center: religious composition of 201 countries and territories, 2010 and 2020.
  async religion() {
    await download('https://www.pewresearch.org/wp-content/uploads/sites/20/2025/06/Religious-Composition-2010-2020-dataset.zip', paths.religionZip);
    execFileSync('unzip', ['-o', '-q', paths.religionZip, '-d', dirname(paths.religionZip)]);
  },
};

const requested = process.argv.slice(2);
for (const name of requested.length ? requested : Object.keys(steps)) {
  if (!steps[name]) throw new Error(`Unknown step ${name}. Use ${Object.keys(steps).join(', ')}.`);
  await steps[name]();
}
