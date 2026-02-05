import { encryptToken, decryptToken } from './crypto.js';
import { testPat, fetchMergedPRs } from './github.js';

const TOTAL_STEPS = 4;
const STALE_HOURS = 24;

/**
 * Check if a user has already completed the setup wizard.
 * Returns the saved profile document, or null.
 */
export async function hasCompletedWizard(email) {
  try {
    const users = quick.db.collection('users');
    const results = await users.where({ email }).find();
    if (results && results.length > 0 && results[0].wizardCompleted) {
      return results[0];
    }
  } catch (e) {
    console.error('Error checking wizard completion:', e);
  }
  return null;
}

/**
 * Show a simple dashboard after wizard is complete.
 * If PRs haven't been fetched yet, kicks off the fetch flow.
 */
export function showDashboard(user, profile) {
  const main = document.getElementById('main-content');

  // Check if we should fetch PRs
  if (profile.githubPat && profile.periodStart && profile.periodEnd) {
    const prData = getCachedPRData(user.email, profile.periodStart, profile.periodEnd);
    if (!prData) {
      showFetchScreen(user, profile);
      return;
    }
  }

  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body">
        <h2>Welcome back, ${user.fullName || user.email}</h2>
        <p class="step-description">Your setup is complete. Reflection questions will appear in the sidebar.</p>
        <div class="confirmation-card" style="margin-top: var(--spacing-lg);">
          <div class="confirmation-row">
            <span class="confirmation-label">Level</span>
            <span class="confirmation-value">${profile.level}</span>
          </div>
          <div class="confirmation-row">
            <span class="confirmation-label">Review Period</span>
            <span class="confirmation-value">${profile.periodStart} — ${profile.periodEnd}</span>
          </div>
          <div class="confirmation-row">
            <span class="confirmation-label">GitHub PAT</span>
            <span class="confirmation-value">${profile.githubPat ? '●●●●●●●●' : 'Not set'}</span>
          </div>
          ${renderPRSummaryRow(user.email)}
        </div>
        <div style="margin-top: var(--spacing-lg); display: flex; gap: var(--spacing-sm);">
          <button class="btn btn-secondary" id="restart-wizard-btn">Redo Setup</button>
          ${profile.githubPat ? '<button class="btn btn-secondary" id="refetch-prs-btn">Re-fetch PRs</button>' : ''}
        </div>
      </div>
    </div>
  `;

  document.getElementById('restart-wizard-btn').addEventListener('click', () => {
    import('./app.js').then(({ LEVELS, mapTitleToLevel }) => {
      const detectedLevel = mapTitleToLevel(user.title);
      createWizard(user, detectedLevel, LEVELS);
    });
  });

  const refetchBtn = document.getElementById('refetch-prs-btn');
  if (refetchBtn) {
    refetchBtn.addEventListener('click', () => {
      showFetchScreen(user, profile, true);
    });
  }
}

function renderPRSummaryRow(email) {
  try {
    const raw = localStorage.getItem(`pr_data_${email}`);
    if (raw) {
      const data = JSON.parse(raw);
      return `
        <div class="confirmation-row">
          <span class="confirmation-label">PRs Fetched</span>
          <span class="confirmation-value">${data.prs.length} PRs (fetched ${new Date(data.fetchedAt).toLocaleDateString()})</span>
        </div>
      `;
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * Check localStorage for cached PR data. Returns the data if fresh
 * and matching the date range, otherwise null.
 */
function getCachedPRData(email, periodStart, periodEnd) {
  try {
    const raw = localStorage.getItem(`pr_data_${email}`);
    if (!raw) return null;

    const data = JSON.parse(raw);
    const ageHours = (Date.now() - data.fetchedAt) / (1000 * 60 * 60);

    if (ageHours > STALE_HOURS) return null;
    if (data.dateRange.start !== periodStart || data.dateRange.end !== periodEnd) return null;

    return data;
  } catch {
    return null;
  }
}

function storePRData(email, prs, periodStart, periodEnd) {
  const data = {
    prs,
    fetchedAt: Date.now(),
    dateRange: { start: periodStart, end: periodEnd },
  };

  localStorage.setItem(`pr_data_${email}`, JSON.stringify(data));

  // Also store in Quick DB for persistence across devices
  try {
    const collection = quick.db.collection('pr_data');
    collection.where({ userEmail: email }).find().then(existing => {
      const doc = { userEmail: email, ...data };
      if (existing && existing.length > 0) {
        collection.update(existing[0].id, doc);
      } else {
        collection.create(doc);
      }
    });
  } catch (e) {
    console.error('Failed to persist PR data to Quick DB:', e);
  }
}

// ── Fetch Screen ──

async function showFetchScreen(user, profile, forceFetch = false) {
  const main = document.getElementById('main-content');

  // If not forcing, check cache first
  if (!forceFetch) {
    const cached = getCachedPRData(user.email, profile.periodStart, profile.periodEnd);
    if (cached) {
      showDashboard(user, profile);
      return;
    }
  }

  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body fetch-screen">
        <h2>Fetching Your Pull Requests</h2>
        <p class="step-description">Searching GitHub for merged PRs in your review period...</p>
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" id="fetch-progress-fill" style="width: 0%"></div>
          </div>
          <div class="progress-text" id="fetch-progress-text">Connecting to GitHub...</div>
        </div>
      </div>
    </div>
  `;

  try {
    const token = await decryptToken(profile.githubPat, user.email);
    const { valid, username, error } = await testPat(token);

    if (!valid) {
      showFetchError(main, user, profile, `PAT validation failed: ${error}`);
      return;
    }

    const progressFill = document.getElementById('fetch-progress-fill');
    const progressText = document.getElementById('fetch-progress-text');

    const prs = await fetchMergedPRs(
      token,
      username,
      profile.periodStart,
      profile.periodEnd,
      ({ fetched, total, enriching }) => {
        if (enriching !== undefined) {
          const pct = total > 0 ? Math.round((enriching / total) * 100) : 0;
          progressFill.style.width = `${pct}%`;
          progressText.textContent = `Enriching PR details... ${enriching}/${total}`;
        } else {
          const pct = total > 0 ? Math.round((fetched / total) * 50) : 0;
          progressFill.style.width = `${pct}%`;
          progressText.textContent = `Found ${fetched} of ${total} PRs...`;
        }
      },
    );

    // Done — store and show result
    storePRData(user.email, prs, profile.periodStart, profile.periodEnd);
    showFetchSuccess(main, user, profile, prs);
  } catch (e) {
    console.error('PR fetch failed:', e);
    showFetchError(main, user, profile, e.message);
  }
}

function showFetchSuccess(main, user, profile, prs) {
  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body fetch-screen">
        <div class="fetch-success-icon">&#10003;</div>
        <h2>${prs.length} Pull Request${prs.length !== 1 ? 's' : ''} Found</h2>
        <p class="step-description">
          PRs from ${profile.periodStart} to ${profile.periodEnd} have been loaded.
        </p>
        <div class="pr-summary-stats">
          <div class="stat-card">
            <div class="stat-value">${prs.length}</div>
            <div class="stat-label">PRs Merged</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${countUniqueRepos(prs)}</div>
            <div class="stat-label">Repositories</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">+${formatNumber(sumField(prs, 'additions'))}</div>
            <div class="stat-label">Additions</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">-${formatNumber(sumField(prs, 'deletions'))}</div>
            <div class="stat-label">Deletions</div>
          </div>
        </div>
        <div style="margin-top: var(--spacing-lg);">
          <button class="btn btn-primary" id="continue-to-dashboard">Continue</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('continue-to-dashboard').addEventListener('click', () => {
    showDashboard(user, profile);
  });
}

function showFetchError(main, user, profile, errorMessage) {
  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body fetch-screen">
        <div class="fetch-error-icon">!</div>
        <h2>Failed to Fetch PRs</h2>
        <p class="step-description">${escapeHtml(errorMessage)}</p>
        <div style="margin-top: var(--spacing-lg); display: flex; gap: var(--spacing-sm); flex-wrap: wrap;">
          <button class="btn btn-primary" id="retry-fetch-btn">Retry</button>
          <button class="btn btn-secondary" id="manual-entry-btn">Enter PRs Manually</button>
          <button class="btn btn-secondary" id="skip-prs-btn">Skip for Now</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('retry-fetch-btn').addEventListener('click', () => {
    showFetchScreen(user, profile, true);
  });

  document.getElementById('manual-entry-btn').addEventListener('click', () => {
    showManualEntry(main, user, profile);
  });

  document.getElementById('skip-prs-btn').addEventListener('click', () => {
    storePRData(user.email, [], profile.periodStart, profile.periodEnd);
    showDashboard(user, profile);
  });
}

function showManualEntry(main, user, profile) {
  main.innerHTML = `
    <div class="wizard">
      <div class="wizard-body">
        <h2>Add PRs Manually</h2>
        <p class="step-description">
          Paste GitHub PR URLs, one per line. We'll use these instead of auto-fetching.
        </p>
        <div class="form-group">
          <label for="manual-pr-urls">PR URLs</label>
          <p class="form-hint">
            e.g. https://github.com/Shopify/repo/pull/123
          </p>
          <textarea
            id="manual-pr-urls"
            rows="8"
            placeholder="https://github.com/org/repo/pull/123&#10;https://github.com/org/repo/pull/456"
          ></textarea>
        </div>
        <div style="display: flex; gap: var(--spacing-sm);">
          <button class="btn btn-primary" id="save-manual-prs">Save PRs</button>
          <button class="btn btn-secondary" id="back-to-error">Back</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('save-manual-prs').addEventListener('click', () => {
    const textarea = document.getElementById('manual-pr-urls');
    const urls = textarea.value.trim().split('\n').filter(u => u.trim());

    const prs = urls.map(url => {
      const trimmed = url.trim();
      const parts = trimmed.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
      return {
        title: parts ? `PR #${parts[2]}` : trimmed,
        url: trimmed,
        repo: parts ? parts[1] : 'unknown',
        mergedAt: null,
        additions: 0,
        deletions: 0,
        body: '',
        manualEntry: true,
      };
    });

    storePRData(user.email, prs, profile.periodStart, profile.periodEnd);
    showFetchSuccess(main, user, profile, prs);
  });

  document.getElementById('back-to-error').addEventListener('click', () => {
    showFetchError(main, user, profile, 'Fetch failed — you can retry or add PRs manually.');
  });
}

// ── Helpers ──

function countUniqueRepos(prs) {
  return new Set(prs.map(p => p.repo)).size;
}

function sumField(prs, field) {
  return prs.reduce((sum, p) => sum + (p[field] || 0), 0);
}

function formatNumber(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── Wizard ──

/**
 * Create and render the 4-step setup wizard.
 */
export function createWizard(user, detectedLevel, levels) {
  const main = document.getElementById('main-content');

  const state = {
    currentStep: 0,
    githubPat: '',
    githubUsername: '',
    patVerified: false,
    lastReviewFeedback: '',
    lastReviewDate: '2025-10-31',
    periodStart: '',
    periodEnd: '',
    level: detectedLevel || 'C5',
  };

  // Auto-calculate dates from the default lastReviewDate
  computeDatesFromLastReview(state);

  function render() {
    main.innerHTML = `
      <div class="wizard">
        ${renderProgress(state.currentStep)}
        <div class="wizard-body">
          ${renderStep(state, levels)}
        </div>
        <div class="wizard-footer">
          ${state.currentStep > 0
            ? `<button class="btn btn-secondary" id="wizard-back">Back</button>`
            : `<div></div>`
          }
          ${state.currentStep < TOTAL_STEPS - 1
            ? `<button class="btn btn-primary" id="wizard-next"${state.currentStep === 0 && !state.patVerified && state.githubPat ? ' disabled' : ''}>Next</button>`
            : `<button class="btn btn-primary" id="wizard-finish">Complete Setup</button>`
          }
        </div>
      </div>
    `;

    bindEvents(state, user, levels);
  }

  render();
  state._render = render;
}

function computeDatesFromLastReview(state) {
  if (state.lastReviewDate) {
    const lastReview = new Date(state.lastReviewDate);
    const start = new Date(lastReview);
    start.setMonth(start.getMonth() - 2);
    state.periodStart = start.toISOString().slice(0, 10);
  }

  const today = new Date();
  state.periodEnd = today.toISOString().slice(0, 10);
}

function renderProgress(currentStep) {
  const stepLabels = ['GitHub Token', 'Review Feedback', 'Dates', 'Confirm'];

  return `
    <div class="wizard-progress">
      ${stepLabels.map((label, i) => {
        let cls = '';
        if (i < currentStep) cls = 'completed';
        else if (i === currentStep) cls = 'active';

        return `
          <div class="wizard-progress-step ${cls}">
            <span class="step-number">${i < currentStep ? '✓' : i + 1}</span>
            <span class="step-label">${label}</span>
          </div>
          ${i < stepLabels.length - 1 ? '<span class="step-connector"></span>' : ''}
        `;
      }).join('')}
    </div>
  `;
}

function renderStep(state, levels) {
  switch (state.currentStep) {
    case 0: return renderGithubTokenStep(state);
    case 1: return renderFeedbackStep(state);
    case 2: return renderDatesStep(state);
    case 3: return renderConfirmStep(state, levels);
    default: return '';
  }
}

function renderGithubTokenStep(state) {
  let statusHtml = '';
  if (state.patVerified) {
    statusHtml = `<div class="token-status valid">Verified — logged in as <strong>${escapeHtml(state.githubUsername)}</strong></div>`;
  }

  return `
    <div class="wizard-step active">
      <h2>GitHub Personal Access Token</h2>
      <p class="step-description">
        We need a GitHub PAT to fetch your pull requests, code reviews, and contributions
        during the review period.
      </p>
      <div class="form-group">
        <label for="github-pat">Personal Access Token</label>
        <p class="form-hint">
          Create a token at GitHub &rarr; Settings &rarr; Developer Settings &rarr; Personal Access Tokens.
          It needs <code>repo</code> and <code>read:org</code> scopes.
        </p>
        <div class="token-input-wrapper">
          <input
            type="password"
            id="github-pat"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value="${state.githubPat}"
            autocomplete="off"
          >
          <button class="btn btn-secondary btn-sm" id="verify-pat-btn" style="margin-top: var(--spacing-sm);">
            Verify Token
          </button>
        </div>
        <div id="pat-status" class="token-status">${statusHtml}</div>
        <div id="pat-error" class="form-error">Token must start with "ghp_" or "github_pat_" and be at least 30 characters.</div>
      </div>
    </div>
  `;
}

function renderFeedbackStep(state) {
  return `
    <div class="wizard-step active">
      <h2>Last Review Feedback</h2>
      <p class="step-description">
        Paste your most recent performance review feedback. This helps calibrate
        the reflection questions to areas you're actively developing.
      </p>
      <div class="form-group">
        <label for="review-feedback">Review Feedback</label>
        <p class="form-hint">This is optional but improves the quality of reflection prompts.</p>
        <textarea
          id="review-feedback"
          placeholder="Paste your last review feedback here..."
          rows="8"
        >${state.lastReviewFeedback}</textarea>
      </div>
    </div>
  `;
}

function renderDatesStep(state) {
  return `
    <div class="wizard-step active">
      <h2>Review Period</h2>
      <p class="step-description">
        Specify the dates for your upcoming review. We'll focus on contributions
        within this time window.
      </p>
      <div class="form-group">
        <label for="last-review-date">Last Review Date</label>
        <p class="form-hint">When was your most recent completed review? Defaults to end of October 2025.</p>
        <input type="date" id="last-review-date" value="${state.lastReviewDate}">
      </div>
      <div class="form-group">
        <label for="period-start">Review Period Start</label>
        <p class="form-hint">Auto-calculated as 2 months before your last review date.</p>
        <input type="date" id="period-start" value="${state.periodStart}">
      </div>
      <div class="form-group">
        <label for="period-end">Review Period End</label>
        <p class="form-hint">Defaults to today.</p>
        <input type="date" id="period-end" value="${state.periodEnd}">
      </div>
    </div>
  `;
}

function renderConfirmStep(state, levels) {
  return `
    <div class="wizard-step active">
      <h2>Confirm Your Setup</h2>
      <p class="step-description">Review your information before completing setup.</p>

      <div class="form-group">
        <label for="level-override">Your Level</label>
        <p class="form-hint">Auto-detected from your title. Change if incorrect.</p>
        <select id="level-override">
          ${levels.map(l =>
            `<option value="${l.value}" ${l.value === state.level ? 'selected' : ''}>${l.label}</option>`
          ).join('')}
        </select>
      </div>

      <div class="confirmation-card">
        <div class="confirmation-row">
          <span class="confirmation-label">GitHub PAT</span>
          <span class="confirmation-value">${state.patVerified ? `Verified (${escapeHtml(state.githubUsername)})` : state.githubPat ? '●●●●●●●●' : 'Not set'}</span>
        </div>
        <div class="confirmation-row">
          <span class="confirmation-label">Review Feedback</span>
          <span class="confirmation-value">${state.lastReviewFeedback ? 'Provided' : 'Skipped'}</span>
        </div>
        <div class="confirmation-row">
          <span class="confirmation-label">Last Review Date</span>
          <span class="confirmation-value">${state.lastReviewDate || 'Not set'}</span>
        </div>
        <div class="confirmation-row">
          <span class="confirmation-label">Review Period</span>
          <span class="confirmation-value">
            ${state.periodStart && state.periodEnd
              ? `${state.periodStart} — ${state.periodEnd}`
              : 'Not set'}
          </span>
        </div>
      </div>
    </div>
  `;
}

function validateGithubPat(token) {
  if (!token) return { valid: false, message: '' };
  const isValid = (token.startsWith('ghp_') || token.startsWith('github_pat_')) && token.length >= 30;
  return {
    valid: isValid,
    message: isValid ? 'Token format looks valid' : 'Token must start with "ghp_" or "github_pat_" and be at least 30 characters',
  };
}

function collectCurrentStepData(state) {
  switch (state.currentStep) {
    case 0: {
      const input = document.getElementById('github-pat');
      if (input) state.githubPat = input.value.trim();
      break;
    }
    case 1: {
      const textarea = document.getElementById('review-feedback');
      if (textarea) state.lastReviewFeedback = textarea.value.trim();
      break;
    }
    case 2: {
      const lastReview = document.getElementById('last-review-date');
      const start = document.getElementById('period-start');
      const end = document.getElementById('period-end');
      if (lastReview) state.lastReviewDate = lastReview.value;
      if (start) state.periodStart = start.value;
      if (end) state.periodEnd = end.value;
      break;
    }
    case 3: {
      const select = document.getElementById('level-override');
      if (select) state.level = select.value;
      break;
    }
  }
}

function validateCurrentStep(state) {
  switch (state.currentStep) {
    case 0: {
      // PAT is optional — but if provided, must be valid format and verified
      if (state.githubPat) {
        const { valid } = validateGithubPat(state.githubPat);
        if (!valid) {
          const errorEl = document.getElementById('pat-error');
          if (errorEl) errorEl.classList.add('visible');
          return false;
        }
        if (!state.patVerified) {
          const statusEl = document.getElementById('pat-status');
          if (statusEl) {
            statusEl.textContent = 'Please verify your token before continuing.';
            statusEl.className = 'token-status invalid';
          }
          return false;
        }
      }
      return true;
    }
    case 1:
      return true;
    case 2:
      if (state.periodEnd && !state.periodStart) return false;
      return true;
    case 3:
      return true;
    default:
      return true;
  }
}

function bindEvents(state, user, levels) {
  // Back button
  const backBtn = document.getElementById('wizard-back');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      collectCurrentStepData(state);
      state.currentStep--;
      state._render();
    });
  }

  // Next button
  const nextBtn = document.getElementById('wizard-next');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      collectCurrentStepData(state);
      if (!validateCurrentStep(state)) return;
      state.currentStep++;
      state._render();
    });
  }

  // Finish button
  const finishBtn = document.getElementById('wizard-finish');
  if (finishBtn) {
    finishBtn.addEventListener('click', async () => {
      collectCurrentStepData(state);
      finishBtn.disabled = true;
      finishBtn.textContent = 'Saving...';

      try {
        await saveWizardData(user, state);

        const profile = {
          level: state.level,
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
          githubPat: state._encryptedPat || '',
          githubUsername: state.githubUsername,
        };

        // If PAT was provided, go to fetch screen; otherwise, straight to dashboard
        if (state.githubPat) {
          showFetchScreen(user, profile);
        } else {
          showDashboard(user, profile);
        }
      } catch (e) {
        console.error('Failed to save wizard data:', e);
        finishBtn.disabled = false;
        finishBtn.textContent = 'Complete Setup';
        alert('Failed to save. Please try again.');
      }
    });
  }

  // PAT format validation on input
  const patInput = document.getElementById('github-pat');
  if (patInput) {
    patInput.addEventListener('input', () => {
      const value = patInput.value.trim();
      const statusEl = document.getElementById('pat-status');
      const errorEl = document.getElementById('pat-error');

      // Reset verified state if token changes
      state.patVerified = false;
      state.githubUsername = '';

      if (!value) {
        statusEl.innerHTML = '';
        statusEl.className = 'token-status';
        errorEl.classList.remove('visible');
        return;
      }

      const { valid, message } = validateGithubPat(value);
      statusEl.textContent = message;
      statusEl.className = `token-status ${valid ? 'valid' : 'invalid'}`;
      errorEl.classList.remove('visible');
    });
  }

  // Verify PAT button
  const verifyBtn = document.getElementById('verify-pat-btn');
  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      const patInput = document.getElementById('github-pat');
      const statusEl = document.getElementById('pat-status');
      const errorEl = document.getElementById('pat-error');
      const token = patInput?.value.trim();

      if (!token) return;

      const { valid: formatValid } = validateGithubPat(token);
      if (!formatValid) {
        errorEl.classList.add('visible');
        return;
      }

      verifyBtn.disabled = true;
      verifyBtn.textContent = 'Verifying...';
      statusEl.textContent = 'Checking token with GitHub...';
      statusEl.className = 'token-status';

      const result = await testPat(token);

      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify Token';

      if (result.valid) {
        state.patVerified = true;
        state.githubUsername = result.username;
        state.githubPat = token;
        statusEl.innerHTML = `<span class="token-status valid">Verified — logged in as <strong>${escapeHtml(result.username)}</strong></span>`;
        statusEl.className = 'token-status valid';
      } else {
        state.patVerified = false;
        statusEl.textContent = result.error;
        statusEl.className = 'token-status invalid';
      }
    });
  }

  // Last review date → auto-compute period start
  const lastReviewInput = document.getElementById('last-review-date');
  if (lastReviewInput) {
    lastReviewInput.addEventListener('change', () => {
      state.lastReviewDate = lastReviewInput.value;
      if (state.lastReviewDate) {
        const d = new Date(state.lastReviewDate);
        d.setMonth(d.getMonth() - 2);
        state.periodStart = d.toISOString().slice(0, 10);
        const startInput = document.getElementById('period-start');
        if (startInput) startInput.value = state.periodStart;
      }
    });
  }
}

async function saveWizardData(user, state) {
  const users = quick.db.collection('users');
  const existing = await users.where({ email: user.email }).find();

  // Encrypt the PAT before storing
  let encryptedPat = '';
  if (state.githubPat) {
    encryptedPat = await encryptToken(state.githubPat, user.email);
    state._encryptedPat = encryptedPat;
  }

  const data = {
    email: user.email,
    fullName: user.fullName,
    title: user.title,
    level: state.level,
    githubPat: encryptedPat,
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
}
