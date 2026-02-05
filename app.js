import { createWizard, hasCompletedWizard, showDashboard } from './wizard.js';
import { encryptToken, decryptToken } from './crypto.js';
import { fetchMergedPRs } from './github.js';

/**
 * Map a Shopify job title to an engineering level (C-level).
 */
function mapTitleToLevel(title) {
  if (!title) return null;
  const t = title.toLowerCase();

  const mappings = [
    { pattern: /\bprincipal\b/, level: 'C8' },
    { pattern: /\bstaff\b/, level: 'C7' },
    { pattern: /\b(?:senior|sr\.?)\b/, level: 'C6' },
    { pattern: /\b(?:intermediate|mid)\b/, level: 'C5' },
    { pattern: /\bjunior\b/, level: 'C4' },
    { pattern: /\b(?:developer|engineer|dev)\b/, level: 'C5' },
  ];

  for (const { pattern, level } of mappings) {
    if (pattern.test(t)) return level;
  }

  return null;
}

const LEVELS = [
  { value: 'C4', label: 'C4 — Junior' },
  { value: 'C5', label: 'C5 — Developer / Intermediate' },
  { value: 'C6', label: 'C6 — Senior' },
  { value: 'C7', label: 'C7 — Staff' },
  { value: 'C8', label: 'C8 — Principal' },
];

let _currentUser = null;

function renderUserInfo(user, level) {
  const container = document.getElementById('user-info');
  container.textContent = '';

  const display = document.createElement('div');
  display.className = 'user-info-display';

  if (user.slackImageUrl) {
    const img = document.createElement('img');
    img.className = 'user-avatar';
    img.src = user.slackImageUrl;
    img.alt = '';
    display.appendChild(img);
  }

  const textDiv = document.createElement('div');
  const nameDiv = document.createElement('div');
  nameDiv.className = 'user-name';
  nameDiv.textContent = user.fullName || user.email;
  const titleDiv = document.createElement('div');
  titleDiv.className = 'user-title';
  titleDiv.textContent = user.title || 'Unknown title';
  textDiv.append(nameDiv, titleDiv);
  display.appendChild(textDiv);

  if (level) {
    const badge = document.createElement('span');
    badge.className = 'user-level-badge';
    badge.textContent = level;
    display.appendChild(badge);
  }

  container.appendChild(display);
}

async function init() {
  const loadingScreen = document.getElementById('loading-screen');

  try {
    const user = await quick.id.waitForUser();
    _currentUser = user;
    const detectedLevel = mapTitleToLevel(user.title);

    renderUserInfo(user, detectedLevel);

    // Check if user has completed the wizard before
    const completed = await hasCompletedWizard(user.email);

    if (completed) {
      // Returning user — check for cached PR data
      await handleReturningUser(user, completed);
    } else {
      createWizard(user, detectedLevel, LEVELS);
    }
  } catch (error) {
    console.error('Failed to initialize:', error);
    loadingScreen.textContent = 'Failed to load user identity. Make sure you\'re running this on Quick.';
    loadingScreen.style.color = 'var(--color-error)';
  }
}

// ── Wizard completion handler ──────────────────
async function onWizardComplete(user, state) {
  // Encrypt PAT before storing
  const encryptedPAT = await encryptToken(state.githubPat, user.email);

  // Save user profile to Quick DB
  const users = quick.db.collection('users');
  const existing = await users.where({ email: user.email }).find();

  const data = {
    email: user.email,
    fullName: user.fullName,
    title: user.title,
    level: state.level,
    githubToken: encryptedPAT,
    githubUsername: state.githubUsername,
    lastReviewFeedback: state.lastReviewFeedback,
    lastReviewDate: state.lastReviewDate,
    periodStart: state.periodStart,
    periodEnd: state.periodEnd,
    wizardCompleted: true,
  };

  if (existing && existing.length > 0) {
    await users.update(existing[0].id, data);
  } else {
    await users.create(data);
  }

  // Transition to PR fetch
  showFetchView();
  await fetchAndStorePRs(state.githubPat, state.githubUsername, state.periodStart, state.periodEnd, user.email);
}

// ── Returning user ─────────────────────────────
async function handleReturningUser(user, profile) {
  const prCollection = quick.db.collection('pr_data');
  const existing = await prCollection.where({ userEmail: user.email }).find();

  if (existing.length > 0) {
    const prData = existing[0];
    const fetchedAt = new Date(prData.fetchedAt);
    const hoursOld = (Date.now() - fetchedAt.getTime()) / (1000 * 60 * 60);

    if (hoursOld > 24 && profile.githubToken) {
      // Data is stale — re-fetch
      try {
        const token = await decryptToken(profile.githubToken, user.email);
        showFetchView();
        await fetchAndStorePRs(token, profile.githubUsername, prData.dateRange.start, prData.dateRange.end, user.email);
      } catch {
        showFetchComplete(prData.prs.length, user, profile);
      }
    } else {
      showFetchComplete(prData.prs.length, user, profile);
    }
  } else if (profile.githubToken) {
    // No PR data but profile exists — fetch
    try {
      const token = await decryptToken(profile.githubToken, user.email);
      showFetchView();
      await fetchAndStorePRs(token, profile.githubUsername, profile.periodStart, profile.periodEnd, user.email);
    } catch {
      showDashboard(user, profile);
    }
  } else {
    showDashboard(user, profile);
  }
}

// ── Fetch UI ───────────────────────────────────
function showFetchView() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="fetch-view" id="fetch-view">
      <div class="fetch-spinner"></div>
      <h2>Fetching your PRs...</h2>
      <p class="fetch-detail">This may take a moment for large histories.</p>
      <div class="fetch-progress-bar">
        <div class="fetch-progress-fill" id="fetch-progress-fill"></div>
      </div>
      <p class="fetch-progress-text" id="fetch-progress-text">Starting...</p>
    </div>
  `;
}

async function fetchAndStorePRs(token, username, startDate, endDate, email) {
  const progressFill = document.getElementById('fetch-progress-fill');
  const progressText = document.getElementById('fetch-progress-text');

  let retryCount = 0;
  const maxRetries = 1;

  const attemptFetch = async () => {
    try {
      const prs = await fetchMergedPRs(token, username, startDate, endDate, (fetched, total) => {
        const pct = total > 0 ? Math.round((fetched / total) * 100) : 0;
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (progressText) progressText.textContent = `Fetched ${fetched} of ${total} PRs...`;
      });

      // Store in Quick DB
      const prCollection = quick.db.collection('pr_data');
      const existingData = await prCollection.where({ userEmail: email }).find();
      const prRecord = {
        userEmail: email,
        prs,
        fetchedAt: new Date().toISOString(),
        dateRange: { start: startDate, end: endDate },
      };

      if (existingData.length > 0) {
        await prCollection.update(existingData[0].id, prRecord);
      } else {
        await prCollection.create(prRecord);
      }

      const profile = await hasCompletedWizard(email);
      showFetchComplete(prs.length, _currentUser, profile);
    } catch (err) {
      console.error('Fetch failed:', err);

      if (retryCount < maxRetries) {
        retryCount++;
        if (progressText) progressText.textContent = `Fetch failed. Retrying (${retryCount}/${maxRetries})...`;
        await new Promise(r => setTimeout(r, 2000));
        return attemptFetch();
      }

      showFetchError(err, token, username, startDate, endDate, email);
    }
  };

  await attemptFetch();
}

function showFetchComplete(count, user, profile) {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="fetch-result-view">
      <div class="fetch-result-count">${count}</div>
      <div class="fetch-result-label">${count === 1 ? 'merged PR found' : 'merged PRs found'}</div>
      <button class="btn btn-primary" id="proceed-btn" style="margin-top: var(--spacing-lg)">Continue to Assessment</button>
    </div>
  `;

  document.getElementById('proceed-btn').addEventListener('click', () => {
    showDashboard(user, profile);
  });
}

function showFetchError(err, token, username, startDate, endDate, email) {
  const main = document.getElementById('main-content');
  main.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'fetch-result-view';

  const h2 = document.createElement('h2');
  h2.textContent = 'Fetch Failed';

  const p = document.createElement('p');
  p.style.cssText = 'color:var(--color-text-secondary);margin-bottom:var(--spacing-lg)';
  p.textContent = err.message;

  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:var(--spacing-md);justify-content:center';

  const retryBtn = document.createElement('button');
  retryBtn.className = 'btn btn-primary';
  retryBtn.textContent = 'Retry';

  const manualBtn = document.createElement('button');
  manualBtn.className = 'btn btn-secondary';
  manualBtn.textContent = 'Enter PRs Manually';

  btnRow.append(retryBtn, manualBtn);
  wrapper.append(h2, p, btnRow);
  main.appendChild(wrapper);

  retryBtn.addEventListener('click', () => {
    showFetchView();
    fetchAndStorePRs(token, username, startDate, endDate, email);
  });

  manualBtn.addEventListener('click', () => {
    showManualEntry(email);
  });
}

// ── Manual Entry ───────────────────────────────
function showManualEntry(email) {
  const main = document.getElementById('main-content');
  const manualPRs = [];

  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body">
        <h2>Add PRs Manually</h2>
        <p class="step-description">Paste GitHub PR URLs one at a time.</p>
        <ul class="manual-pr-list" id="manual-pr-list"></ul>
        <div class="manual-pr-input-row">
          <input type="text" id="manual-pr-input" placeholder="https://github.com/org/repo/pull/123" />
          <button class="btn btn-secondary" id="manual-pr-add">Add</button>
        </div>
        <div id="manual-pr-error" class="form-error">Enter a valid GitHub PR URL (e.g. https://github.com/org/repo/pull/123)</div>
        <div style="margin-top:var(--spacing-lg)">
          <button class="btn btn-primary" id="manual-pr-done" disabled>Done — Continue</button>
        </div>
      </div>
    </div>
  `;

  const listEl = document.getElementById('manual-pr-list');
  const inputEl = document.getElementById('manual-pr-input');
  const addBtn = document.getElementById('manual-pr-add');
  const doneBtn = document.getElementById('manual-pr-done');
  const errorEl = document.getElementById('manual-pr-error');

  function renderList() {
    listEl.textContent = '';
    manualPRs.forEach((url, i) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.className = 'manual-pr-url';
      span.textContent = url;
      const btn = document.createElement('button');
      btn.textContent = '\u00d7';
      btn.title = 'Remove';
      btn.className = 'manual-pr-remove';
      btn.addEventListener('click', () => {
        manualPRs.splice(i, 1);
        renderList();
        doneBtn.disabled = manualPRs.length === 0;
      });
      li.append(span, btn);
      listEl.appendChild(li);
    });
  }

  addBtn.addEventListener('click', () => {
    const url = inputEl.value.trim();
    if (!url) return;

    if (!/github\.com\/.+\/.+\/pull\/\d+/.test(url)) {
      errorEl.classList.add('visible');
      return;
    }

    errorEl.classList.remove('visible');
    manualPRs.push(url);
    inputEl.value = '';
    renderList();
    doneBtn.disabled = false;
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addBtn.click();
  });

  inputEl.addEventListener('input', () => {
    errorEl.classList.remove('visible');
  });

  doneBtn.addEventListener('click', async () => {
    if (manualPRs.length === 0) return;
    doneBtn.disabled = true;
    doneBtn.textContent = 'Saving...';

    const prs = manualPRs.map(url => {
      const parts = url.split('/');
      return {
        title: `PR #${parts[parts.length - 1]}`,
        url,
        repo: `${parts[3]}/${parts[4]}`,
        mergedAt: new Date().toISOString(),
        body: '',
        number: parseInt(parts[parts.length - 1]),
        labels: [],
      };
    });

    const prCollection = quick.db.collection('pr_data');
    const existing = await prCollection.where({ userEmail: email }).find();
    const record = {
      userEmail: email,
      prs,
      fetchedAt: new Date().toISOString(),
      dateRange: { start: '', end: '' },
      manual: true,
    };

    if (existing.length > 0) {
      await prCollection.update(existing[0].id, record);
    } else {
      await prCollection.create(record);
    }

    const profile = await hasCompletedWizard(email);
    showFetchComplete(prs.length, _currentUser, profile);
  });
}

// Export for use by wizard.js and other modules
export { mapTitleToLevel, LEVELS, onWizardComplete };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
