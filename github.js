// github.js — GitHub API integration for fetching merged PRs

const GITHUB_API = 'https://api.github.com';
const PER_PAGE = 100;

/**
 * Validate PAT format: classic tokens start with ghp_,
 * fine-grained tokens start with github_pat_
 */
export function isValidPATFormat(token) {
  if (!token) return false;
  return (token.startsWith('ghp_') || token.startsWith('github_pat_')) && token.length >= 30;
}

/**
 * Test a PAT by fetching the authenticated user's info.
 * Returns user object on success, throws on failure.
 */
export async function testPAT(token) {
  const res = await fetch(`${GITHUB_API}/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid token — check that it has not expired.');
    throw new Error(`GitHub API error: ${res.status}`);
  }

  return res.json();
}

/**
 * Fetch merged PRs for a user within a date range.
 *
 * @param {string} token - GitHub PAT
 * @param {string} username - GitHub username
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 * @param {function} onProgress - callback(fetched, total)
 * @returns {Promise<Array>} array of PR objects
 */
export async function fetchMergedPRs(token, username, startDate, endDate, onProgress) {
  const query = `author:${username} type:pr is:merged merged:${startDate}..${endDate}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
  };

  let page = 1;
  let allItems = [];
  let totalCount = null;

  while (true) {
    const url = new URL(`${GITHUB_API}/search/issues`);
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', PER_PAGE);
    url.searchParams.set('page', page);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');

    const res = await fetchWithRetry(url.toString(), { headers });

    if (!res.ok) {
      if (res.status === 403) {
        const rateLimitReset = res.headers.get('X-RateLimit-Reset');
        if (rateLimitReset) {
          const waitSec = Math.max(0, Number(rateLimitReset) - Math.floor(Date.now() / 1000));
          throw new RateLimitError(`Rate limited. Resets in ${waitSec}s.`, waitSec);
        }
      }
      throw new Error(`GitHub search failed: ${res.status}`);
    }

    const data = await res.json();
    if (totalCount === null) totalCount = data.total_count;

    allItems = allItems.concat(data.items);
    if (onProgress) onProgress(allItems.length, totalCount);

    if (allItems.length >= totalCount || data.items.length < PER_PAGE) break;
    page++;

    // Small delay between pages to be nice to the API
    await sleep(200);
  }

  return allItems.map(normalizePR);
}

/**
 * Fetch with automatic retry on rate limit (HTTP 403).
 * Retries up to 2 times.
 */
async function fetchWithRetry(url, options, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);

    if (res.status === 403 && attempt < retries) {
      const retryAfter = res.headers.get('Retry-After');
      const rateLimitReset = res.headers.get('X-RateLimit-Reset');

      let waitMs = 60_000;
      if (retryAfter) {
        waitMs = Number(retryAfter) * 1000;
      } else if (rateLimitReset) {
        waitMs = Math.max(0, (Number(rateLimitReset) - Math.floor(Date.now() / 1000))) * 1000;
      }

      // Cap wait at 2 minutes
      waitMs = Math.min(waitMs, 120_000);
      await sleep(waitMs);
      continue;
    }

    return res;
  }
}

function normalizePR(item) {
  const urlParts = item.html_url.split('/');
  const repo = `${urlParts[3]}/${urlParts[4]}`;

  return {
    title: item.title,
    url: item.html_url,
    repo,
    mergedAt: item.pull_request?.merged_at || item.closed_at,
    body: item.body || '',
    number: item.number,
    labels: (item.labels || []).map(l => l.name),
  };
}

export class RateLimitError extends Error {
  constructor(message, waitSeconds) {
    super(message);
    this.name = 'RateLimitError';
    this.waitSeconds = waitSeconds;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
