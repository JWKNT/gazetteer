// Minimal Wikidata Query Service client with polite retries.
const endpoint = 'https://query.wikidata.org/sparql';
const userAgent = 'jehlp-gazetteer/1.0 (https://jehlp.net/gazetteer/; build script)';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function sparql(query) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Accept': 'application/sparql-results+json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': userAgent,
        },
        body: new URLSearchParams({ query }),
        // The service stops a query after 60 seconds. A request without an answer
        // after 90 seconds has stalled, so try it again.
        signal: AbortSignal.timeout(90000),
      });
    } catch {
      await pause(attempt * 5000);
      continue;
    }
    if (response.ok) return (await response.json()).results.bindings;
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`Wikidata ${response.status}: ${(await response.text()).slice(0, 400)}`);
    }
    await pause(attempt * 5000);
  }
  throw new Error('Wikidata did not answer after five attempts.');
}

export const qid = uri => uri.slice(uri.lastIndexOf('/') + 1);

// The Wikidata web API. Its search index answers "items with these statements"
// quickly, where an equivalent SPARQL query can time out.
export async function api(params) {
  const url = `https://www.wikidata.org/w/api.php?${new URLSearchParams({ format: 'json', ...params })}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': userAgent }, signal: AbortSignal.timeout(60000) });
      if (response.ok) {
        const data = await response.json();
        if (!data.error) return data;
        throw new Error(`Wikidata API: ${data.error.info}`);
      }
    } catch (error) {
      if (String(error.message).startsWith('Wikidata API')) throw error;
    }
    await pause(attempt * 3000);
  }
  throw new Error('The Wikidata API did not answer after five attempts.');
}

// Areas in square kilometres. Wikidata stores each area with its unit.
const areaUnits = {
  Q712226: 1, Q25343: 1e-6, Q35852: 0.01, Q232291: 2.589988, Q81292: 0.00404686,
};
export function areaKm2(claims = []) {
  const values = [];
  for (const claim of claims) {
    if (claim.rank === 'deprecated') continue;
    const value = claim.mainsnak?.datavalue?.value;
    const factor = areaUnits[value?.unit?.split('/').pop()];
    if (value && factor) values.push(Number(value.amount) * factor);
  }
  return values.length ? Math.max(...values) : null;
}
