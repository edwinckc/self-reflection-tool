/**
 * AI client module — wraps the OpenAI SDK configured for Quick's AI proxy.
 * The SDK is pre-loaded via CDN in index.html and available on window.OpenAI.
 */

const openai = new window.OpenAI({
  baseURL: '/api/ai',
  apiKey: 'not-needed',
  dangerouslyAllowBrowser: true,
});

export { openai };
