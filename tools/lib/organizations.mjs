// Memberships of major international organizations. The World Factbook (January 2026)
// and Wikidata give the members. A member in either source counts, unless Wikidata gives
// an end date for its membership. Reviewed corrections are in data/curated/organizations.json.
import { clean } from './factbook.mjs';

// In display order: global, then security, then regional, then cultural and religious.
// "label" is the short name on the card and "name" the full name.
export const organizations = [
  { key: 'UN', label: 'UN', name: 'United Nations', factbook: 'UN', wikidata: 'Q1065' },
  { key: 'UNSC', label: 'UN Security Council (permanent)', name: 'Permanent member of the UN Security Council' },
  { key: 'UN observer', label: 'UN observer state', name: 'Observer state at the United Nations', factbook: 'UN', status: 'observer' },
  { key: 'G7', label: 'G7', name: 'Group of Seven', factbook: 'G-7', wikidata: 'Q1764511' },
  { key: 'G20', label: 'G20', name: 'Group of Twenty', factbook: 'G-20', wikidata: 'Q19771' },
  { key: 'OECD', label: 'OECD', name: 'Organisation for Economic Co-operation and Development', factbook: 'OECD', wikidata: 'Q41550' },
  { key: 'BRICS', label: 'BRICS', name: 'BRICS', factbook: 'BRICS', wikidata: 'Q243630' },
  { key: 'OPEC', label: 'OPEC', name: 'Organization of the Petroleum Exporting Countries', factbook: 'OPEC', wikidata: 'Q7795' },
  { key: 'WTO', label: 'WTO', name: 'World Trade Organization', factbook: 'WTO', wikidata: 'Q7825' },
  { key: 'NATO', label: 'NATO', name: 'North Atlantic Treaty Organization', factbook: 'NATO', wikidata: 'Q7184' },
  { key: 'CSTO', label: 'CSTO', name: 'Collective Security Treaty Organization', factbook: 'CSTO', wikidata: 'Q318693' },
  { key: 'EU', label: 'EU', name: 'European Union', factbook: 'EU', wikidata: 'Q458' },
  { key: 'EFTA', label: 'EFTA', name: 'European Free Trade Association', factbook: 'EFTA', wikidata: 'Q166546' },
  { key: 'CoE', label: 'Council of Europe', name: 'Council of Europe', factbook: 'CE', wikidata: 'Q8908' },
  { key: 'CIS', label: 'CIS', name: 'Commonwealth of Independent States', factbook: 'CIS', wikidata: 'Q7779' },
  { key: 'EAEU', label: 'Eurasian Economic Union', name: 'Eurasian Economic Union', factbook: 'EAEU', wikidata: 'Q4173083' },
  { key: 'SCO', label: 'SCO', name: 'Shanghai Cooperation Organisation', factbook: 'SCO', wikidata: 'Q485207' },
  { key: 'AU', label: 'African Union', name: 'African Union', factbook: 'AU', wikidata: 'Q7159' },
  { key: 'LAS', label: 'Arab League', name: 'League of Arab States', factbook: 'LAS', wikidata: 'Q7172' },
  { key: 'GCC', label: 'Gulf Cooperation Council', name: 'Gulf Cooperation Council', factbook: 'GCC', wikidata: 'Q217172' },
  { key: 'ECOWAS', label: 'ECOWAS', name: 'Economic Community of West African States', factbook: 'ECOWAS', wikidata: 'Q193272' },
  { key: 'SADC', label: 'SADC', name: 'Southern African Development Community', factbook: 'SADC', wikidata: 'Q816706' },
  { key: 'EAC', label: 'East African Community', name: 'East African Community', factbook: 'EAC', wikidata: 'Q337456' },
  { key: 'ASEAN', label: 'ASEAN', name: 'Association of Southeast Asian Nations', factbook: 'ASEAN', wikidata: 'Q7768' },
  { key: 'SAARC', label: 'SAARC', name: 'South Asian Association for Regional Cooperation', factbook: 'SAARC', wikidata: 'Q145700' },
  { key: 'APEC', label: 'APEC', name: 'Asia-Pacific Economic Cooperation', factbook: 'APEC', wikidata: 'Q170481' },
  { key: 'OAS', label: 'OAS', name: 'Organization of American States', factbook: 'OAS', wikidata: 'Q123759' },
  { key: 'Mercosur', label: 'Mercosur', name: 'Southern Common Market', factbook: 'Mercosur', wikidata: 'Q4264' },
  { key: 'CARICOM', label: 'CARICOM', name: 'Caribbean Community', factbook: 'Caricom', wikidata: 'Q205995' },
  { key: 'PIF', label: 'Pacific Islands Forum', name: 'Pacific Islands Forum', factbook: 'PIF', wikidata: 'Q757276' },
  { key: 'Commonwealth', label: 'Commonwealth', name: 'Commonwealth of Nations', factbook: 'C', wikidata: 'Q7785' },
  { key: 'OIC', label: 'OIC', name: 'Organisation of Islamic Cooperation', factbook: 'OIC', wikidata: 'Q47543' },
];

// Statuses that the Factbook writes after a full member. Other statuses, such as
// "observer" or "partner", are not membership.
const memberStatus = /^(|Chinese Taipei|suspended|temporarily suspended)$/;

// The organizations in a Factbook entry, as "ACRONYM" or "ACRONYM status" for a status
// such as "observer". Afghanistan's list starts with a sentence before a colon.
export function factbookMemberships(entry) {
  const text = clean(entry?.Government?.['International organization participation']?.text ?? '')
    .replace(/^.*member of the following organizations[^:]*:\s*/, '');
  const items = [];
  let depth = 0, part = '';
  for (const char of `${text},`) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === ',' && depth === 0) { if (part.trim()) items.push(part.trim()); part = ''; } else part += char;
  }
  return items.map(raw => {
    const [, acronym, status = ''] = raw.match(/^(.*?)\s*(?:\((.*)\))?$/);
    return { acronym: acronym.trim(), status: status.trim() };
  });
}

// The members of each organization, as sets of region IDs.
export function members(regions, factbookEntries, wikidata, fixes) {
  const result = new Map(organizations.map(org => [org.key, new Set()]));
  for (const region of regions) {
    const listed = factbookEntries(region).flatMap(factbookMemberships);
    for (const org of organizations) {
      if (!org.factbook) continue;
      const found = listed.some(({ acronym, status }) => acronym === org.factbook
        && (org.status ? status === org.status : memberStatus.test(status)));
      if (found) result.get(org.key).add(region.id);
    }
  }
  const nonMember = /observer|partner|associate|candidate|guest/i;
  for (const org of organizations) {
    const statements = wikidata[org.key] ?? [];
    const current = new Set(statements.filter(s => !s.end && s.rank !== 'DeprecatedRank' && !nonMember.test(s.role ?? '')).map(s => s.id));
    for (const id of current) result.get(org.key).add(id);
    for (const s of statements) if (s.end && !current.has(s.id)) result.get(org.key).delete(s.id);
    for (const id of Object.keys(fixes.remove?.[org.key] ?? {})) result.get(org.key).delete(id);
    for (const id of Object.keys(fixes.add?.[org.key] ?? {})) result.get(org.key).add(id);
  }
  return result;
}
