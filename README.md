# Gazetteer

A turnable globe of the world’s countries and territories at
[jehlp.net/gazetteer](https://jehlp.net/gazetteer/). Select a country to see its ten most populous
cities, its highest and lowest points, its largest lake, its five largest exports, its GDP and its
official languages. The page uses the shared [jehlp.net site theme](https://jehlp.net/site-theme/).

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
  `data/curated/disasters.json` holds reviewed names and one sourced replacement.
- **Symbols.** A highest or lowest point gets a position when Wikidata states the same point for
  the country, or when a place with its name lies in the country. Lake outlines join Natural Earth
  to the lake by Wikidata ID, then by name near the country. Other lakes get a dot.

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
