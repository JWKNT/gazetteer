// Copy the three browser libraries and their licenses into assets/vendor/.
// The page loads them from this site, not from a CDN.
import { copyFileSync, mkdirSync } from 'node:fs';
import { root } from './lib/sources.mjs';

const target = `${root}assets/vendor/`;
mkdirSync(`${target}licenses`, { recursive: true });
for (const name of ['d3-array', 'd3-geo', 'topojson-client']) {
  copyFileSync(`${root}node_modules/${name}/dist/${name}.min.js`, `${target}${name}.min.js`);
  copyFileSync(`${root}node_modules/${name}/LICENSE`, `${target}licenses/${name}.txt`);
}
console.log('Copied d3-array, d3-geo and topojson-client to assets/vendor/.');
