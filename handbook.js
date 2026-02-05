/**
 * Impact Handbook data for C5, C6, and C7 engineering levels.
 *
 * Structure:
 *   - Foundation: table-stakes behaviors expected at every level
 *   - Core: level-specific expectations (differs per level)
 *   - Peak: stretch behaviors that demonstrate outsized impact
 *
 * Each category has: id, name, description, and examples.
 */

// ── Foundation (shared across levels) ──

const FOUNDATION = [
  {
    id: 'shipping-prs',
    name: 'Shipping PRs',
    description:
      'Consistently shipping well-scoped, well-tested pull requests that move projects forward.',
    examples: [
      'Regularly merging PRs that are focused and reviewable',
      'Writing clear PR descriptions that explain the why',
      'Breaking large changes into incremental, shippable pieces',
    ],
  },
  {
    id: 'reviewing-prs',
    name: 'Reviewing PRs',
    description:
      'Providing thoughtful, timely code reviews that improve quality and help teammates grow.',
    examples: [
      'Leaving constructive feedback that catches real issues',
      'Reviewing with context — understanding the broader goal',
      'Turning reviews around quickly to unblock others',
    ],
  },
  {
    id: 'collaborating',
    name: 'Collaborating',
    description:
      'Working effectively with teammates, communicating clearly, and contributing to a healthy team dynamic.',
    examples: [
      'Pairing with teammates to solve tricky problems',
      'Communicating blockers and trade-offs proactively',
      'Participating constructively in design discussions',
    ],
  },
  {
    id: 'team-responsibilities',
    name: 'Team Responsibilities',
    description:
      'Fulfilling team obligations like on-call duties, incident response, and operational excellence.',
    examples: [
      'Responding to incidents and following up with post-mortems',
      'Maintaining team runbooks and documentation',
      'Taking on bug triage or support rotation shifts',
    ],
  },
  {
    id: 'using-ai',
    name: 'Using AI',
    description:
      'Leveraging AI tools to accelerate development, automate repetitive tasks, and improve productivity.',
    examples: [
      'Using AI-assisted coding to move faster on implementation',
      'Automating repetitive tasks with AI tools',
      'Evaluating AI-generated suggestions critically',
    ],
  },
];

// ── Core (level-specific) ──

const CORE_C5 = [
  {
    id: 'advancing-projects',
    name: 'Advancing Projects',
    description:
      'Driving assigned work items forward reliably, escalating when stuck, and delivering on commitments.',
    examples: [
      'Completing feature work within estimated timelines',
      'Proactively raising blockers before they stall progress',
      'Following through on action items from design reviews',
    ],
  },
  {
    id: 'building-knowledge',
    name: 'Building Knowledge',
    description:
      'Actively learning the codebase, domain, and tools. Asking good questions and documenting findings.',
    examples: [
      'Ramping up on unfamiliar areas of the codebase efficiently',
      'Documenting learnings and patterns for the team',
      'Seeking feedback and iterating on approach',
    ],
  },
  {
    id: 'improving-quality',
    name: 'Improving Quality',
    description:
      'Contributing to code quality through testing, refactoring, and following best practices.',
    examples: [
      'Adding tests for untested code paths',
      'Refactoring code you touch to leave it better than you found it',
      'Following established patterns and conventions',
    ],
  },
];

const CORE_C6 = [
  {
    id: 'leading-projects',
    name: 'Leading Projects',
    description:
      'Owning the delivery of a feature or project end-to-end. Coordinating across teams when needed.',
    examples: [
      'Driving a project from design through launch',
      'Coordinating with product, design, and other engineering teams',
      'Making technical decisions and documenting trade-offs',
    ],
  },
  {
    id: 'taking-ownership',
    name: 'Taking Ownership',
    description:
      'Going beyond assigned work to identify and solve problems that improve the team\'s systems and processes.',
    examples: [
      'Identifying and fixing systemic issues without being asked',
      'Owning operational health of team services',
      'Proactively improving developer experience or CI/CD pipelines',
    ],
  },
  {
    id: 'mentoring',
    name: 'Mentoring',
    description:
      'Helping teammates grow through code reviews, pairing, and knowledge sharing.',
    examples: [
      'Mentoring junior developers through complex problems',
      'Running knowledge-sharing sessions or tech talks',
      'Writing detailed code reviews that teach, not just correct',
    ],
  },
];

const CORE_C7 = [
  {
    id: 'shaping-direction',
    name: 'Shaping Technical Direction',
    description:
      'Defining architecture and technical strategy for your area. Setting patterns others follow.',
    examples: [
      'Writing RFCs or design documents that shape team direction',
      'Evaluating and adopting new technologies strategically',
      'Defining coding standards and architectural patterns',
    ],
  },
  {
    id: 'cross-team-impact',
    name: 'Cross-Team Impact',
    description:
      'Driving improvements that affect multiple teams or the broader engineering organization.',
    examples: [
      'Building shared infrastructure or libraries used by other teams',
      'Leading cross-team initiatives or migrations',
      'Representing your team in org-wide technical decisions',
    ],
  },
  {
    id: 'raising-the-bar',
    name: 'Raising the Bar',
    description:
      'Elevating engineering quality and practices across the organization.',
    examples: [
      'Introducing testing or reliability practices adopted by other teams',
      'Creating tooling that improves developer productivity broadly',
      'Setting new standards for performance, security, or observability',
    ],
  },
];

// ── Peak (shared across levels, stretch behaviors) ──

const PEAK = [
  {
    id: 'telling-people',
    name: 'Telling People',
    description:
      'Communicating your work and its impact clearly — in PRDs, demos, posts, or presentations.',
    examples: [
      'Writing compelling project updates or launch announcements',
      'Presenting technical work to non-technical stakeholders',
      'Sharing learnings through blog posts or internal talks',
    ],
  },
  {
    id: 'side-quests',
    name: 'Side Quests',
    description:
      'Contributing to areas outside your immediate team scope — hack days, open source, internal tools.',
    examples: [
      'Contributing to open-source projects or internal shared tools',
      'Building prototypes during hack days that get adopted',
      'Helping other teams with debugging or architecture advice',
    ],
  },
  {
    id: 'stretching-impact',
    name: 'Stretching Impact',
    description:
      'Finding ways to amplify your impact beyond individual contributions — through tooling, processes, or culture.',
    examples: [
      'Creating automation that saves the team hours every week',
      'Establishing a new process that improves team velocity',
      'Championing a cultural change that improves team health',
    ],
  },
  {
    id: 'cultivating-best-practices',
    name: 'Cultivating Best Practices',
    description:
      'Defining and spreading engineering best practices within and beyond your team.',
    examples: [
      'Writing and maintaining team engineering guidelines',
      'Running workshops or training sessions',
      'Creating templates or starter kits that accelerate team output',
    ],
  },
];

// ── Public API ──

const CORE_BY_LEVEL = {
  C4: CORE_C5,   // C4 uses same core as C5 (junior variant)
  C5: CORE_C5,
  C6: CORE_C6,
  C7: CORE_C7,
  C8: CORE_C7,   // C8 uses same core as C7 (principal variant)
};

/**
 * Get the full handbook for a given level.
 * Returns { foundation, core, peak } with arrays of category objects.
 */
export function getHandbook(level) {
  const core = CORE_BY_LEVEL[level] || CORE_C5;
  return {
    foundation: FOUNDATION,
    core,
    peak: PEAK,
  };
}

/**
 * Get all categories as a flat array (for prompt building).
 */
export function getAllCategories(level) {
  const { foundation, core, peak } = getHandbook(level);
  return [...foundation, ...core, ...peak];
}

/**
 * Build a text summary of the handbook for use in AI prompts.
 */
export function handbookToPromptText(level) {
  const { foundation, core, peak } = getHandbook(level);

  function renderSection(title, categories) {
    return `## ${title}\n${categories.map(c =>
      `- **${c.name}**: ${c.description}`
    ).join('\n')}`;
  }

  return [
    renderSection('Foundation (table stakes)', foundation),
    renderSection(`Core (${level}-specific expectations)`, core),
    renderSection('Peak (stretch behaviors)', peak),
  ].join('\n\n');
}
