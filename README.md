# Gazetteer

A turnable globe of the world’s countries and territories at
[jehlp.net/gazetteer](https://jehlp.net/gazetteer/). Select a country to see its ten most populous
cities and its capital, its government type, independence date and former names, its highest and
lowest points, its largest lake and longest river, its five largest exports, its GDP, its official
languages, its main religion, its deadliest natural disaster and its memberships of major
international organizations. The page uses the shared [jehlp.net site theme](https://jehlp.net/site-theme/).

## Sources

| Data | Source | License |
| --- | --- | --- |
| Boundaries | [Natural Earth](https://www.naturalearthdata.com/) admin-0 countries, 1:50m (Gibraltar 1:10m) | Public domain |
| City candidates and positions | [GeoNames](https://www.geonames.org/) `cities500` | CC BY 4.0 |
| City populations | [Wikidata](https://www.wikidata.org/), matched by GeoNames ID | CC0 |
| Elevation, exports, lakes | [The World Factbook](https://github.com/factbook/factbook.json), final edition (January 2026) | Public domain |
| Lakes and reservoirs | Wikidata | CC0 |
| GDP | [World Bank](https://data.worldbank.org/indicator/NY.GDP.MKTP.CD), [IMF WEO](https://www.imf.org/external/datamapper/NGDPD@WEO), The World Factbook | CC BY 4.0, IMF terms, public domain |
| Official languages | Reviewed list, compared with The World Factbook and Wikidata | — |
| Population | [World Bank](https://data.worldbank.org/indicator/SP.POP.TOTL), The World Factbook | CC BY 4.0, public domain |
| Natural disasters | [EM-DAT](https://www.emdat.be/) through [Our World in Data](https://ourworldindata.org/natural-disasters), named with Wikidata | EM-DAT terms, CC BY 4.0, CC0 |
| Lake outlines | Natural Earth lakes (1:50m and 1:10m) and marine polygons (the Caspian Sea) | Public domain |
| Positions of highest and lowest points | Wikidata | CC0 |
| Capitals | GeoNames feature code PPLC, with reviewed notes | CC BY 4.0 |
| Religion | [Pew Research Center](https://www.pewresearch.org/religion/feature/religious-composition-by-country-2010-2020/) religious composition, 2020; The World Factbook for small territories | Pew terms of use, public domain |
| Rivers and their lengths | Wikidata | CC0 |
| River lines | Natural Earth rivers and lake centerlines, 1:10m, with the Europe and North America supplements | Public domain |
| Disaster names | Wikipedia article titles and [GLIDE](https://glidenumber.net/) records, reviewed by hand | — |
| Government type, independence, former names | The World Factbook, with reviewed changes | Public domain |
| Memberships | The World Factbook and Wikidata, checked against the organizations' member lists | Public domain, CC0 |

The CIA stopped The World Factbook in February 2026. The `factbook.json` mirror keeps its final edition.

## Method

- **Regions.** Each Natural Earth shape is one region, except where the sources describe a larger
  unit. Northern Cyprus joins Cyprus, Somaliland joins Somalia and the Åland Islands join Finland.
  Christmas Island and the Cocos (Keeling) Islands are separate regions. Siachen Glacier has no
  country data. Disputed boundaries are dashed.
- **Cities.** The 60 most populous GeoNames settlements of each country are the candidates. Districts,
  historical places and Israeli settlements are not candidates. Wikidata identifies each candidate
  by its GeoNames ID and gives the most recent dated population. A candidate that Wikidata classes as
  part of a city is removed. A Wikidata figure more than 2.5 times the GeoNames figure counts a wider
  area, so the GeoNames figure is used. `data/curated/cities.json` holds the reviewed exclusions,
  names and cited replacement figures.
- **Lakes.** The largest standing water body by area, from Wikidata and the Factbook. Reservoirs
  and salt lakes count and are labeled. When both sources name the same lake, the Wikidata area is
  used, because it is current. `data/curated/lakes.json` excludes Wikidata items with a wrong area,
  sea lagoons, salt flats and former lakes, and gives a sourced value where Wikidata has no area.
  A shared lake shows its full area.
- **GDP.** The latest World Bank value from 2023 or later. Otherwise the IMF value for 2025 or
  earlier, then an older World Bank value, then the Factbook.
- **Disasters.** The deadliest EM-DAT entry since 1900 by country, year and type, without droughts.
  A Wikidata event of the same country, year and type gives the name. For the successor states of
  the USSR and Yugoslavia, a single-country Wikidata event with a larger toll can replace it.
  EM-DAT gives yearly totals, so a name gives the event that caused most of the deaths.
  `data/curated/disasters.json` holds the reviewed names, from Wikipedia article titles where an
  article exists, and else from the year, place and type in the GLIDE record. It also holds one
  sourced replacement.
- **Capitals.** The GeoNames capital (feature code PPLC) of the region's main country code. A
  capital among the ten cities marks that row. Another capital gets its own position.
  `data/curated/capitals.json` adds notes where the government sits elsewhere or the capital is
  disputed, and removes the capital of Hong Kong, Macao and Western Sahara.
- **Religion.** The largest of Pew's seven groups in 2020, with the next group when it holds 10% or
  more. "No religion" counts as a group. Territories that Pew does not cover use the Factbook shares.
  `data/curated/religion.json` names the religions in Pew's "other religions" group where it is the
  largest.
- **Rivers.** A Natural Earth river line takes the identity of a Wikidata river with the same name in
  a country that the line passes through or runs along. The longest such river of a country is its
  longest river, at its full Wikidata length. A country without a line gets its longest Wikidata
  river, which the globe does not draw. `data/curated/rivers.json` holds reviewed choices.
- **Government and independence.** The Factbook government type, without the names of
  legislatures. The independence field gives the first date, or for a state that never became
  independent from another, its founding. The earliest of the Factbook's "notable earlier dates"
  is a second line. `data/curated/government.json` gives the reviewed choices, such as the
  founding dates of France and the United Kingdom, military governments that the Factbook does
  not show, and Palestine, which has no Factbook entry.
- **Memberships.** The 32 organizations in `tools/lib/organizations.mjs`. A member in the Factbook
  (January 2026) or in Wikidata counts, unless Wikidata gives an end date. Observers, partners and
  associate members do not count. Suspended members still count. `data/curated/organizations.json`
  holds the corrections, each with its reason.
- **Symbols.** A highest or lowest point gets a position when Wikidata states the same point for
  the country, or when a place with its name lies in the country. Lake outlines join Natural Earth
  to the lake by Wikidata ID, then by name near the country. Other lakes get a dot. The capital's
  pin is a star. A capital outside the ten cities is a small star. The longest river is a blue line.

## Development

```sh
npm ci --ignore-scripts
npm run fetch
npm run build
npm test
python3 -m http.server 4319
```

Then open <http://127.0.0.1:4319/>. `python3 tools/make-mark.py` renders `assets/mark.svg` to the
masthead mark and favicon. It needs `rsvg-convert` (librsvg) and Pillow.

The page loads d3-geo, d3-array and topojson-client from `assets/vendor/` (ISC licenses in
`assets/vendor/licenses/`).
