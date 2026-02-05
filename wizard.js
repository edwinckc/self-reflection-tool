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
        </div>
        <div style="margin-top: var(--spacing-lg);">
          <button class="btn btn-secondary" id="restart-wizard-btn">Redo Setup</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('restart-wizard-btn').addEventListener('click', () => {
    // Re-import to avoid circular dependency issues at top level
    import('./app.js').then(({ LEVELS, mapTitleToLevel }) => {
      const detectedLevel = mapTitleToLevel(user.title);
      createWizard(user, detectedLevel, LEVELS);
    });
  });
}

/**
 * Create and render the 4-step setup wizard.
 */
export function createWizard(user, detectedLevel, levels) {
  const main = document.getElementById('main-content');

  const state = {
    currentStep: 0,
    githubPat: '',
    lastReviewFeedback: '',
    lastReviewDate: '',
    periodStart: '',
    periodEnd: '',
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
            ? `<button class="btn btn-primary" id="wizard-next">Next</button>`
            : `<button class="btn btn-primary" id="wizard-finish">Complete Setup</button>`
          }
        </div>
      </div>
    `;

    bindEvents(state, user, levels);
  }

  render();

  // Store render function on state so we can re-render from event handlers
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
          Create a token at GitHub → Settings → Developer Settings → Personal Access Tokens.
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
        </div>
        <div id="pat-status" class="token-status"></div>
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
        <p class="form-hint">When was your most recent completed review?</p>
        <input type="date" id="last-review-date" value="${state.lastReviewDate}">
      </div>
      <div class="form-group">
        <label for="period-start">Review Period Start</label>
        <input type="date" id="period-start" value="${state.periodStart}">
      </div>
      <div class="form-group">
        <label for="period-end">Review Period End</label>
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
          <span class="confirmation-value">${state.githubPat ? '●●●●●●●●' : 'Not set'}</span>
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
      // PAT is optional but if provided, must be valid format
      if (state.githubPat) {
        const { valid } = validateGithubPat(state.githubPat);
        if (!valid) {
          const errorEl = document.getElementById('pat-error');
          if (errorEl) errorEl.classList.add('visible');
          return false;
        }
      }
      return true;
    }
    case 1:
      // Feedback is optional
      return true;
    case 2:
      // Dates are optional but if period-end is set, period-start should be too
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
        showDashboard(user, {
          level: state.level,
          periodStart: state.periodStart,
          periodEnd: state.periodEnd,
          githubPat: state.githubPat,
        });
      } catch (e) {
        console.error('Failed to save wizard data:', e);
        finishBtn.disabled = false;
        finishBtn.textContent = 'Complete Setup';
        alert('Failed to save. Please try again.');
      }
    });
  }

  // PAT validation on input
  const patInput = document.getElementById('github-pat');
  if (patInput) {
    patInput.addEventListener('input', () => {
      const value = patInput.value.trim();
      const statusEl = document.getElementById('pat-status');
      const errorEl = document.getElementById('pat-error');

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
}

async function saveWizardData(user, state) {
  const users = quick.db.collection('users');

  // Check if user already exists
  const existing = await users.where({ email: user.email }).find();

  const data = {
    email: user.email,
    fullName: user.fullName,
    title: user.title,
    level: state.level,
    githubPat: state.githubPat,
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
