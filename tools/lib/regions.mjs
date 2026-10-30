// One record for each selectable region on the globe, with its key in each source.
// Natural Earth gives the outlines. Most keys come from its attributes. The
// exceptions below are listed by Natural Earth's ADM0_A3 code or by region ID.

// Shapes that merge into another region, or that need their own ID.
const idOverrides = {
  KOS: 'XKX', // Kosovo uses the user-assigned code of the World Bank and IMF.
  CYN: 'CYP', // Northern Cyprus: the Factbook, World Bank and GeoNames describe the whole island.
  SOL: 'SOM', // Somaliland: the sources include it in Somalia.
  ALD: 'FIN', // The Åland Islands are an autonomous region of Finland.
  PSX: 'PSE',
  SAH: 'ESH',
  SDS: 'SSD',
  ATC: 'ATC',
  KAS: 'KAS', // Siachen Glacier: a disputed area with no country data.
};

export function regionId(props) {
  if (idOverrides[props.ADM0_A3]) return idOverrides[props.ADM0_A3];
  if (props.ADM0_A3 === 'CXR' || props.ADM0_A3 === 'CCK') return props.ADM0_A3;
  return props.ISO_A3_EH !== '-99' ? props.ISO_A3_EH : props.ADM0_A3;
}

// Pairs of shapes whose shared boundary is disputed. The globe draws these dashed.
export const disputedBoundaries = [
  ['MAR', 'SAH'], ['SRB', 'KOS'], ['SOM', 'SOL'], ['CYP', 'CYN'],
  ['IND', 'KAS'], ['PAK', 'KAS'], ['CHN', 'KAS'], ['ISR', 'PSX'],
];

export const names = {
  ATG: 'Antigua and Barbuda', BHS: 'The Bahamas', BIH: 'Bosnia and Herzegovina',
  IOT: 'British Indian Ocean Territory', VGB: 'British Virgin Islands', CPV: 'Cabo Verde',
  CYM: 'Cayman Islands', CAF: 'Central African Republic', CHN: 'China',
  COD: 'Democratic Republic of the Congo', COG: 'Republic of the Congo', COK: 'Cook Islands',
  CZE: 'Czechia', CIV: 'Côte d’Ivoire', DOM: 'Dominican Republic', GNQ: 'Equatorial Guinea',
  FRO: 'Faroe Islands', FLK: 'Falkland Islands', PYF: 'French Polynesia',
  ATF: 'French Southern and Antarctic Lands', GMB: 'The Gambia',
  HMD: 'Heard Island and McDonald Islands', MAC: 'Macao', MHL: 'Marshall Islands',
  FSM: 'Micronesia', MNP: 'Northern Mariana Islands', PCN: 'Pitcairn Islands',
  STP: 'São Tomé and Príncipe', SLB: 'Solomon Islands', SGS: 'South Georgia and the South Sandwich Islands',
  SSD: 'South Sudan', BLM: 'Saint Barthélemy', KNA: 'Saint Kitts and Nevis', MAF: 'Saint Martin',
  SPM: 'Saint Pierre and Miquelon', VCT: 'Saint Vincent and the Grenadines', TLS: 'Timor-Leste',
  TCA: 'Turks and Caicos Islands', USA: 'United States', VAT: 'Vatican City',
  VIR: 'U.S. Virgin Islands', WLF: 'Wallis and Futuna', ESH: 'Western Sahara', SWZ: 'Eswatini',
  PSE: 'Palestine', XKX: 'Kosovo', ATC: 'Ashmore and Cartier Islands', KAS: 'Siachen Glacier',
  CXR: 'Christmas Island', CCK: 'Cocos (Keeling) Islands', GIB: 'Gibraltar',
  SHN: 'Saint Helena, Ascension and Tristan da Cunha', KOR: 'South Korea', PRK: 'North Korea',
  BRN: 'Brunei', LAO: 'Laos', RUS: 'Russia', TZA: 'Tanzania', SRB: 'Serbia', HKG: 'Hong Kong',
};

// World Factbook codes (GEC). Natural Earth's FIPS_10 attribute gives most of them.
export const factbookOverrides = {
  ISR: ['is'], NOR: ['no'], SSD: ['od'], PSE: ['we', 'gz'], CXR: ['kt'], CCK: ['ck'],
  CUW: ['uc'], SXM: ['nn'], GIB: ['gi'], ATC: ['at'], XKX: ['kv'], KAS: [],
};

// GeoNames country codes. Overseas departments of France are part of France.
export const geonamesOverrides = {
  XKX: ['XK'], PSE: ['PS'], ESH: ['EH'], CXR: ['CX'], CCK: ['CC'], ATC: [], KAS: [],
  FIN: ['FI', 'AX'], FRA: ['FR', 'GP', 'MQ', 'GF', 'RE', 'YT'], NOR: ['NO', 'SJ'], NLD: ['NL', 'BQ'],
  GIB: ['GI'], ATA: [], ATF: [], HMD: [], SGS: [], IOT: [],
};

// IMF World Economic Outlook codes that differ from ISO 3166.
export const imfOverrides = { XKX: 'UVK', PSE: 'WBG' };

export function sortKey(name) {
  return name.replace(/^The /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Shapes that join a larger region. They do not set the region's source keys.
const mergedShapes = new Set(['CYN', 'SOL', 'ALD']);
const wikidataOverrides = { CXR: 'Q31063', CCK: 'Q36004' };

// Build the region list from the Natural Earth features (after the IOA split).
export function regions(features) {
  const byId = new Map();
  for (const feature of features) {
    const p = feature.properties;
    const id = regionId(p);
    if (mergedShapes.has(p.ADM0_A3)) continue;
    const iso2 = p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : null;
    byId.set(id, {
      id,
      name: names[id] ?? p.NAME_EN ?? p.NAME,
      wikidata: wikidataOverrides[id] ?? p.WIKIDATAID,
      factbook: factbookOverrides[id] ?? (p.FIPS_10 !== '-99' ? [p.FIPS_10.toLowerCase()] : []),
      geonames: geonamesOverrides[id] ?? (iso2 ? [iso2] : []),
      worldBank: id,
      imf: imfOverrides[id] ?? id,
    });
  }
  return [...byId.values()].sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
}
