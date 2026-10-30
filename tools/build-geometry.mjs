// Build data/world.json, the globe's TopoJSON, from Natural Earth admin-0 countries.
// Run: node tools/build-geometry.mjs (after npm run fetch).
import { writeFileSync } from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile, filter, filterWeight } from 'topojson-simplify';
import { quantize, meshArcs, mergeArcs, feature } from 'topojson-client';
import { geoArea, geoBounds, geoDistance } from 'd3-geo';
import { paths, readJson, requireFile, root } from './lib/sources.mjs';
import { regionId, disputedBoundaries } from './lib/regions.mjs';

const source = readJson(requireFile(paths.naturalEarth)).features;
const detail = readJson(requireFile(paths.naturalEarthDetail)).features;

// Gibraltar is absent at 1:50m. Take its outline from the 1:10m set.
const gibraltar = detail.find(feature => feature.properties.ADM0_A3 === 'GIB');
const features = [...source, gibraltar];

// Natural Earth combines Christmas Island and the Cocos (Keeling) Islands as one
// feature. The Factbook and GeoNames describe them separately, so split them.
function split(feature) {
  if (feature.properties.ADM0_A3 !== 'IOA') return [feature];
  const parts = { CXR: [], CCK: [] };
  for (const polygon of feature.geometry.coordinates) {
    parts[polygon[0][0][0] > 100 ? 'CXR' : 'CCK'].push(polygon);
  }
  return Object.entries(parts).map(([code, coordinates]) => ({
    type: 'Feature',
    properties: { ...feature.properties, ADM0_A3: code },
    geometry: { type: 'MultiPolygon', coordinates },
  }));
}

// The point and angular radius to show a country. Natural Earth's label point
// sits on the main landmass. The radius covers the polygon that holds that point
// and any part within 25 degrees of it, so that distant islands do not shrink the view.
function focus(feature) {
  const p = feature.properties;
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let lon = p.LABEL_X, lat = p.LABEL_Y;
  if (p.ADM0_A3 === 'CXR' || p.ADM0_A3 === 'CCK' || !Number.isFinite(lon)) {
    const [[w, s], [e, n]] = geoBounds({ type: 'MultiPolygon', coordinates: polygons });
    lon = (w + e) / 2; lat = (s + n) / 2;
  }
  let radius = 0;
  for (const polygon of polygons) {
    const near = polygon[0].some(point => geoDistance(point, [lon, lat]) < 25 * Math.PI / 180);
    if (!near) continue;
    for (const point of polygon[0]) radius = Math.max(radius, geoDistance(point, [lon, lat]));
  }
  const round = value => Math.round(value * 100) / 100;
  return [round(lon), round(lat), round(radius * 180 / Math.PI)];
}

const collection = { type: 'FeatureCollection', features: [] };
for (const feature of features.flatMap(split)) {
  const id = regionId(feature.properties);
  collection.features.push({
    type: 'Feature',
    properties: { id, part: feature.properties.ADM0_A3, focus: focus(feature) },
    geometry: feature.geometry,
  });
}

// Keep the most visible quarter of the points, then quantize to about 400 m at the
// equator. A small closed ring keeps all its points, and a larger one keeps at
// least four, so islands and enclaves such as Vatican City keep their outline.
function simplified(keep, share, coarse) {
  const topo = presimplify(topology({ countries: collection }, 1e6));
  topo.arcs.forEach((arc, index) => {
    const [first, last] = [arc[0], arc[arc.length - 1]];
    const closed = first[0] === last[0] && first[1] === last[1];
    if (keep.has(index) || (!coarse && closed && arc.length <= 12)) {
      for (const point of arc) point[2] = Infinity;
    } else if (closed && !coarse) {
      for (const point of arc.slice(1, -1).sort((a, b) => b[2] - a[2]).slice(0, 3)) point[2] = Infinity;
    }
  });
  const reduced = simplify(topo, quantile(topo, share));
  // The coarse set drops islands smaller than about 600 km² (0.05 square degrees).
  return quantize(coarse ? filter(reduced, filterWeight(reduced, 0.05)) : reduced, 1e5);
}

// Simplification can make a thin ring cross itself, which reverses its winding.
// d3 then reads the ring as the rest of the sphere. Keep such rings at full detail.
function reversedArcs(topo) {
  const arcs = new Set();
  for (const geometry of topo.objects.countries.geometries) {
    const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
    const coordinates = feature(topo, geometry).geometry;
    const rings = coordinates.type === 'Polygon' ? [coordinates.coordinates] : coordinates.coordinates;
    rings.forEach((rings, index) => {
      if (geoArea({ type: 'Polygon', coordinates: rings }) <= 2 * Math.PI) return;
      for (const ring of polygons[index]) for (const arc of ring) arcs.add(arc < 0 ? ~arc : arc);
    });
  }
  return arcs;
}

function build(share, coarse = false) {
  const keep = new Set();
  let topo = simplified(keep, share, coarse);
  for (let pass = 0; pass < 4; pass++) {
    const reversed = reversedArcs(topo);
    if (!reversed.size) break;
    for (const arc of reversed) keep.add(arc);
    topo = simplified(keep, share, coarse);
  }
  if (reversedArcs(topo).size) throw new Error('Some country rings are still reversed after simplification.');
  return topo;
}

const disputed = (a, b) => disputedBoundaries.some(([x, y]) =>
  (a.properties.part === x && b.properties.part === y) || (a.properties.part === y && b.properties.part === x));

// A coarse set with about a twentieth of the points draws the globe while it moves.
const coarse = build(0.05, true);
coarse.objects = {
  land: mergeArcs(coarse, coarse.objects.countries.geometries),
  borders: meshArcs(coarse, coarse.objects.countries, (a, b) => a !== b && a.properties.id !== b.properties.id && !disputed(a, b)),
  disputed: meshArcs(coarse, coarse.objects.countries, (a, b) => a !== b && disputed(a, b)),
};
writeFileSync(`${root}data/world-coarse.json`, JSON.stringify(coarse));

const topo = build(0.25);
// Precompute the line sets so the page does not need to compare shapes.
const countries = topo.objects.countries;
topo.objects.borders = meshArcs(topo, countries, (a, b) => a !== b && a.properties.id !== b.properties.id && !disputed(a, b));
topo.objects.disputed = meshArcs(topo, countries, (a, b) => a !== b && disputed(a, b));
for (const geometry of countries.geometries) {
  const { id, focus: view } = geometry.properties;
  geometry.properties = { id, focus: view };
}
const output = `${root}data/world.json`;
writeFileSync(output, JSON.stringify(topo));
console.log(`Wrote ${topo.objects.countries.geometries.length} shapes, ${(JSON.stringify(topo).length / 1024).toFixed(0)} KB, and a ${(JSON.stringify(coarse).length / 1024).toFixed(0)} KB coarse set.`);
