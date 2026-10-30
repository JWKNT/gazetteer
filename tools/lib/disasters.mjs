// The deadliest natural disaster of each region since 1900.
// EM-DAT gives deaths by country, year and type. Wikidata gives named events, which
// name an EM-DAT entry when the country, year and type agree. Droughts are left out,
// because their death tolls are mostly deaths from famine.
import { readFileSync } from 'node:fs';
import { csvRows } from './sources.mjs';

export const emdatTypes = {
  earthquake: 'Earthquake', volcanic_activity: 'Volcanic eruption', flood: 'Flood', landslide: 'Landslide',
  extreme_weather: 'Storm', wildfire: 'Wildfire', extreme_temperature: 'Extreme temperature',
};

// Wikidata classes that match each EM-DAT type. EM-DAT counts tsunamis as earthquakes.
const rootsFor = {
  earthquake: ['Q7944', 'Q8070'], volcanic_activity: ['Q7692360'], flood: ['Q8068'], landslide: ['Q167903'],
  extreme_weather: ['Q8092', 'Q8081', 'Q81054'], wildfire: ['Q169950'], extreme_temperature: ['Q215864', 'Q642683'],
};

// EM-DAT files events of 1900 to 1991 under the state of that time, for example the USSR.
// For the successor states, a Wikidata event in the country can be the deadliest.
export const successorStates = new Set(['ARM', 'AZE', 'BLR', 'EST', 'GEO', 'KAZ', 'KGZ', 'LVA', 'LTU', 'MDA', 'RUS',
  'TJK', 'TKM', 'UKR', 'UZB', 'BIH', 'HRV', 'MKD', 'MNE', 'SRB', 'SVN', 'XKX', 'CZE', 'SVK', 'DEU', 'YEM']);

// EM-DAT entries by ISO 3166 alpha-3 code: [{ year, type, deaths }].
export function readEmdat(path) {
  const [header, ...rows] = csvRows(readFileSync(path, 'utf8'));
  const column = name => header.indexOf(name);
  const byCode = new Map();
  for (const row of rows) {
    const code = row[column('code')];
    const year = Number(row[column('year')]);
    if (!code || code.startsWith('OWID') || year < 1900) continue;
    for (const type of Object.keys(emdatTypes)) {
      const deaths = Number(row[column(`total_dead_${type}_yearly`)]);
      if (!(deaths > 0)) continue;
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({ year, type, deaths: Math.round(deaths) });
    }
  }
  return byCode;
}

export function eventType(event) {
  const roots = new Set(event.roots);
  const label = event.label.toLowerCase();
  if (roots.has('Q7944') && (roots.has('Q8070') || label.includes('tsunami'))) return 'Earthquake and tsunami';
  if (roots.has('Q7944') || label.includes('earthquake')) return 'Earthquake';
  if (roots.has('Q8070')) return 'Tsunami';
  if (roots.has('Q7692360') || label.includes('eruption')) return 'Volcanic eruption';
  if (label.includes('hurricane')) return 'Hurricane';
  if (label.includes('typhoon')) return 'Typhoon';
  if (roots.has('Q8092') || label.includes('cyclone')) return 'Tropical cyclone';
  if (roots.has('Q8081') || label.includes('tornado')) return 'Tornado';
  if (roots.has('Q8068') || label.includes('flood')) return 'Flood';
  if (roots.has('Q167903') || label.includes('landslide')) return 'Landslide';
  if (roots.has('Q215864') || label.includes('heat wave')) return 'Heat wave';
  if (roots.has('Q642683') || label.includes('cold wave')) return 'Cold wave';
  if (roots.has('Q169950') || label.includes('fire')) return 'Wildfire';
  if (roots.has('Q81054') || label.includes('storm')) return 'Storm';
  if (roots.has('Q43059') || label.includes('drought')) return 'Drought';
  return 'Natural disaster';
}

// tolls: Wikidata events with a death toll in this region. events: all Wikidata events
// in this region since 1900. Each event carries the number of countries it affects.
export function deadliestDisaster(region, emdat, tolls, events, override) {
  if (override) return override;
  const entries = region.emdatCodes.flatMap(code => emdat.get(code) ?? []);
  const best = entries.sort((a, b) => b.deaths - a.deaths)[0] ?? null;
  const usable = tolls.filter(event => event.year >= 1900 && eventType(event) !== 'Drought');
  // A single-country event can stand in where EM-DAT has no record for the country.
  const alone = usable.filter(event => event.countryCount <= 1).sort((a, b) => b.deaths - a.deaths)[0];
  if (alone && (!best || (successorStates.has(region.id) && alone.deaths > best.deaths))) {
    return { name: alone.label, type: eventType(alone), year: alone.year, deaths: Math.round(alone.deaths), source: 'Wikidata' };
  }
  if (!best) return null;
  // Name the EM-DAT entry with a Wikidata event of the same year and type. Prefer an
  // event whose toll is similar. An event in several countries has a total toll, so
  // it can be larger. Otherwise take the event that most Wikipedia editions describe.
  const sameKind = event => event.year === best.year && event.roots.some(root => rootsFor[best.type].includes(root));
  const tolled = usable.filter(event => sameKind(event)
    && event.deaths >= best.deaths / 4 && (event.countryCount > 1 || event.deaths <= best.deaths * 4));
  tolled.sort((a, b) => Math.abs(Math.log(a.deaths / best.deaths)) - Math.abs(Math.log(b.deaths / best.deaths)));
  const labelled = event => !/^Q\d+$/.test(event.label);
  const named = tolled.filter(labelled)[0] ?? events.filter(event => sameKind(event) && labelled(event)).sort((a, b) => b.links - a.links)[0];
  return {
    ...(named ? { name: named.label } : {}),
    type: named ? eventType(named) : emdatTypes[best.type],
    year: best.year,
    deaths: best.deaths,
    source: 'EM-DAT',
  };
}
