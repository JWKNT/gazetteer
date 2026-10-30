# Gazetteer

Read `../site-theme/PHILOSOPHY.md`, `../site-theme/docs/DESIGN-SYSTEM.md` and
`../site-theme/docs/WRITING-STYLE.md` before a change to the page.

## Data and build

- Edit the tools in `tools/` and the reviewed corrections in `data/curated/`. Do not edit `data/world.json`,
  `data/countries.json` or the country options in `index.html` by hand.
- Run `npm run fetch` to download the sources into `.cache/`. Run `npm run build` to write the data and the options.
- Keep a source value unless a review shows that it is wrong. Record each correction in `data/curated/` with its reason.
- Run `npm test`. Review a changed city list, lake or language against its source before you publish it.

## Original technical writing

Use ASD-STE100 Issue 9 for original explanations, instructions, and interface text.
Preserve place names, source names, figures, and license text.
Describe the style as ASD-STE100-guided. Do not claim full compliance without a dictionary and rule review.
