import { isValidPATFormat, testPAT } from './github.js';

const TOTAL_STEPS = 4;

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
 */
export function showDashboard(user, profile) {
  const main = document.getElementById('main-content');
  const nameEl = document.createElement('span');
  nameEl.textContent = user.fullName || user.email;

  main.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'wizard';
  wrapper.innerHTML = `
    <div class="wizard-body">
      <h2></h2>
      <p class="step-description">Your setup is complete. Reflection questions will appear in the sidebar.</p>
      <div class="confirmation-card" style="margin-top: var(--spacing-lg);">
        <div class="confirmation-row">
          <span class="confirmation-label">Level</span>
          <span class="confirmation-value">${escapeHtml(profile.level)}</span>
        </div>
        <div class="confirmation-row">
          <span class="confirmation-label">Review Period</span>
          <span class="confirmation-value">${escapeHtml(profile.periodStart)} — ${escapeHtml(profile.periodEnd)}</span>
        </div>
        <div class="confirmation-row">
          <span class="confirmation-label">GitHub</span>
          <span class="confirmation-value">${profile.githubUsername ? escapeHtml(profile.githubUsername) : (profile.githubPat ? '●●●●●●●●' : 'Not set')}</span>
        </div>
      </div>
      <div style="margin-top: var(--spacing-lg);">
        <button class="btn btn-secondary" id="restart-wizard-btn">Redo Setup</button>
      </div>
    </div>
  `;

  const h2 = wrapper.querySelector('h2');
  h2.textContent = `Welcome back, ${user.fullName || user.email}`;

  main.appendChild(wrapper);

  document.getElementById('restart-wizard-btn').addEventListener('click', () => {
    import('./app.js').then(({ LEVELS, mapTitleToLevel }) => {
      const detectedLevel = mapTitleToLevel(user.title);
      createWizard(user, detectedLevel, LEVELS);
    });
  });
}

function subtractMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().split('T')[0];
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Create and render the 4-step setup wizard.
 */
export function createWizard(user, detectedLevel, levels) {
  const main = document.getElementById('main-content');

  const defaultLastReview = '2025-10-31';

  const state = {
    currentStep: 0,
    githubPat: '',
    githubUsername: '',
    patValidated: false,
    patTesting: false,
    lastReviewFeedback: '',
    lastReviewDate: defaultLastReview,
    periodStart: subtractMonths(defaultLastReview, 2),
    periodEnd: todayISO(),
    level: detectedLevel || 'C5',
  };

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
            ? `<button class="btn btn-primary" id="wizard-next"${state.currentStep === 0 && !state.patValidated ? ' disabled' : ''}>Next</button>`
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
            <span class="step-number">${i < currentStep ? '\u2713' : i + 1}</span>
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
  const statusHtml = state.patValidated
    ? `<div class="token-status valid">Connected as <strong>${escapeHtml(state.githubUsername)}</strong></div>`
    : state.patTesting
    ? `<div class="token-status">Testing connection...</div>`
    : '';

  return `
    <div class="wizard-step active">
      <h2>GitHub Personal Access Token</h2>
      <p class="step-description">
        We need a GitHub PAT to fetch your pull requests and contributions
        during the review period.
      </p>
      <div class="form-group">
        <label for="github-pat">Personal Access Token</label>
        <p class="form-hint">
          Create a token at GitHub &rarr; Settings &rarr; Developer Settings &rarr; Personal Access Tokens.
          It needs the <code>repo</code> scope.
        </p>
        <div class="token-input-wrapper">
          <input
            type="password"
            id="github-pat"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            value="${escapeHtml(state.githubPat)}"
            autocomplete="off"
          >
          <button class="token-toggle" id="pat-toggle" type="button">show</button>
        </div>
        ${statusHtml}
        <div id="pat-error" class="form-error">Token must start with "ghp_" or "github_pat_".</div>
      </div>
      <button class="btn btn-secondary" id="test-pat-btn"${!state.githubPat || state.patTesting ? ' disabled' : ''} style="margin-top:var(--spacing-sm)">
        ${state.patTesting ? 'Testing...' : 'Test Connection'}
      </button>
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
        >${escapeHtml(state.lastReviewFeedback)}</textarea>
      </div>
    </div>
  `;
}

function renderDatesStep(state) {
  return `
    <div class="wizard-step active">
      <h2>Review Period</h2>
      <p class="step-description">
        Specify the dates for your upcoming review. We'll fetch contributions
        within this time window.
      </p>
      <div class="form-group">
        <label for="last-review-date">Last Review Date</label>
        <p class="form-hint">When your last impact review ended. Defaults to end of October 2025.</p>
        <input type="date" id="last-review-date" value="${state.lastReviewDate}">
      </div>
      <div class="date-range-row">
        <div class="form-group">
          <label for="period-start">Period Start</label>
          <p class="form-hint">Auto-calculated: 2 months before last review.</p>
          <input type="date" id="period-start" value="${state.periodStart}">
        </div>
        <div class="form-group">
          <label for="period-end">Period End</label>
          <p class="form-hint">Defaults to today.</p>
          <input type="date" id="period-end" value="${state.periodEnd}">
        </div>
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
            `<option value="${l.value}" ${l.value === state.level ? 'selected' : ''}>${escapeHtml(l.label)}</option>`
          ).join('')}
        </select>
      </div>

      <div class="confirmation-card">
        <div class="confirmation-row">
          <span class="confirmation-label">GitHub</span>
          <span class="confirmation-value">${state.patValidated ? escapeHtml(state.githubUsername) : (state.githubPat ? '●●●●●●●●' : 'Not set')}</span>
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
      // PAT must be validated via the Test Connection button
      if (!state.patValidated) {
        const errorEl = document.getElementById('pat-error');
        if (errorEl) {
          errorEl.textContent = 'Please test your token before continuing.';
          errorEl.classList.add('visible');
        }
        return false;
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
        // Delegate save + fetch to app.js
        const { onWizardComplete } = await import('./app.js');
        await onWizardComplete(user, state);
      } catch (e) {
        console.error('Failed to complete setup:', e);
        finishBtn.disabled = false;
        finishBtn.textContent = 'Complete Setup';
        alert('Failed to save. Please try again.');
      }
    });
  }

  // PAT show/hide toggle
  const patToggle = document.getElementById('pat-toggle');
  const patInput = document.getElementById('github-pat');
  if (patToggle && patInput) {
    patToggle.addEventListener('click', () => {
      const isPassword = patInput.type === 'password';
      patInput.type = isPassword ? 'text' : 'password';
      patToggle.textContent = isPassword ? 'hide' : 'show';
    });
  }

  // PAT input change — reset validation
  if (patInput) {
    patInput.addEventListener('input', () => {
      state.githubPat = patInput.value.trim();
      state.patValidated = false;
      state.githubUsername = '';
      const errorEl = document.getElementById('pat-error');
      if (errorEl) errorEl.classList.remove('visible');

      // Update Next button state
      const next = document.getElementById('wizard-next');
      if (next) next.disabled = true;

      // Update test button state
      const testBtn = document.getElementById('test-pat-btn');
      if (testBtn) testBtn.disabled = !state.githubPat;
    });
  }

  // Test Connection button
  const testBtn = document.getElementById('test-pat-btn');
  if (testBtn) {
    testBtn.addEventListener('click', async () => {
      collectCurrentStepData(state);

      if (!isValidPATFormat(state.githubPat)) {
        const errorEl = document.getElementById('pat-error');
        if (errorEl) {
          errorEl.textContent = 'Token must start with "ghp_" or "github_pat_" and be at least 30 characters.';
          errorEl.classList.add('visible');
        }
        return;
      }

      state.patTesting = true;
      state._render();

      try {
        const ghUser = await testPAT(state.githubPat);
        state.patValidated = true;
        state.githubUsername = ghUser.login;
        state.patTesting = false;
        state._render();
      } catch (err) {
        state.patTesting = false;
        state.patValidated = false;
        state._render();
        const errorEl = document.getElementById('pat-error');
        if (errorEl) {
          errorEl.textContent = err.message;
          errorEl.classList.add('visible');
        }
      }
    });
  }

  // Date auto-calculation: changing last review date updates period start
  const lastReviewInput = document.getElementById('last-review-date');
  const periodStartInput = document.getElementById('period-start');
  if (lastReviewInput && periodStartInput) {
    lastReviewInput.addEventListener('change', () => {
      state.lastReviewDate = lastReviewInput.value;
      state.periodStart = subtractMonths(lastReviewInput.value, 2);
      periodStartInput.value = state.periodStart;
    });
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function saveWizardData(user, state) {
  const users = quick.db.collection('users');
  const existing = await users.where({ email: user.email }).find();

  const data = {
    email: user.email,
    fullName: user.fullName,
    title: user.title,
    level: state.level,
    githubPat: state.githubPat,
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
