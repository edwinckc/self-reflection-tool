import { createWizard, hasCompletedWizard, showDashboard } from './wizard.js';

/**
 * Map a Shopify job title to an engineering level (C-level).
 * Returns null if no match is found.
 */
function mapTitleToLevel(title) {
  if (!title) return null;
  const t = title.toLowerCase();

  // Order matters: check more specific titles first
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

function renderUserInfo(user, level) {
  const container = document.getElementById('user-info');
  container.innerHTML = `
    <div class="user-info-display">
      ${user.slackImageUrl ? `<img class="user-avatar" src="${user.slackImageUrl}" alt="">` : ''}
      <div>
        <div class="user-name">${user.fullName || user.email}</div>
        <div class="user-title">${user.title || 'Unknown title'}</div>
      </div>
      ${level ? `<span class="user-level-badge">${level}</span>` : ''}
    </div>
  `;
}

async function init() {
  const loadingScreen = document.getElementById('loading-screen');

  try {
    const user = await quick.id.waitForUser();
    const detectedLevel = mapTitleToLevel(user.title);

    renderUserInfo(user, detectedLevel);

    // Check if user has completed the wizard before
    const completed = await hasCompletedWizard(user.email);

    if (completed) {
      showDashboard(user, completed);
    } else {
      createWizard(user, detectedLevel, LEVELS);
    }
  } catch (error) {
    console.error('Failed to initialize:', error);
    loadingScreen.innerHTML = `
      <p style="color: var(--color-error);">
        Failed to load user identity. Make sure you're running this on Quick.
      </p>
    `;
  }
}

// Export for use by other modules
export { mapTitleToLevel, LEVELS };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
