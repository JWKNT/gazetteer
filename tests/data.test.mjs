import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const world = JSON.parse(read('data/world.json'));
const { regions, collected } = JSON.parse(read('data/countries.json'));
const shapeIds = new Set(world.objects.countries.geometries.map(g => g.properties.id));

test('every globe shape has a region and every region has a shape', () => {
  for (const id of shapeIds) assert.ok(regions[id], `region for shape ${id}`);
  for (const id of Object.keys(regions)) assert.ok(shapeIds.has(id), `shape for region ${id}`);
  assert.ok(Object.keys(regions).length >= 240);
  assert.match(collected, /^\d{1,2} [A-Z][a-z]+ \d{4}$/);
});

test('no simplified shape is wound backwards', async () => {
  const { feature, merge } = await import('topojson-client');
  const { geoArea } = await import('d3-geo');
  const sphere = 4 * Math.PI;
  for (const shape of feature(world, world.objects.countries).features) {
    assert.ok(geoArea(shape) < sphere / 2, `${shape.properties.id} covers less than a hemisphere`);
  }
  // Land is about 29% of the surface of the Earth.
  const share = geoArea(merge(world, world.objects.countries.geometries)) / sphere;
  assert.ok(share > 0.27 && share < 0.31, `land share ${share}`);
});

test('the coarse set for motion is valid and small', async () => {
  const { feature } = await import('topojson-client');
  const { geoArea } = await import('d3-geo');
  const coarse = JSON.parse(read('data/world-coarse.json'));
  assert.deepEqual(Object.keys(coarse.objects).sort(), ['borders', 'disputed', 'land']);
  const share = geoArea(feature(coarse, coarse.objects.land)) / (4 * Math.PI);
  assert.ok(share > 0.27 && share < 0.31, `coarse land share ${share}`);
  assert.ok(read('data/world-coarse.json').length < 100 * 1024);
});

test('the precomputed line sets are present', () => {
  for (const name of ['borders', 'disputed']) {
    assert.equal(world.objects[name].type, 'MultiLineString', name);
    assert.ok(world.objects[name].arcs.length > 0, name);
  }
  assert.ok(world.objects.disputed.arcs.length >= 6, 'disputed boundaries are drawn');
});

test('each region record has a valid shape', () => {
  for (const [id, region] of Object.entries(regions)) {
    assert.ok(region.name, id);
    assert.equal(region.focus.length, 3, `${id} focus`);
    assert.ok(Array.isArray(region.cities) && region.cities.length <= 10, `${id} cities`);
    let previous = Infinity;
    for (const [name, population, year, lat, lon] of region.cities) {
      assert.ok(name && typeof name === 'string', `${id} city name`);
      assert.ok(Number.isInteger(population) && population > 0, `${id} ${name} population`);
      assert.ok(population <= previous, `${id} cities are in order`);
      previous = population;
      assert.ok(year === null || (year >= 1990 && year <= 2026), `${id} ${name} year ${year}`);
      assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180, `${id} ${name} position`);
    }
    if (region.unassigned) continue;
    assert.ok(Array.isArray(region.languages.list), `${id} languages`);
    if (region.gdp) assert.ok(region.gdp.usd > 0 && region.gdp.year >= 2000 && region.gdp.source, `${id} GDP`);
    if (region.highest && region.lowest) assert.ok(region.highest.m >= region.lowest.m, `${id} elevation order`);
    if (region.exports) assert.ok(region.exports.items.length >= 1 && region.exports.items.length <= 5, `${id} exports`);
    if (region.lake) assert.ok(region.lake.name && (region.lake.km2 === null || region.lake.km2 > 0), `${id} lake`);
  }
});

test('the city lists exclude districts of a larger city', () => {
  const names = id => regions[id].cities.map(city => city[0]);
  assert.equal(names('USA')[0], 'New York City');
  for (const borough of ['Brooklyn', 'Queens', 'Manhattan', 'The Bronx']) assert.ok(!names('USA').includes(borough), borough);
  assert.ok(!names('MEX').some(name => /Iztapalapa|Gustavo A\. Madero/.test(name)));
  assert.ok(!names('FRA').some(name => /Arrondissement|Marne/.test(name)));
  assert.ok(!names('THA').some(name => /Bang Khae|Sai Mai|Chatuchak/.test(name)));
  assert.ok(names('NLD').indexOf('Amsterdam') < names('NLD').indexOf('Rotterdam'));
  assert.ok(names('CHE').includes('Geneva'));
});

test('representative values match their sources', () => {
  assert.equal(regions.JPN.highest.name, 'Mount Fuji');
  assert.equal(regions.JPN.highest.m, 3776);
  assert.equal(regions.FRA.highest.name, 'Mont Blanc');
  assert.ok(regions.CHE.languages.list.includes('Romansh'));
  assert.equal(regions.ZAF.languages.list.length, 12);
  assert.equal(regions.TWN.gdp.source, 'IMF');
  assert.equal(regions.USA.gdp.source, 'World Bank');
  assert.equal(regions.RUS.lake.name, 'Caspian Sea');
  assert.equal(regions.GHA.lake.kind, 'reservoir');
  assert.ok(regions.KAS.unassigned && regions.KAS.note);
  assert.equal(regions.CHN.cities[0][0], 'Chongqing');
});

test('population, disasters and positions are present and plausible', () => {
  const records = Object.entries(regions).filter(([, region]) => !region.unassigned);
  assert.ok(records.filter(([, region]) => region.population?.count > 0).length >= 225);
  for (const [id, region] of records) {
    const disaster = region.disaster;
    if (disaster) {
      assert.ok(disaster.year >= 1900 && disaster.year <= 2026, `${id} disaster year`);
      assert.ok(Number.isInteger(disaster.deaths) && disaster.deaths > 0, `${id} disaster deaths`);
      assert.ok(disaster.type && !/drought/i.test(disaster.type), `${id} disaster type`);
      assert.doesNotMatch(disaster.name ?? '', /^Q\d+$/, `${id} disaster name`);
    }
    for (const key of ['highest', 'lowest']) {
      const at = region[key]?.at;
      if (at) assert.ok(Math.abs(at[0]) <= 180 && Math.abs(at[1]) <= 90, `${id} ${key} position`);
    }
  }
  assert.equal(regions.HTI.disaster.year, 2010);
  assert.equal(regions.JPN.disaster.year, 1923);
  assert.equal(regions.BGD.disaster.name, '1970 Bhola cyclone');
  assert.equal(regions.TKM.disaster.name, '1948 Ashgabat earthquake');
  const [lon, lat] = regions.USA.highest.at;
  assert.ok(Math.abs(lon + 151) < 1 && Math.abs(lat - 63) < 1, 'Denali is in Alaska');
});

test('capitals point to a city row or have a position of their own', () => {
  for (const [id, region] of Object.entries(regions)) {
    const capital = region.capital;
    if (!capital) continue;
    assert.ok(capital.name, `${id} capital name`);
    if (capital.city !== undefined) assert.ok(region.cities[capital.city], `${id} capital row`);
    else assert.ok(Math.abs(capital.at[0]) <= 180 && Math.abs(capital.at[1]) <= 90, `${id} capital position`);
  }
  assert.equal(regions.FRA.cities[regions.FRA.capital.city][0], 'Paris');
  assert.equal(regions.USA.capital.name, 'Washington');
  assert.ok(regions.USA.capital.at, 'Washington is not one of the ten largest US cities');
  assert.equal(regions.TZA.cities[regions.TZA.capital.city][0], 'Dodoma');
  assert.ok(regions.NLD.capital.note && regions.ISR.capital.note);
  for (const id of ['HKG', 'MAC', 'ESH']) assert.equal(regions[id].capital, undefined, id);
  assert.ok(Object.values(regions).filter(region => region.capital).length >= 225);
});

test('religion gives the largest group and its share', () => {
  for (const [id, region] of Object.entries(regions)) {
    const religion = region.religion;
    if (!religion) continue;
    assert.ok(religion.name && religion.source, `${id} religion`);
    if (religion.share !== null) assert.ok(religion.share > 0 && religion.share <= 100, `${id} religion share`);
    if (religion.next) assert.ok(religion.next.share <= religion.share, `${id} next group is smaller`);
  }
  assert.equal(regions.IND.religion.name, 'Hinduism');
  assert.equal(regions.SAU.religion.name, 'Islam');
  assert.equal(regions.CHN.religion.name, 'No religion');
  assert.equal(regions.CHN.religion.next.name, 'Buddhism');
  assert.equal(regions.USA.religion.year, 2020);
  assert.ok(Object.values(regions).filter(region => region.religion).length >= 225);
});

test('disasters have names where the sources give one', () => {
  const records = Object.values(regions).filter(region => region.disaster);
  assert.ok(records.filter(region => region.disaster.name).length >= 180);
  assert.equal(regions.BHS.disaster.name, 'Hurricane Dorian');
  assert.equal(regions.PNG.disaster.type, 'Volcanic eruption');
});

test('each drawn river has a line, and lengths are plausible', () => {
  const rivers = JSON.parse(read('data/rivers.json'));
  const drawn = new Set(rivers.objects.rivers.geometries.flatMap(shape => shape.properties.regions));
  for (const [id, region] of Object.entries(regions)) {
    const river = region.river;
    if (!river) continue;
    assert.ok(river.name && (river.km === null || (river.km > 0 && river.km <= 7000)), `${id} river ${river.name} ${river.km}`);
    assert.equal(Boolean(river.drawn), drawn.has(id), `${id} river line`);
    assert.ok(!river.shared.includes(region.name), `${id} river countries`);
  }
  assert.equal(regions.EGY.river.name, 'Nile');
  assert.equal(regions.BRA.river.name, 'Amazon River');
  assert.equal(regions.CHN.river.name, 'Yangtze River');
  assert.ok(regions.DEU.river.shared.includes('Ukraine'), 'a reviewed river lists its region');
  assert.equal(regions.BOL.river.name, 'Paraguay River');
  assert.ok(read('data/rivers.json').length < 300 * 1024);
});

test('each outlined lake has a shape, and the globe has map lakes', () => {
  const lakes = JSON.parse(read('data/lakes.json'));
  const shapes = lakes.objects.lakes.geometries;
  const outlined = new Set(shapes.flatMap(shape => shape.properties.regions ?? []));
  for (const [id, region] of Object.entries(regions)) {
    if (region.lake?.outline) assert.ok(outlined.has(id), `${id} lake outline`);
  }
  assert.ok(shapes.filter(shape => shape.properties.map).length >= 50);
  assert.ok(read('data/lakes.json').length < 220 * 1024);
});
