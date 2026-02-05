/**
 * GitHub API module — fetches merged PRs for a user within a date range.
 */

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;

/**
 * Test a PAT by fetching the authenticated user's profile.
 * Returns { valid: true, username, name } on success, or { valid: false, error } on failure.
 */
export async function testPat(token) {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!res.ok) {
      if (res.status === 401) return { valid: false, error: 'Invalid token — authentication failed.' };
      return { valid: false, error: `GitHub API returned ${res.status}.` };
    }

    const user = await res.json();
    return { valid: true, username: user.login, name: user.name || user.login };
  } catch (e) {
    return { valid: false, error: 'Network error — could not reach GitHub.' };
  }
}

/**
 * Fetch merged PRs authored by `username` between `startDate` and `endDate`.
 *
 * @param {string} token - GitHub PAT
 * @param {string} username - GitHub login
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {(progress: {fetched: number, total: number}) => void} onProgress - progress callback
 * @returns {Promise<Array>} array of PR objects
 */
export async function fetchMergedPRs(token, username, startDate, endDate, onProgress) {
  const query = `author:${username} type:pr is:merged merged:${startDate}..${endDate}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
  };

  let page = 1;
  let allItems = [];
  let totalCount = 0;

  while (true) {
    const url = new URL(`${GITHUB_API}/search/issues`);
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', PER_PAGE);
    url.searchParams.set('page', page);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');

    const res = await fetchWithRateLimit(url.toString(), { headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GitHub search failed (${res.status}): ${body}`);
    }

    const data = await res.json();

    if (page === 1) {
      totalCount = data.total_count;
    }

    allItems = allItems.concat(data.items);
    onProgress?.({ fetched: allItems.length, total: totalCount });

    // No more pages
    if (allItems.length >= totalCount || data.items.length < PER_PAGE) {
      break;
    }

    page++;
  }

  // Enrich with PR details (additions/deletions) — batch in parallel, 5 at a time
  const enriched = [];
  const batchSize = 5;

  for (let i = 0; i < allItems.length; i += batchSize) {
    const batch = allItems.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(item => enrichPR(item, headers)),
    );
    enriched.push(...results);
    onProgress?.({ fetched: allItems.length, total: totalCount, enriching: enriched.length });
  }

  return enriched;
}

/**
 * Enrich a search result item with PR-specific data (additions, deletions).
 */
async function enrichPR(item, headers) {
  const pr = {
    title: item.title,
    url: item.html_url,
    repo: extractRepo(item.repository_url),
    mergedAt: item.pull_request?.merged_at || null,
    body: item.body || '',
    additions: 0,
    deletions: 0,
  };

  // Fetch the actual PR endpoint for additions/deletions
  if (item.pull_request?.url) {
    try {
      const res = await fetchWithRateLimit(item.pull_request.url, { headers });
      if (res.ok) {
        const detail = await res.json();
        pr.additions = detail.additions || 0;
        pr.deletions = detail.deletions || 0;
        pr.mergedAt = detail.merged_at || pr.mergedAt;
      }
    } catch {
      // Non-critical — proceed with zeroes
    }
  }

  return pr;
}

function extractRepo(repoApiUrl) {
  // e.g. "https://api.github.com/repos/Shopify/some-repo" → "Shopify/some-repo"
  const match = repoApiUrl?.match(/repos\/(.+)$/);
  return match ? match[1] : 'unknown';
}

/**
 * Fetch with rate-limit awareness. If we hit 403 with rate-limit headers,
 * wait and retry once.
 */
async function fetchWithRateLimit(url, options) {
  const res = await fetch(url, options);

  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const resetAt = res.headers.get('x-ratelimit-reset');

    if (remaining === '0' && resetAt) {
      const waitMs = (parseInt(resetAt, 10) * 1000) - Date.now() + 1000;
      const waitSec = Math.ceil(waitMs / 1000);

      if (waitMs > 0 && waitMs < 120_000) {
        console.warn(`Rate limited. Waiting ${waitSec}s...`);
        await sleep(waitMs);
        return fetch(url, options);
      }

      throw new Error(`Rate limited. Resets in ${waitSec}s — too long to wait.`);
    }
  }

  return res;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
