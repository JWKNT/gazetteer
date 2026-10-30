// The longest river of each region. Wikidata gives the rivers of each country with
// their lengths. Natural Earth gives the river lines. A line takes the identity of a
// Wikidata river with the same name in a region that the line passes through.
import { geoContains, geoBounds, geoLength } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize } from 'topojson-client';
import { readJson, requireFile } from './sources.mjs';

const generic = /\b(river|rio|rivière|riviere|fleuve|the)\b/g;
export const normal = name => String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[’'`]/g, '').replace(generic, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// The length in kilometres: the preferred value, or else the largest value.
export function lengthKm(river) {
  const preferred = river.lengths.filter(length => length.preferred);
  const values = (preferred.length ? preferred : river.lengths).map(length => length.m);
  return Math.round(Math.max(...values) / 1000);
}

// Natural Earth lines: the global 1:10m set first (layer 0), then the detailed sets for
// Europe and North America. Lines without a name cannot be identified.
export function loadRiverLines(layerPaths) {
  const lines = [];
  layerPaths.forEach((path, layer) => {
    for (const feature of readJson(requireFile(path)).features) {
      const p = feature.properties;
      if (!feature.geometry || !(p.name || p.name_en)) continue;
      const names = [...new Set([p.name, p.name_en, p.name_alt].filter(Boolean).map(normal).filter(Boolean))];
      lines.push({ feature, layer, names, item: p.wikidataid || null });
    }
  });
  return lines;
}

// Reviewed splits of a line that Natural Earth draws along two rivers. The part north of
// the latitude in the rule goes to the river that the rule names.
export function splitLines(lines, rules = []) {
  return lines.flatMap(line => {
    const rule = rules.find(rule => line.layer === 0 && line.names.includes(normal(rule.name)) && line.feature.properties.rivernum === rule.rivernum);
    if (!rule) return [line];
    const parts = line.feature.geometry.type === 'LineString' ? [line.feature.geometry.coordinates] : line.feature.geometry.coordinates;
    const piece = (keep, item) => ({
      ...line, item,
      feature: { ...line.feature, geometry: { type: 'MultiLineString', coordinates: parts.map(part => part.filter(keep)).filter(part => part.length > 1) } },
    });
    return [piece(([, lat]) => lat >= rule.latitude, rule.north), piece(([, lat]) => lat <= rule.latitude, line.item)];
  });
}

// The regions that a line passes through or runs along. Each point is tested with
// four neighbours about 3 km away, so a river on a boundary counts for both sides. A
// region needs two points inside it, or eight points near it, so a river whose source
// or mouth is only close to a boundary does not count.
export function regionsOfLine(line, shapes) {
  const inside = new Map(), near = new Map();
  const add = (counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1);
  const coordinates = line.feature.geometry.type === 'LineString' ? [line.feature.geometry.coordinates] : line.feature.geometry.coordinates;
  const step = 0.03;
  // The vertices lie less than 1 km apart, so every second vertex is enough.
  for (const [lon, lat] of coordinates.flatMap(part => part.filter((_, index) => index % 2 === 0 || index === part.length - 1))) {
    const here = regionAt([lon, lat], shapes);
    if (here) add(inside, here);
    const around = new Set([[lon + step, lat], [lon - step, lat], [lon, lat + step], [lon, lat - step]]
      .map(point => regionAt(point, shapes)).filter(id => id && id !== here));
    for (const id of around) add(near, id);
  }
  return new Set([...new Set([...inside.keys(), ...near.keys()])]
    .filter(id => (inside.get(id) ?? 0) >= 2 || (near.get(id) ?? 0) >= 8));
}

// The region at a point, cached on a grid of 0.01 degrees, about 1 km. Neighbouring
// points of a line share a cell, so most points need no new test.
const cells = new Map();
function regionAt([lon, lat], shapes) {
  const key = `${Math.round(lon * 100)} ${Math.round(lat * 100)}`;
  if (!cells.has(key)) {
    const point = [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
    cells.set(key, shapes.find(entry => contains(entry, point))?.id ?? null);
  }
  return cells.get(key);
}

function contains(entry, [lon, lat]) {
  const [[west, south], [east, north]] = entry.bounds;
  if (lat < south || lat > north) return false;
  if (west <= east ? lon < west || lon > east : lon < west && lon > east) return false;
  return geoContains(entry.feature, [lon, lat]);
}

export function shapeIndex(features) {
  return features.map(feature => ({ id: feature.properties.id, feature, bounds: geoBounds(feature) }));
}

// Link each line to a Wikidata river: by a reviewed join, by its Wikidata ID, or by a
// shared name with a river of one of the regions that the line passes through. Where
// two rivers share the name, the river in more of the line's regions wins, then the
// river whose English label has the name, then the longer river. A join gives the
// lines that Natural Earth names after a part of a longer river, such as the White Nile.
export function linkLines(lines, rivers, shapes, joins = {}) {
  const joined = new Map(Object.entries(joins).flatMap(([item, names]) => names.map(name => [normal(name), item])));
  const byName = new Map();
  for (const [item, river] of Object.entries(rivers)) {
    for (const name of new Set(river.names.map(normal))) {
      if (!name) continue;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(item);
    }
  }
  const links = new Map();
  for (const line of lines) {
    line.regions = regionsOfLine(line, shapes);
    let item = [...line.names.map(name => joined.get(name)), line.item].find(id => id && rivers[id]) ?? null;
    if (!item) {
      const candidates = [...new Set(line.names.flatMap(name => byName.get(name) ?? []))]
        .filter(id => rivers[id].regions.some(region => line.regions.has(region)));
      candidates.sort((a, b) => {
        const shared = id => rivers[id].regions.filter(region => line.regions.has(region)).length;
        const labelled = id => line.names.includes(normal(rivers[id].label)) ? 0 : 1;
        return shared(b) - shared(a) || labelled(a) - labelled(b) || lengthKm(rivers[b]) - lengthKm(rivers[a]);
      });
      item = candidates[0] ?? null;
    }
    if (!item) continue;
    if (!links.has(item)) links.set(item, []);
    links.get(item).push(line);
  }
  // A river that the global set draws in full keeps only those lines, so that the
  // detailed sets add no second copy of it. Where the global lines cover less than
  // 80% of the detailed course, both are kept.
  const length = list => list.reduce((sum, line) => sum + geoLength(line.feature), 0);
  for (const [item, list] of links) {
    const global = list.filter(line => line.layer === 0);
    const detailed = list.filter(line => line.layer > 0);
    if (global.length && length(global) >= 0.8 * length(detailed)) links.set(item, global);
  }
  return links;
}

// One TopoJSON object of river lines. Each geometry lists the regions for which it is
// the longest river.
export function riverTopology(entries) {
  const collection = {
    type: 'FeatureCollection',
    features: entries.map(({ lines, regions }) => ({
      type: 'Feature',
      properties: { regions: [...regions].sort() },
      geometry: {
        type: 'MultiLineString',
        coordinates: lines.flatMap(line => line.feature.geometry.type === 'LineString'
          ? [line.feature.geometry.coordinates] : line.feature.geometry.coordinates),
      },
    })),
  };
  const topo = presimplify(topology({ rivers: collection }, 1e6));
  return quantize(simplify(topo, quantile(topo, 0.3)), 1e5);
}
