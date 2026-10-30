// Lake outlines from Natural Earth: the large lakes that the globe always shows, and
// the largest lake of each region, which the globe shows in blue when it is selected.
import { geoArea, geoCentroid, geoDistance } from 'd3-geo';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { quantize, feature as toFeature } from 'topojson-client';
import { paths, readJson, requireFile } from './sources.mjs';

const earthKm = 6371.0088;
const areaKm2 = shape => geoArea(shape) * earthKm * earthKm;

// Layer 0 is the 1:50m set. Layers 1 to 3 are the 1:10m sets, which have more detail.
// The Caspian Sea is a marine polygon, because the country layer leaves it as water.
export function loadLakeLayers() {
  const lakes = paths.naturalEarthLakes.flatMap((path, layer) =>
    readJson(requireFile(path)).features.map(feature => ({ feature, layer, key: `${layer}:${feature.properties.ne_id}` })));
  const caspian = readJson(requireFile(paths.naturalEarthMarine)).features
    .filter(feature => feature.properties.wikidataid === 'Q5484')
    .map(feature => ({ feature, layer: 1, key: 'marine:Q5484' }));
  return [...lakes, ...caspian];
}

const generic = /\b(lake|lakes|lago|lac|lagoa|laguna|lagune|ozero|hu|nuur|nur|see|so|jezero|danau|hayk|loch|lough|reservoir|embalse|buhayrat|the|of|de|la|el)\b/g;
const words = name => new Set(String(name ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]+/g, ' ').replace(generic, ' ').split(/\s+/).filter(word => word.length > 2));

// The Natural Earth features of one lake: by Wikidata ID, or by name near the region.
// Features from the 1:10m sets are preferred.
export function findLakeShapes(lake, region, layers) {
  let found = lake.item ? layers.filter(entry => entry.feature.properties.wikidataid === lake.item) : [];
  if (!found.length && region.focus) {
    const wanted = words(lake.name);
    const [lon, lat, radius] = region.focus;
    found = layers.filter(entry => {
      const p = entry.feature.properties;
      const names = [p.name, p.name_en, p.name_alt].flatMap(name => [...words(name)]);
      if (!names.some(word => wanted.has(word))) return false;
      const reach = (radius + 4) * Math.PI / 180;
      return geoDistance(geoCentroid(entry.feature), [lon, lat]) < reach;
    });
  }
  const detailed = found.filter(entry => entry.layer > 0);
  return detailed.length ? detailed : found;
}

// The lakes that the globe always shows: lakes of 500 km² or more at 1:50m.
export function mapLakes(layers) {
  return layers.filter(entry => entry.layer === 0 && areaKm2(entry.feature) >= 500);
}

// One TopoJSON object of lake outlines. Each geometry says whether the globe always
// shows it ("map") and for which regions it is the largest lake ("regions").
export function lakeTopology(entries) {
  const byKey = new Map();
  for (const { entry, map, region } of entries) {
    const record = byKey.get(entry.key) ?? { entry, map: false, regions: new Set() };
    if (map) record.map = true;
    if (region) record.regions.add(region);
    byKey.set(entry.key, record);
  }
  const collection = {
    type: 'FeatureCollection',
    features: [...byKey.values()].map(({ entry, map, regions }) => ({
      type: 'Feature',
      properties: { ...(map ? { map: 1 } : {}), ...(regions.size ? { regions: [...regions].sort() } : {}) },
      geometry: entry.feature.geometry,
    })),
  };
  let topo = presimplify(topology({ lakes: collection }, 1e6));
  for (const arc of topo.arcs) {
    const [first, last] = [arc[0], arc[arc.length - 1]];
    if (first[0] === last[0] && first[1] === last[1] && arc.length <= 16) for (const point of arc) point[2] = Infinity;
  }
  topo = quantize(simplify(topo, quantile(topo, 0.4)), 1e5);
  // A ring that simplification turned inside out would cover the rest of the sphere.
  for (const shape of toFeature(topo, topo.objects.lakes).features) {
    if (geoArea(shape) > 2 * Math.PI) throw new Error('A simplified lake outline is reversed.');
  }
  return topo;
}
