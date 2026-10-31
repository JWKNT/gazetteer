// Shared paths and parsers for the source snapshot in .cache/.
// The cache holds downloaded data only. No downloaded file is executed.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const cache = `${root}.cache/`;

export const paths = {
  naturalEarth: `${cache}naturalearth/ne_50m_admin_0_countries.geojson`,
  naturalEarthDetail: `${cache}naturalearth/ne_10m_admin_0_countries.geojson`,
  naturalEarthLakes: ['ne_50m_lakes', 'ne_10m_lakes', 'ne_10m_lakes_europe', 'ne_10m_lakes_north_america']
    .map(name => `${cache}naturalearth/${name}.geojson`),
  naturalEarthMarine: `${cache}naturalearth/ne_50m_geography_marine_polys.geojson`,
  geonamesZip: `${cache}geonames/cities500.zip`,
  geonames: `${cache}geonames/cities500.txt`,
  geonamesCountries: `${cache}geonames/countryInfo.txt`,
  factbookArchive: `${cache}factbook/factbook.tar.gz`,
  factbook: `${cache}factbook/factbook.json-master/`,
  worldBank: `${cache}worldbank/gdp.json`,
  worldBankPopulation: `${cache}worldbank/population.json`,
  disasters: `${cache}owid/natural-disasters-deaths.csv`,
  wikidataDisasters: `${cache}wikidata/disasters.json`,
  wikidataExtremes: `${cache}wikidata/extremes.json`,
  wikidataLakePoints: `${cache}wikidata/lake-points.json`,
  imf: `${cache}imf/ngdpd.json`,
  wikidataCities: `${cache}wikidata/cities.json`,
  wikidataLakes: `${cache}wikidata/lakes.json`,
  wikidataRivers: `${cache}wikidata/rivers.json`,
  wikidataMemberships: `${cache}wikidata/memberships.json`,
  naturalEarthRivers: ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe', 'ne_10m_rivers_north_america']
    .map(name => `${cache}naturalearth/${name}.geojson`),
  religionZip: `${cache}pew/religious-composition.zip`,
  religion: `${cache}pew/Religious Composition 2010-2020 dataset/Religious Composition 2010-2020 (percentages).csv`,
  manifest: `${cache}manifest.json`,
};

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

// Rows of a CSV file. Quoted cells can hold commas.
export function csvRows(text) {
  const rows = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line) continue;
    const cells = [];
    let cell = '', quoted = false;
    for (const char of line) {
      if (char === '"') quoted = !quoted;
      else if (char === ',' && !quoted) { cells.push(cell); cell = ''; }
      else cell += char;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

export function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Missing ${path}. Run npm run fetch first.`);
  return path;
}

// GeoNames feature codes for whole settlements. Sections (PPLX), localities (PPLL),
// historical, abandoned, destroyed and religious places, and settlements (STLMT)
// are excluded so that a district cannot rank as a separate city.
export const settlementCodes = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4', 'PPLA5', 'PPLC', 'PPLG']);

export function readGeonames() {
  const rows = [];
  for (const line of readFileSync(requireFile(paths.geonames), 'utf8').split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    if (!settlementCodes.has(f[7])) continue;
    rows.push({
      geonameId: f[0],
      name: f[1],
      lat: Number(f[4]),
      lon: Number(f[5]),
      code: f[7],
      country: f[8],
      admin1: f[10],
      population: Number(f[14]) || 0,
    });
  }
  return rows;
}

// The candidate pool for each country: its most populous GeoNames settlements.
export function cityCandidates(rows, perCountry = 60) {
  const byCountry = new Map();
  for (const row of rows) {
    if (!byCountry.has(row.country)) byCountry.set(row.country, []);
    byCountry.get(row.country).push(row);
  }
  const pool = new Map();
  for (const [country, list] of byCountry) {
    list.sort((a, b) => b.population - a.population);
    pool.set(country, list.slice(0, perCountry));
  }
  return pool;
}
