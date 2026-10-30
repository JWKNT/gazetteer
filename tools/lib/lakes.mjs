// Choose the largest lake of a region from Wikidata and The World Factbook.

// Wikidata water types. The kind is shown when it adds information.
const kinds = {
  Q131681: 'reservoir', Q3215290: 'reservoir', Q187223: 'lagoon', Q188025: 'salt lake',
  Q1140477: 'subglacial lake', Q204324: 'crater lake',
};
const kindOrder = ['reservoir', 'lagoon', 'salt lake', 'subglacial lake', 'crater lake'];

// Former lakes of the Pleistocene and hydrological combinations of two lakes.
const notLakes = /^(Lake (Agassiz|Tauca|Bonneville|Lahontan|Missoula|Ojibway|Iroquois|Algonquin|Chicago|Minchin|Ballivián|Manix|Mojave|Russell|Cahuilla|Makgadikgadi|Michigan–Huron|Mega-Chad)|Mega-Chad|Michigan–Huron)$|paleolake|Glacial Lake /i;

// Merge the per-type rows of one Wikidata lake into one record. A reviewed list
// excludes items with a wrong area and water bodies that are not lakes.
export function indexWikidataLakes(rows, exclude = new Set()) {
  const byItem = new Map();
  for (const row of rows) {
    if (row.dissolved || exclude.has(row.item) || notLakes.test(row.label) || /^Q\d+$/.test(row.label)) continue;
    // No lake is larger than the Caspian Sea. A larger figure is a unit error.
    if (row.area > 400000 || row.area <= 0) continue;
    const record = byItem.get(row.item) ?? { item: row.item, label: row.label, area: row.area, countries: new Set(), kinds: new Set() };
    record.area = Math.max(record.area, row.area);
    for (const country of row.countries) record.countries.add(country);
    if (kinds[row.type]) record.kinds.add(kinds[row.type]);
    byItem.set(row.item, record);
  }
  const byCountry = new Map();
  for (const record of byItem.values()) {
    for (const country of record.countries) {
      if (!byCountry.has(country)) byCountry.set(country, []);
      byCountry.get(country).push(record);
    }
  }
  for (const list of byCountry.values()) list.sort((a, b) => b.area - a.area);
  return byCountry;
}

const round = area => area >= 100 ? Math.round(area) : area >= 1 ? Math.round(area * 10) / 10 : Math.round(area * 100) / 100;

// Words that name the kind of water body, not the lake itself.
const generic = /\b(lake|lakes|lago|lac|lagoa|laguna|lagune|ozero|hu|nuur|nur|see|so|jezero|danau|hayk|loch|lough|reservoir|embalse|the|of|de|la|el)\b/g;
const words = name => new Set(name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(generic, ' ').split(/\s+/).filter(word => word.length > 2));
const sameLake = (a, b) => [...words(a)].some(word => words(b).has(word));

export function largestLake(region, wikidataLakes, factbookLakes, namesByWikidata, skipFactbook = []) {
  const fromWikidata = wikidataLakes.get(region.wikidata)?.[0] ?? null;
  const fromFactbook = factbookLakes.filter(lake => !skipFactbook.includes(lake.name))
    .sort((a, b) => (b.km2Max ?? b.km2) - (a.km2Max ?? a.km2))[0] ?? null;
  const wikidataLake = fromWikidata && {
    name: fromWikidata.label,
    km2: round(fromWikidata.area),
    kind: kindOrder.find(kind => fromWikidata.kinds.has(kind)) ?? null,
    shared: [...fromWikidata.countries].filter(id => id !== region.wikidata)
      .map(id => namesByWikidata.get(id)).filter(Boolean).sort(),
    source: 'Wikidata',
  };
  const factbookLake = fromFactbook && {
    name: fromFactbook.name,
    km2: fromFactbook.km2,
    ...(fromFactbook.km2Max ? { km2Max: fromFactbook.km2Max } : {}),
    kind: fromFactbook.salt ? 'salt lake' : null,
    shared: fromFactbook.shared,
    source: 'The World Factbook',
  };
  // Wikidata gives English names, current areas and reservoirs. The Factbook value is
  // used when Wikidata does not record that lake, or a lake of similar size, here.
  if (wikidataLake && factbookLake) {
    const same = sameLake(wikidataLake.name, factbookLake.name);
    return same || wikidataLake.km2 >= factbookLake.km2 * 0.85 ? wikidataLake : factbookLake;
  }
  return wikidataLake ?? factbookLake ?? null;
}
