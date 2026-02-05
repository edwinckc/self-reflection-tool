/**
 * AI-powered project clustering, impact mapping, and question generation.
 *
 * Uses OpenAI (via Quick proxy) to:
 *   1. Cluster PRs into logical projects
 *   2. Map clusters to Impact Handbook categories
 *   3. Generate reflection questions per cluster
 */

import { openai } from './ai.js';
import { handbookToPromptText, getAllCategories } from './handbook.js';

// ── 1. Project Clustering ──

/**
 * Cluster PRs into logical projects using AI.
 *
 * @param {Array} prs - Array of PR objects { title, url, repo, mergedAt, body, additions, deletions }
 * @param {(text: string) => void} onStream - Callback for streaming text chunks
 * @returns {Promise<Array>} Clusters: [{ id, name, summary, prs }]
 */
export async function clusterPRsIntoProjects(prs, onStream) {
  if (prs.length === 0) return [];

  const prSummaries = prs.map((pr, i) => ({
    index: i,
    title: pr.title,
    repo: pr.repo,
    mergedAt: pr.mergedAt,
    additions: pr.additions,
    deletions: pr.deletions,
    bodySnippet: (pr.body || '').slice(0, 200),
  }));

  const prompt = `You are analyzing a developer's pull requests to cluster them into logical projects or work streams.

Given these PRs, group them into clusters based on:
- Same repository and related functionality
- Similar PR title patterns (e.g., all related to "checkout", "auth", etc.)
- Time proximity (PRs close in time on the same topic)
- Related topics or features (even across repos)

PRs:
${JSON.stringify(prSummaries, null, 2)}

Respond with ONLY valid JSON — no markdown, no code fences. Use this exact structure:
[
  {
    "id": "cluster-1",
    "name": "Short descriptive project name",
    "summary": "2-3 sentence summary of what this cluster of work accomplished",
    "prIndices": [0, 3, 7]
  }
]

Rules:
- Every PR must belong to exactly one cluster
- Use the PR index numbers from the input
- Aim for 3-8 clusters (fewer if the work is focused, more if diverse)
- Name clusters after the project/feature, not the repo
- If a PR doesn't clearly fit a group, create a "Miscellaneous" cluster`;

  let fullResponse = '';

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    temperature: 0.3,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    fullResponse += delta;
    onStream?.(delta);
  }

  const clusters = parseJSON(fullResponse);

  // Attach actual PR objects to each cluster
  return clusters.map(cluster => ({
    id: cluster.id,
    name: cluster.name,
    summary: cluster.summary,
    prs: (cluster.prIndices || []).map(i => prs[i]).filter(Boolean),
  }));
}

// ── 2. Impact Mapping ──

/**
 * Map each cluster to relevant Impact Handbook categories.
 *
 * @param {Array} clusters - Output from clusterPRsIntoProjects
 * @param {string} level - Engineering level (e.g., "C5", "C6", "C7")
 * @param {(text: string) => void} onStream - Callback for streaming text chunks
 * @returns {Promise<Array>} Mappings: [{ clusterId, categories: [{ categoryId, relevance, evidence }] }]
 */
export async function mapClustersToHandbook(clusters, level, onStream) {
  if (clusters.length === 0) return [];

  const handbookText = handbookToPromptText(level);
  const categories = getAllCategories(level);
  const categoryIds = categories.map(c => c.id);

  const clusterSummaries = clusters.map(c => ({
    id: c.id,
    name: c.name,
    summary: c.summary,
    prCount: c.prs.length,
    repos: [...new Set(c.prs.map(p => p.repo))],
    prTitles: c.prs.map(p => p.title).slice(0, 10),
  }));

  const prompt = `You are mapping a developer's project clusters to Shopify's Impact Handbook categories for a ${level} engineer.

Impact Handbook for ${level}:
${handbookText}

Valid category IDs: ${JSON.stringify(categoryIds)}

Project clusters:
${JSON.stringify(clusterSummaries, null, 2)}

For each cluster, determine which handbook categories are most relevant based on the work described.

Respond with ONLY valid JSON — no markdown, no code fences:
[
  {
    "clusterId": "cluster-1",
    "categories": [
      {
        "categoryId": "shipping-prs",
        "relevance": "high",
        "evidence": "Brief explanation of why this category applies"
      }
    ]
  }
]

Rules:
- Only use category IDs from the valid list above
- Assign 2-4 categories per cluster
- Relevance must be "high", "medium", or "low"
- Evidence should be 1 sentence referencing the cluster's work
- Consider the ${level} level — focus on categories that match level expectations`;

  let fullResponse = '';

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    temperature: 0.3,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    fullResponse += delta;
    onStream?.(delta);
  }

  return parseJSON(fullResponse);
}

// ── 3. Question Generation ──

/**
 * Generate reflection questions for a single cluster based on its handbook mappings.
 *
 * @param {Object} cluster - A cluster object { id, name, summary, prs }
 * @param {Array} mappings - Handbook mappings for this cluster [{ categoryId, relevance, evidence }]
 * @param {(text: string) => void} onStream - Callback for streaming text chunks
 * @returns {Promise<Object>} { clusterId, questions: [{ id, text, context }] }
 */
export async function generateQuestionsForCluster(cluster, mappings, onStream) {
  const prDetails = cluster.prs.slice(0, 8).map(p => ({
    title: p.title,
    repo: p.repo,
    url: p.url,
  }));

  const prompt = `You are helping a developer prepare for their performance review by generating self-reflection questions.

Project: "${cluster.name}"
Summary: ${cluster.summary}

PRs in this project:
${prDetails.map(p => `- ${p.title} (${p.repo})`).join('\n')}

Handbook categories this project maps to:
${mappings.map(m => `- ${m.categoryId}: ${m.evidence}`).join('\n')}

Generate 2-4 reflection questions that help the developer articulate their impact. Questions should:
- Reference specific PRs or work from this project
- Cover business/user impact, collaboration approach, and challenges/learnings
- Be open-ended to prompt thoughtful narrative answers
- Help the developer connect their technical work to broader impact

Respond with ONLY valid JSON — no markdown, no code fences:
[
  {
    "id": "q1",
    "text": "The question text",
    "context": "Brief context about why this question matters"
  }
]`;

  let fullResponse = '';

  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    temperature: 0.5,
  });

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content || '';
    fullResponse += delta;
    onStream?.(delta);
  }

  const questions = parseJSON(fullResponse);

  return {
    clusterId: cluster.id,
    questions: questions.map((q, i) => ({
      id: `${cluster.id}-q${i + 1}`,
      text: q.text,
      context: q.context || '',
    })),
  };
}

// ── 4. Full Pipeline ──

/**
 * Run the full analysis pipeline: cluster → map → generate questions.
 * Reports stage-level progress via onStageChange callback.
 *
 * @param {Array} prs - Array of PR objects
 * @param {string} level - Engineering level
 * @param {string} userEmail - For persisting results
 * @param {(stage: {step: number, label: string, detail?: string}) => void} onStageChange
 * @returns {Promise<Object>} { clusters, mappings, questions }
 */
export async function runAnalysisPipeline(prs, level, userEmail, onStageChange) {
  // Stage 1: Clustering
  onStageChange({ step: 1, label: 'Clustering PRs into projects...' });
  const clusters = await clusterPRsIntoProjects(prs, (text) => {
    onStageChange({ step: 1, label: 'Clustering PRs into projects...', detail: text });
  });

  // Stage 2: Impact Mapping
  onStageChange({ step: 2, label: 'Mapping to Impact Handbook...' });
  const mappings = await mapClustersToHandbook(clusters, level, (text) => {
    onStageChange({ step: 2, label: 'Mapping to Impact Handbook...', detail: text });
  });

  // Stage 3: Question Generation (per cluster)
  const allQuestions = [];
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const clusterMappings = mappings.find(m => m.clusterId === cluster.id)?.categories || [];

    onStageChange({
      step: 3,
      label: `Generating questions... (${i + 1}/${clusters.length})`,
    });

    const result = await generateQuestionsForCluster(cluster, clusterMappings, (text) => {
      onStageChange({
        step: 3,
        label: `Generating questions... (${i + 1}/${clusters.length})`,
        detail: text,
      });
    });

    allQuestions.push(result);
  }

  // Persist to Quick DB
  const assessment = {
    userEmail,
    clusters,
    mappings,
    questions: allQuestions,
    narrative: null,
    generatedAt: Date.now(),
  };

  await saveAssessment(assessment);

  return assessment;
}

// ── Persistence ──

async function saveAssessment(assessment) {
  try {
    const collection = quick.db.collection('assessments');
    const existing = await collection.where({ userEmail: assessment.userEmail }).find();

    if (existing && existing.length > 0) {
      await collection.update(existing[0].id, assessment);
    } else {
      await collection.create(assessment);
    }
  } catch (e) {
    console.error('Failed to save assessment to Quick DB:', e);
  }
}

/**
 * Load an existing assessment for a user from Quick DB.
 */
export async function loadAssessment(userEmail) {
  try {
    const collection = quick.db.collection('assessments');
    const results = await collection.where({ userEmail }).find();
    return results && results.length > 0 ? results[0] : null;
  } catch (e) {
    console.error('Failed to load assessment:', e);
    return null;
  }
}

// ── Helpers ──

/**
 * Parse JSON from an AI response, handling common issues like markdown fences.
 */
function parseJSON(text) {
  let cleaned = text.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse AI response as JSON:', e, cleaned);
    return [];
  }
}
