// Rank the most populous cities of each country.
// GeoNames supplies the candidate settlements. Wikidata identifies each candidate
// and supplies a dated official population. A place that Wikidata classes only as
// a part of a larger city (a borough, a district or a neighborhood) is excluded.

// Wikidata classes for parts of a city. A candidate with one of these classes and
// no separate city class is a district, not a city.
export const partOfCityClasses = new Set([
  'Q408804', // borough of New York City
  'Q123705', // neighborhood
  'Q188509', // suburb
  'Q2983893', // quarter
  'Q702842', // municipal arrondissement of France
  'Q252916', // administrative quarter of Paris
  'Q705296', // district of Taiwan
  'Q4286337', 'Q42723927', // city district
  'Q15642599', // urban district (part of a city)
  'Q519630', // South African township
  'Q3032114', // district of Madrid
  'Q2597772', // district of Antwerp
  'Q1852119', // district of Graz
  'Q5283513', // district of Espoo
  'Q3394564', // quarter of Luxembourg City
  'Q61089180', // municipal part of the Czech Republic
  'Q17309849', // city district of Turkmenistan
  'Q2779745', // urban district of the Netherlands
  'Q1530705', // ward of Nepal
  'Q63241909', // ward of Zambia
  'Q2785216', // municipality section
  'Q12232785', // depopulated Palestinian village
  'Q21507948', // former village
  'Q15243209', // historic district
]);

// Classes that confirm a settlement. They also confirm a city that has a
// part-of-city class as well, such as a city that is a borough of a county.
export const cityClasses = new Set(['Q515', 'Q1549591', 'Q1637706', 'Q200250', 'Q5119', 'Q3957', 'Q15284', 'Q1093829', 'Q486972']);

// Classes strong enough to accept a Wikidata label that differs from the GeoNames
// name, such as Cologne for Köln: city, big city, city with millions, metropolis, capital.
const namedCityClasses = new Set(['Q515', 'Q1549591', 'Q1637706', 'Q200250', 'Q5119']);

const fold = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/\b(city|of|the|municipality|district|metropolitan|special|ward)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();

// A Wikidata item matches when its label shares a word with the GeoNames name, or
// when Wikidata classes it as a city. This rejects wrong links, such as a
// university or a company that carries the GeoNames ID of a city.
function plausible(candidate, record) {
  if (/\b(university|college|school|company|airport|station|stadium|hospital|church|mosque|temple|bank|hotel|club)\b/i.test(record.label ?? '')) return false;
  const a = new Set(fold(candidate.name).split(' ').filter(word => word.length > 2));
  const b = fold(record.label ?? '').split(' ').filter(word => word.length > 2);
  if (b.some(word => a.has(word) || [...a].some(other => other.startsWith(word) || word.startsWith(other)))) return true;
  return Object.keys(record.classes).some(id => namedCityClasses.has(id));
}

function bestPopulation(item) {
  // Prefer the most recent dated figure. An undated figure is used only alone.
  const dated = item.populations.filter(p => p.date && p.value > 0).sort((a, b) => b.date.localeCompare(a.date));
  if (dated.length) return { value: dated[0].value, year: Number(dated[0].date.slice(0, 4)) };
  const undated = item.populations.filter(p => p.value > 0).sort((a, b) => b.value - a.value);
  return undated.length ? { value: undated[0].value, year: null } : null;
}

function isPartOfCity(item) {
  const classes = Object.keys(item.classes);
  return classes.some(id => partOfCityClasses.has(id)) && !classes.some(id => cityClasses.has(id) && id !== 'Q486972');
}

// Choose the Wikidata item for a GeoNames ID. Several items can share one ID,
// for example a city and its municipality. Prefer a plausible item with a population.
function chooseItem(candidate, items) {
  const entries = Object.entries(items ?? {}).filter(([, record]) => plausible(candidate, record));
  entries.sort(([, a], [, b]) => Number(Boolean(bestPopulation(b))) - Number(Boolean(bestPopulation(a))));
  return entries[0] ?? null;
}

// Wikidata labels sometimes name an administrative unit ("Madrid city", "City of
// Valencia", "Bayamón barrio-pueblo"). Keep the place name only.
function displayName(candidate, label) {
  if (!label || /^Q\d+$/.test(label)) return candidate.name;
  let name = label;
  if (!candidate.name.includes('(')) name = name.replace(/ \([^)]*\)$/, '');
  if (!candidate.name.includes(',')) name = name.split(', ')[0];
  return name
    .replace(/^City of /, '')
    .replace(/ city$/, '')
    .replace(/ (?:barrio-pueblo|administrative post|Etrap|City Municipality|Municipality|urban area|central locality)$/, '')
    .trim();
}

export function rankCities(candidates, facts, curated = {}, limit = 10) {
  const exclude = new Set(curated.exclude ?? []);
  const ignore = new Set(curated.ignoreWikidata ?? []);
  const ignoreCountries = new Set(curated.ignoreWikidataCountries ?? []);
  const seen = new Set();
  const ranked = [];
  for (const candidate of candidates) {
    if (exclude.has(candidate.geonameId)) continue;
    // Districts of a city-province, for example the khet of Bangkok.
    const within = curated.excludeAdmin1?.[candidate.country];
    if (within && candidate.admin1 === within.admin1 && !within.except.includes(candidate.geonameId)) continue;
    const linked = ignore.has(candidate.geonameId) || ignoreCountries.has(candidate.country) ? null : facts[candidate.geonameId];
    const [item, record] = chooseItem(candidate, linked) ?? [null, null];
    if (record && isPartOfCity(record)) continue;
    const key = item ?? `${candidate.name}|${candidate.population}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let official = record ? bestPopulation(record) : null;
    // A Wikidata figure far above the GeoNames figure usually counts a wider area,
    // such as a province or a metropolitan region. Use the GeoNames figure then.
    if (official && candidate.population && official.value > 2.5 * candidate.population) official = null;
    const override = curated.population?.[candidate.geonameId];
    ranked.push({
      name: curated.rename?.[candidate.geonameId] ?? displayName(candidate, record?.label),
      population: override?.value ?? official?.value ?? candidate.population,
      year: override ? override.year : official ? official.year : null,
      geonameId: candidate.geonameId,
      wikidata: item,
      lat: candidate.lat,
      lon: candidate.lon,
    });
  }
  ranked.sort((a, b) => b.population - a.population);
  return ranked.filter(city => city.population > 0).slice(0, limit);
}
