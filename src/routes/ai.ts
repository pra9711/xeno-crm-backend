import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { AuthRequest, authenticateUser } from '../middleware/auth';
import axios from 'axios';
import { z } from 'zod';

const router = express.Router();

// Helper: try to extract a human-readable text from various provider response shapes
function extractTextFromProviderResponse(data: any): string | null {
  if (!data) return null;

  // If it's already a string, return it (trimmed)
  if (typeof data === 'string') {
    const s = data.trim();
    // If it looks like JSON, attempt to parse and continue
    if ((s.startsWith('{') || s.startsWith('['))) {
      try { data = JSON.parse(s); } catch (e) { return s; }
    } else {
      return s;
    }
  }

  // Common nested shapes used by Google/PaLM / Gemini responses
  try {
    // candidates -> content -> parts -> text
    const cand = data?.candidates?.[0];
    if (cand) {
      const content = cand.content || cand.output || cand;
      if (content) {
        const parts = content.parts || content?.[0]?.content?.parts || content?.content?.parts || content;
        // parts may be array or object
        if (Array.isArray(parts) && parts[0]?.text) return String(parts[0].text).trim();
        if (parts?.parts && Array.isArray(parts.parts) && parts.parts[0]?.text) return String(parts.parts[0].text).trim();
        if (content?.parts && Array.isArray(content.parts) && content.parts[0]?.text) return String(content.parts[0].text).trim();
      }
    }

    // Some responses put text under candidates[0].parts[0].text
    if (data?.candidates?.[0]?.parts?.[0]?.text) return String(data.candidates[0].parts[0].text).trim();

    // OpenAI-like shapes
    if (data?.choices?.[0]?.text) return String(data.choices[0].text).trim();
    if (data?.choices?.[0]?.message?.content) return String(data.choices[0].message.content).trim();

    // Google generative may put outputs/results
    if (data?.output?.[0]?.content?.[0]?.text) return String(data.output[0].content[0].text).trim();
    if (data?.results?.[0]?.output?.content?.[0]?.text) return String(data.results[0].output.content[0].text).trim();

    // fallback fields
    if (data?.generatedText) return String(data.generatedText).trim();
    if (data?.generated_text) return String(data.generated_text).trim();

  } catch (e) {
    // ignore and fallback
  }

  // Last resort: stringify the object and return null so caller can decide
  return null;
}

// AI-powered natural language to segment rules conversion
router.post('/nl-to-rules', [
  body('prompt').notEmpty().withMessage('Prompt is required')
], authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { prompt } = req.body;
    const rules = await convertNaturalLanguageToRules(prompt);

    res.json({ 
      success: true, 
      data: { 
        prompt, 
        rules, 
        explanation: generateRulesExplanation(rules) 
      } 
    });
  } catch (error) {
    console.error('NL to rules error:', error);
    res.status(500).json({ success: false, error: 'Failed to convert natural language to rules' });
  }
});

// No public dev route present — AI routes require authentication in production

// Dev-only convenience endpoint: allow calling NL->rules without auth when
// running in a non-production environment. This helps local development and
// automated tests where obtaining a full auth session is inconvenient.
if (process.env.NODE_ENV !== 'production') {
  router.post('/nl-to-rules-public', [
    body('prompt').notEmpty().withMessage('Prompt is required')
  ], async (req: express.Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const { prompt } = req.body;
      const rules = await convertNaturalLanguageToRules(prompt);

      res.json({ success: true, data: { prompt, rules, explanation: generateRulesExplanation(rules) } });
    } catch (err) {
      console.error('NL to rules (public) error:', err);
      res.status(500).json({ success: false, error: 'Failed to convert natural language to rules (public)' });
    }
  })
}

// AI-driven message suggestions
router.post('/message-suggestions', [
  body('objective').notEmpty().withMessage('Campaign objective is required'),
  body('audience').optional().isObject()
], authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { objective, audience, tone = 'friendly' } = req.body;
    const suggestions = await generateMessageSuggestions(objective, audience, tone);

    res.json({ success: true, data: { objective, suggestions } });
  } catch (error) {
    console.error('Message suggestions error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate message suggestions' });
  }
});

// Campaign performance summarization
router.post('/campaign-summary', [
  body('campaignId').notEmpty().withMessage('Campaign ID is required')
], authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { campaignId } = req.body;
    const summary = await generateCampaignSummary(campaignId);

    res.json({ success: true, data: { campaignId, summary } });
  } catch (error) {
    console.error('Campaign summary error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate campaign summary' });
  }
});

// Smart scheduling suggestions
router.post('/scheduling-suggestions', [
  body('campaignType').notEmpty().withMessage('Campaign type is required'),
  body('audience').optional().isObject()
], async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { campaignType, audience } = req.body;

    const suggestions = await generateSchedulingSuggestions(campaignType, audience);

  res.json({ success: true, data: { suggestions } });
  } catch (error) {
  console.error('Scheduling suggestions error:', error);
  res.status(500).json({ success: false, error: 'Failed to generate scheduling suggestions' });
  }
});

// Audience lookalike generator
router.post('/lookalike-audience', [
  body('baseAudienceRules').isObject().withMessage('Base audience rules are required')
], async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { baseAudienceRules } = req.body;

    const lookalike = await generateLookalikeAudience(baseAudienceRules);

  res.json({ success: true, data: { baseRules: baseAudienceRules, lookalike } });
  } catch (error) {
  console.error('Lookalike audience error:', error);
  res.status(500).json({ success: false, error: 'Failed to generate lookalike audience' });
  }
});

// Auto-tagging campaigns
router.post('/auto-tag', [
  body('campaignData').isObject().withMessage('Campaign data is required')
], async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { campaignData } = req.body;

    const tags = await generateCampaignTags(campaignData);

  res.json({ success: true, data: { tags, confidence: calculateTagConfidence(tags, campaignData) } });
  } catch (error) {
  console.error('Auto-tag error:', error);
  res.status(500).json({ success: false, error: 'Failed to generate campaign tags' });
  }
});

// AI-powered content personalization
router.post('/personalize-content', [
  body('template').notEmpty().withMessage('Content template is required'),
  body('customerData').isObject().withMessage('Customer data is required')
], async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { template, customerData, tone = 'professional' } = req.body;

    const personalizedContent = await personalizeContent(template, customerData, tone);

  res.json({ success: true, data: { original: template, personalized: personalizedContent, variations: await generateContentVariations(personalizedContent, 2) } });
  } catch (error) {
  console.error('Content personalization error:', error);
  res.status(500).json({ success: false, error: 'Failed to personalize content' });
  }
});

// Helper functions - AI implementations

async function convertNaturalLanguageToRules(prompt: string): Promise<any> {
  const lowercasePrompt = prompt.toLowerCase();
  
  const rules: any = {
    logic: 'AND',
    conditions: []
  };

  // Collect all numeric tokens with their positions so we can choose the
  // number that is nearest to the keyword we care about (e.g., 'spent' vs 'visit').
  const numberMatches = Array.from(lowercasePrompt.matchAll(/(\d+(?:\.\d+)?)/g)).map(m => ({
    raw: m[0],
    value: Number(m[1]),
    index: m.index ?? 0
  }));

  const findNearestNumber = (keywordVariants: string[]): { value: number; index: number } | null => {
    let best: { value: number; index: number; dist: number } | null = null;
    for (const kw of keywordVariants) {
      const ki = lowercasePrompt.indexOf(kw);
      if (ki === -1) continue;
      for (const nm of numberMatches) {
        const dist = Math.abs(nm.index - ki);
        if (!best || dist < best.dist) best = { value: nm.value, index: nm.index, dist };
      }
      // If we found a close number for this keyword, return it immediately
      if (best) return { value: best.value, index: best.index };
    }
    return null;
  }

  // We'll collect condition candidates with their index so we can order them and
  // determine connectors between them.
  const conditionCandidates: Array<{ field: string; operator: string; value: any; index: number }> = [];

  // Helper to push a condition if a numeric value found
  const pushNumericCondition = (field: string, keywordVariants: string[], defaultOp: string, preferGreaterKeywords: string[] = []) => {
    const nm = findNearestNumber(keywordVariants);
    if (nm !== null) {
      const ki = keywordVariants.map(k => lowercasePrompt.indexOf(k)).filter(i => i >= 0)[0] ?? 0;
      const start = Math.max(0, Math.min(ki, nm.index) - 20);
      const end = Math.min(lowercasePrompt.length, Math.max(ki, nm.index) + 20);
      const nearby = lowercasePrompt.substring(start, end);
        const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') || nearby.includes('under') ? '<' : defaultOp);
      conditionCandidates.push({ field, operator: op, value: nm.value, index: ki });
    }
  }

  // Spending
  if (lowercasePrompt.includes('spend') || lowercasePrompt.includes('spent') || lowercasePrompt.includes('spending')) {
    // Try direct regex like 'spent 200' or 'spent over 200'
    let matched = null
    const m1 = lowercasePrompt.match(/(?:spent|spending|spend)\D{0,20}?(\d+(?:\.\d+)?)/)
    if (m1) matched = { val: Number(m1[1]), idx: (m1.index ?? 0) + (m1[0].indexOf(m1[1]) >= 0 ? m1[0].indexOf(m1[1]) : 0) }
    // fallback: 'over 200' near a spend keyword
    if (!matched) {
      const m2 = lowercasePrompt.match(/over\s*(\d+(?:\.\d+)?)/)
      if (m2 && lowercasePrompt.includes('spend')) matched = { val: Number(m2[1]), idx: m2.index ?? 0 }
    }
    if (matched) {
        const start = Math.max(0, (matched.idx ?? 0) - 20)
        const end = Math.min(lowercasePrompt.length, (matched.idx ?? 0) + 20)
        const nearby = lowercasePrompt.substring(start, end)
        const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') || nearby.includes('under') ? '<' : '>=');
      conditionCandidates.push({ field: 'totalSpending', operator: op, value: matched.val, index: matched.idx })
    } else {
      pushNumericCondition('totalSpending', ['spent', 'spending', 'spend', 'over', 'more than'], '>=', ['over', 'more than']);
    }
  }

  // Visits
  if (lowercasePrompt.includes('visit') || lowercasePrompt.includes('visits') || lowercasePrompt.includes('times') || lowercasePrompt.includes('came')) {
    // Try regex matches like 'visited 3 times' or '3 times'
    let matched = null
    const m1 = lowercasePrompt.match(/visited\D{0,20}?(\d+(?:\.\d+)?)/)
    if (m1) matched = { val: Number(m1[1]), idx: m1.index ?? 0 }
    if (!matched) {
      const m2 = lowercasePrompt.match(/(\d+(?:\.\d+)?)\s*(?:times|visits)/)
      if (m2) matched = { val: Number(m2[1]), idx: m2.index ?? 0 }
    }
    if (matched) {
        const start = Math.max(0, (matched.idx ?? 0) - 20)
        const end = Math.min(lowercasePrompt.length, (matched.idx ?? 0) + 20)
        const nearby = lowercasePrompt.substring(start, end)
        const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') ? '<' : '>=');
      conditionCandidates.push({ field: 'visitCount', operator: op, value: matched.val, index: matched.idx })
    } else {
      pushNumericCondition('visitCount', ['visit', 'visits', 'times', 'time', 'came'], '>=' , ['more than', 'over']);
    }
  }

  // Time-based (last X months/days)
  if (lowercasePrompt.includes('month') || lowercasePrompt.includes('months') || lowercasePrompt.includes('day') || lowercasePrompt.includes('days') || lowercasePrompt.includes('last')) {
    const timeNumObj = findNearestNumber(['month', 'months', 'day', 'days', 'last']);
    if (timeNumObj !== null) {
      const timeNum = timeNumObj.value;
      const unitKeyword = ['month', 'months'].some(u => lowercasePrompt.includes(u)) ? 'month' : 'day';
      const ki = ['month', 'months', 'day', 'days', 'last'].map(k => lowercasePrompt.indexOf(k)).filter(i => i >= 0)[0] ?? 0;
      const days = unitKeyword === 'month' ? Math.round(timeNum) * 30 : Math.round(timeNum);
      // Use 'before' to indicate 'in the last X' semantics
      conditionCandidates.push({ field: 'lastVisit', operator: 'before', value: days, index: ki });
    }
  }

  // Generic "<word> count <op> <number>" patterns, like 'email count greater than 1' or 'orders count > 2'
  // We'll look for tokens like 'count' or 'number of' preceding or following a noun.
  const countPattern = /([a-zA-Z_]+) (?:count|counts|number of|no of) (?:greater than|more than|over|less than|under|>=|>|<=|<|=)?\s*(\d+(?:\.\d+)?)/g;
  for (const m of Array.from(lowercasePrompt.matchAll(countPattern))) {
    try {
      const noun = m[1];
      const num = Number(m[2]);
      if (!Number.isNaN(num)) {
        // field name convention: noun + 'Count'
        const fieldName = `${noun}Count`;
        const ki = m.index ?? 0;
        // determine operator from nearby text
        const surrounding = lowercasePrompt.substring(Math.max(0, ki - 20), ki + (m[0]?.length ?? 0) + 20);
        const op = (surrounding.includes('greater than') || surrounding.includes('more than') || surrounding.includes('over')) ? '>' : (surrounding.includes('less than') || surrounding.includes('under') ? '<' : '>=');
        conditionCandidates.push({ field: fieldName, operator: op, value: num, index: ki });
      }
    } catch (e) { /* ignore */ }
  }

  // Handle explicit 'between' ranges like 'between 10 and 20' near a field
  const betweenPattern = /([A-Za-z ]+?) between (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?)/g;
  for (const m of Array.from(lowercasePrompt.matchAll(betweenPattern))) {
    try {
      const phrase = m[1].trim();
      const low = Number(m[2]);
      const high = Number(m[3]);
      if (!Number.isNaN(low) && !Number.isNaN(high)) {
        // guess field by phrase (e.g., 'spent between 100 and 200')
        if (phrase.includes('spend') || phrase.includes('spent') || phrase.includes('spending')) {
          conditionCandidates.push({ field: 'totalSpending', operator: '>=', value: low, index: m.index ?? 0 });
          conditionCandidates.push({ field: 'totalSpending', operator: '<=', value: high, index: (m.index ?? 0) + 1 });
        } else if (phrase.includes('visit') || phrase.includes('visits') || phrase.includes('times')) {
          conditionCandidates.push({ field: 'visitCount', operator: '>=', value: low, index: m.index ?? 0 });
          conditionCandidates.push({ field: 'visitCount', operator: '<=', value: high, index: (m.index ?? 0) + 1 });
        }
      }
    } catch (e) { /* ignore */ }
  }

  // If we found multiple numeric conditions, sort them by the occurrence index
  conditionCandidates.sort((a, b) => a.index - b.index);

  // Build final conditions array
  for (const c of conditionCandidates) {
    rules.conditions.push({ field: c.field, operator: c.operator, value: c.value });
  }

  // Derive per-gap connectors by inspecting the text between condition keyword positions
  const connectors: ('AND' | 'OR')[] = [];
  if (conditionCandidates.length > 1) {
    for (let i = 0; i < conditionCandidates.length - 1; i++) {
      const aIdx = conditionCandidates[i].index + 0;
      const bIdx = conditionCandidates[i + 1].index;
      const between = lowercasePrompt.substring(aIdx, bIdx).trim();
      // prefer 'or' if exists, otherwise default to 'and'
      if (/\bor\b/.test(between)) connectors.push('OR');
      else connectors.push('AND');
    }
  }

  if (connectors.length > 0) rules.connectors = connectors;

  // If the user explicitly used ' or ' at top-level, set global logic to OR when no per-gap connectors
  if ((!rules.connectors || rules.connectors.length === 0) && /\bor\b/.test(lowercasePrompt) && !/\band\b/.test(lowercasePrompt)) {
    rules.logic = 'OR';
  } else {
    rules.logic = 'AND';
  }

  // Provider flags
  const enableProvider = process.env.ENABLE_PROVIDER_NL_TO_RULES === 'true';
  // Prefer provider-first when explicitly enabled or when a Gemini key exists locally
  const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
  const providerFirst = (process.env.PROVIDER_FIRST_NL_TO_RULES === 'true') || (enableProvider && Boolean(process.env.GEMINI_API_KEY));
  const providerName = process.env.GEMINI_API_KEY ? 'GEMINI' : (process.env.OPENAI_API_KEY ? 'OPENAI' : 'NONE');

  // Define a lightweight schema for provider responses
  const ConditionSchema = z.object({ field: z.string(), operator: z.string(), value: z.union([z.string(), z.number()]) });
  const RulesSchema = z.object({ logic: z.enum(['AND', 'OR']), conditions: z.array(ConditionSchema), connectors: z.array(z.enum(['AND', 'OR'])).optional() }).optional();

  // Provider-first mode: call provider first when enabled
  if (enableProvider && apiKey && providerFirst) {
    try {
      console.debug(`[nl-to-rules] Provider-first enabled; attempting provider (${providerName})`);
      const providerResp = await callProviderForRulesWithRetries(prompt, apiKey, 3);
      const parsed = RulesSchema.parse(providerResp);
      if (parsed && parsed.conditions && parsed.conditions.length > 0) {
        return { logic: parsed.logic, conditions: parsed.conditions, connectors: parsed.connectors, provider: providerName };
      }
    } catch (err) {
      console.warn('[nl-to-rules] Provider-first failed or returned invalid shape, falling back to local heuristics', err instanceof Error ? err.message : err);
    }
  }

  // If heuristics look weak (no conditions) and provider usage is enabled, try provider as fallback
  if ((!(rules.conditions && rules.conditions.length > 0) || (rules.conditions.length > 0 && rules.conditions.length < 2)) && enableProvider && apiKey) {
    try {
      console.debug(`[nl-to-rules] Local heuristics weak; attempting provider fallback (${providerName})`);
      const providerResp = await callProviderForRulesWithRetries(prompt, apiKey, 2);
      const parsed = RulesSchema.parse(providerResp);
      if (parsed && parsed.conditions && parsed.conditions.length > 0) {
        return { logic: parsed.logic, conditions: parsed.conditions, connectors: parsed.connectors, provider: providerName };
      }
    } catch (err) {
      console.warn('[nl-to-rules] Provider fallback failed or returned invalid shape, returning local heuristics', err instanceof Error ? err.message : err);
    }
  }

  // Attach null provider when using local heuristics
  return { ...rules, provider: null };
}

// Call external provider (Gemini/OpenAI) with prompt to produce structured rules JSON
async function extractJsonFromText(text: string): Promise<any> {
  if (!text || typeof text !== 'string') return null;
  // Try to find first JSON object/block in text
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.substring(firstBrace, lastBrace + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  // Try to find array root
  const firstArray = text.indexOf('[');
  const lastArray = text.lastIndexOf(']');
  if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
    const candidate = text.substring(firstArray, lastArray + 1);
    try { return JSON.parse(candidate); } catch {}
  }
  // Last resort: attempt to parse whole trimmed string
  try { return JSON.parse(text.trim()); } catch { return null }
}

async function callProviderApi(prompt: string, apiKey: string): Promise<string | null> {
  const systemPrompt = `You are a strict JSON generator. Convert the user's segmentation request into JSON only. DO NOT include any explanatory text. Respond only with JSON. Fields allowed: totalSpending, visitCount, lastVisit, email, emailCount. Operators allowed: >, <, >=, <=, =, contains, before, after. Output shape: { "logic": "AND"|"OR", "conditions": [{ "field": string, "operator": string, "value": string|number }], "connectors": ["AND"|"OR"] (optional) }`;
  const fullPrompt = `${systemPrompt}\n\nUser: ${prompt}`;

  const body = { prompt: fullPrompt, max_tokens: 512, temperature: 0 };

  if (process.env.GEMINI_API_URL && process.env.GEMINI_API_KEY) {
    try {
      const resp = await axios.post(process.env.GEMINI_API_URL!, { inputs: fullPrompt }, { headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey }, timeout: 20000 });
      const extracted = extractTextFromProviderResponse(resp.data) || (resp.data && JSON.stringify(resp.data));
      return String(extracted);
    } catch (err) {
      throw err;
    }
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      const url = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/completions';
      const resp = await axios.post(url, { model: process.env.OPENAI_MODEL || 'text-davinci-003', ...body }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
      const extracted = extractTextFromProviderResponse(resp.data) || (resp.data && JSON.stringify(resp.data));
      return String(extracted);
    } catch (err) {
      throw err;
    }
  }

  return null;
}

async function callProviderForRulesWithRetries(prompt: string, apiKey: string, attempts = 3): Promise<any> {
  let attempt = 0;
  let lastErr: any = null;
  while (attempt < attempts) {
    attempt++;
    try {
      const text = await callProviderApi(prompt, apiKey);
      if (!text) throw new Error('Empty provider response');
      const extracted = await extractJsonFromText(text);
      if (!extracted) throw new Error('Failed to parse JSON from provider response');
      return extracted;
    } catch (err) {
      lastErr = err;
      const backoff = Math.pow(2, attempt) * 200;
      await new Promise(res => setTimeout(res, backoff));
      continue;
    }
  }
  throw lastErr || new Error('Provider failed after retries');
}

function generateRulesExplanation(rules: any): string {
  const conditions = rules.conditions || [];
  if (conditions.length === 0) return 'No specific conditions identified';

  const explanations = conditions.map((condition: any) => {
    switch (condition.field) {
      case 'totalSpending':
        return `customers who have spent ${condition.operator} ₹${condition.value}`;
      case 'visitCount':
        return `customers with ${condition.operator} ${condition.value} visits`;
      case 'lastVisit':
        return `customers who last visited ${condition.operator} ${condition.value} days ago`;
      default:
        return `${condition.field} ${condition.operator} ${condition.value}`;
    }
  });

  const logic = rules.logic === 'OR' ? ' OR ' : ' AND ';
  return `Targeting ${explanations.join(logic)}`;
}

function getRandom(): number {
  if (process.env.DETERMINISTIC_RANDOM) return Number(process.env.DETERMINISTIC_RANDOM);
  return Math.random();
}

async function generateMessageSuggestions(objective: string, audience: any, tone: string): Promise<any[]> {
  // Mock message suggestions based on objective
  const templates = {
    'bring back inactive users': [
      "Hi {name}, we miss you! Here's 15% off your next order to welcome you back.",
      "Hey {name}, it's been a while! Check out what's new and save 20% today.",
      "{name}, your favorite items are back in stock. Plus, get 10% off your return!"
    ],
    'reward loyal customers': [
      "Hi {name}, thank you for being a valued customer! Enjoy 25% off as our VIP.",
      "Dear {name}, your loyalty means everything. Here's an exclusive 30% discount.",
      "{name}, you're part of our elite club! Get early access + 20% off."
    ],
    'promote new products': [
      "Hi {name}, discover our latest collection with an exclusive 15% launch discount.",
      "Hey {name}, be among the first to try our new products. Get 20% off!",
      "{name}, new arrivals are here! Preview them now with 10% off."
    ],
    'seasonal sale': [
      "Hi {name}, our seasonal sale is here! Save up to 40% on your favorites.",
      "Hey {name}, don't miss our limited-time seasonal offers - up to 50% off!",
      "{name}, season's best deals are live! Shop now and save big."
    ]
  };

  const suggestions = templates[objective.toLowerCase() as keyof typeof templates] || [
    "Hi {name}, we have something special for you!",
    "Hey {name}, check out our latest offers just for you.",
    "{name}, don't miss out on this exclusive deal!"
  ];

    return suggestions.map((message, index) => ({
      id: index + 1,
      message,
      tone,
      estimatedEngagement: getRandom() * 20 + 10, // 10-30%
      recommendation: index === 0 ? 'Best performing template' : 
                     index === 1 ? 'Higher personalization' : 'Simple and direct'
    }));
}

async function generateCampaignSummary(campaignId: string): Promise<string> {
  const summaries = [
    "Your campaign reached 1,284 users with a 94% delivery rate. Customers with spending over ₹10K had the highest engagement at 95%. The campaign generated an estimated ₹45,000 in potential revenue based on historical conversion rates.",
    "Excellent performance! 1,140 messages were successfully delivered to high-value customers. The VIP segment showed 97% delivery success, while the regular segment achieved 92%. Overall engagement exceeded industry benchmarks by 15%.",
    "Campaign delivered to 89% of target audience with strong performance in the premium customer segment. Customers who haven't shopped in 3 months showed 23% higher engagement than expected, suggesting good re-activation potential."
  ];

  return summaries[Math.floor(getRandom() * summaries.length)];
}

async function generateSchedulingSuggestions(campaignType: string, audience: any): Promise<any> {
  const suggestions = {
    bestTime: {
      hour: Math.floor(getRandom() * 6) + 14, // 2-8 PM
      minute: [0, 15, 30, 45][Math.floor(getRandom() * 4)]
    },
  bestDay: ['Tuesday', 'Wednesday', 'Thursday'][Math.floor(getRandom() * 3)],
    timezone: 'Local customer timezone',
    reasoning: "Based on your audience's activity patterns, this timing shows 35% higher engagement rates.",
    alternatives: [
      { day: 'Monday', time: '10:00 AM', expectedEngagement: '22%' },
      { day: 'Friday', time: '3:00 PM', expectedEngagement: '28%' },
      { day: 'Saturday', time: '11:00 AM', expectedEngagement: '31%' }
    ]
  };

  return suggestions;
}

async function generateLookalikeAudience(baseRules: any): Promise<any> {
  // Mock lookalike audience generation
  return {
    expandedRules: {
      ...baseRules,
      conditions: [
        ...baseRules.conditions,
        {
          field: 'totalSpending',
          operator: '>=',
          value: Math.floor(Math.random() * 5000) + 2000,
          reason: 'Similar spending behavior'
        }
      ]
    },
    estimatedSize: Math.floor(Math.random() * 500) + 200,
  similarity: Math.floor(getRandom() * 20) + 80, // 80-100%
    characteristics: [
      'Similar purchase frequency',
      'Comparable spending patterns',
      'Similar product preferences',
      'Matching engagement levels'
    ]
  };
}

async function generateCampaignTags(campaignData: any): Promise<string[]> {
  // Mock tag generation based on campaign data
  const allTags = [
    'Win-back', 'High Value Customers', 'New Customer Welcome', 
    'Seasonal Sale', 'Product Launch', 'VIP Treatment', 
    'Re-engagement', 'Loyalty Reward', 'Flash Sale', 'Premium Segment'
  ];

  // Return 2-4 relevant tags
  const numTags = Math.floor(Math.random() * 3) + 2;
  const shuffled = allTags.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, numTags);
}

function calculateTagConfidence(tags: string[], campaignData: any): number {
  // Mock confidence calculation
  return Math.floor(Math.random() * 20) + 80; // 80-100%
}

async function personalizeContent(template: string, customerData: any, tone: string): Promise<string> {
  // Mock content personalization
  let personalized = template
    .replace(/\{name\}/g, customerData.name || 'Valued Customer')
    .replace(/\{email\}/g, customerData.email || '')
    .replace(/\{spending\}/g, customerData.totalSpending?.toString() || '0');

  // Add tone-specific modifications
  if (tone === 'casual') {
    personalized = personalized.replace(/Hi /g, 'Hey ').replace(/Dear /g, 'Hi ');
  } else if (tone === 'formal') {
    personalized = personalized.replace(/Hey /g, 'Dear ').replace(/Hi /g, 'Dear ');
  }

  return personalized;
}

async function generateContentVariations(content: string, count: number): Promise<string[]> {
  // Mock content variations
  const variations = [];
  for (let i = 0; i < count; i++) {
    variations.push(content.replace(/!/g, '.').replace(/exciting/g, 'amazing'));
  }
  return variations;
}

export default router;

// Export helper for local testing and debugging
export { convertNaturalLanguageToRules };

// New: /generate endpoint - returns a single generated message for a campaign
router.post('/generate', [
  body('prompt').notEmpty().withMessage('Prompt is required')
], authenticateUser, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { prompt, tone = 'friendly', maxTokens = 256 } = req.body as { prompt: string; tone?: string; maxTokens?: number };

    // If Gemini/OpenAI-like credentials are provided, proxy the request
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    const model = process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || 'gemini-pro';

    if (apiKey) {
      try {
        // Using Google Gemini-compatible REST interface if available
        // Accepts either GOOGLE_GEMINI_API or fallback to OpenAI endpoint style
        if (process.env.GEMINI_API_URL) {
          // Google Generative Language API / Gemini expects a different payload and header
          const body = {
            // top-level contents array with parts -> text (matches example curl)
            contents: [
              {
                parts: [
                  {
                    text: prompt
                  }
                ]
              }
            ]
          }

          const resp = await axios.post(process.env.GEMINI_API_URL, body, {
            headers: {
              'Content-Type': 'application/json',
              // Google API key auth uses X-goog-api-key header for simple API key access
              'X-goog-api-key': apiKey
            },
            timeout: 20000
          });

          // Response formats vary; try several common fields used by generative APIs
          const data = resp?.data || {};
          const extracted = extractTextFromProviderResponse(data);
          const message = extracted ?? JSON.stringify(data);
          // Detect clarifying/ask-for-more-info messages via heuristic
          const lower = String(message).toLowerCase();
          const needsContext = (lower.includes('need') && lower.includes('information')) || lower.includes('tell me') || lower.includes('who is the message for') || lower.includes('what is the occasion');
          res.json({ success: true, data: { message: String(message), providerRaw: data, needsContext } });
          return;
        }

        // Fallback: try OpenAI-style completions endpoint if OPENAI_API_KEY is present
        if (process.env.OPENAI_API_URL || process.env.OPENAI_API_KEY) {
          const openaiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/completions';
          const resp = await axios.post(openaiUrl, {
            model,
            prompt,
            max_tokens: maxTokens,
            temperature: 0.7
          }, {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 20000
          });

          const data = resp?.data || {};
          const extracted = extractTextFromProviderResponse(data);
          const message = extracted ?? JSON.stringify(data);
          const lower = String(message).toLowerCase();
          const needsContext = (lower.includes('need') && lower.includes('information')) || lower.includes('tell me') || lower.includes('who is the message for') || lower.includes('what is the occasion');
          res.json({ success: true, data: { message: String(message), providerRaw: data, needsContext } });
          return;
        }
      } catch (err: unknown) {
        let msg = 'Unknown error';
        if (axios.isAxiosError(err)) {
          msg = JSON.stringify(err.response?.data || err.message || err.toString());
        } else if (err instanceof Error) {
          msg = err.message;
        }
        console.error('External AI provider error:', msg);
        // fall through to internal fallback
      }
    }

  // Fallback: use local mock generator for suggestions (no needsContext)
  const suggestions = await generateMessageSuggestions(prompt, { estimatedSize: 0 }, tone as string);
  const message = suggestions && suggestions.length > 0 ? suggestions[0].message : `Hello! ${prompt}`;
  res.json({ success: true, data: { message } });
  } catch (error) {
    console.error('AI generate error:', error);
    res.status(500).json({ success: false, error: 'Failed to generate message' });
  }
});
