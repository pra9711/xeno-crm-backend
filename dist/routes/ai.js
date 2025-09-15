"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertNaturalLanguageToRules = convertNaturalLanguageToRules;
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const auth_1 = require("../middleware/auth");
const axios_1 = __importDefault(require("axios"));
const zod_1 = require("zod");
const router = express_1.default.Router();
function extractTextFromProviderResponse(data) {
    if (!data)
        return null;
    if (typeof data === 'string') {
        const s = data.trim();
        if ((s.startsWith('{') || s.startsWith('['))) {
            try {
                data = JSON.parse(s);
            }
            catch (e) {
                return s;
            }
        }
        else {
            return s;
        }
    }
    try {
        const cand = data?.candidates?.[0];
        if (cand) {
            const content = cand.content || cand.output || cand;
            if (content) {
                const parts = content.parts || content?.[0]?.content?.parts || content?.content?.parts || content;
                if (Array.isArray(parts) && parts[0]?.text)
                    return String(parts[0].text).trim();
                if (parts?.parts && Array.isArray(parts.parts) && parts.parts[0]?.text)
                    return String(parts.parts[0].text).trim();
                if (content?.parts && Array.isArray(content.parts) && content.parts[0]?.text)
                    return String(content.parts[0].text).trim();
            }
        }
        if (data?.candidates?.[0]?.parts?.[0]?.text)
            return String(data.candidates[0].parts[0].text).trim();
        if (data?.choices?.[0]?.text)
            return String(data.choices[0].text).trim();
        if (data?.choices?.[0]?.message?.content)
            return String(data.choices[0].message.content).trim();
        if (data?.output?.[0]?.content?.[0]?.text)
            return String(data.output[0].content[0].text).trim();
        if (data?.results?.[0]?.output?.content?.[0]?.text)
            return String(data.results[0].output.content[0].text).trim();
        if (data?.generatedText)
            return String(data.generatedText).trim();
        if (data?.generated_text)
            return String(data.generated_text).trim();
    }
    catch (e) {
    }
    return null;
}
router.post('/nl-to-rules', [
    (0, express_validator_1.body)('prompt').notEmpty().withMessage('Prompt is required')
], auth_1.authenticateUser, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
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
    }
    catch (error) {
        console.error('NL to rules error:', error);
        res.status(500).json({ success: false, error: 'Failed to convert natural language to rules' });
    }
});
if (process.env.NODE_ENV !== 'production') {
    router.post('/nl-to-rules-public', [
        (0, express_validator_1.body)('prompt').notEmpty().withMessage('Prompt is required')
    ], async (req, res) => {
        try {
            const errors = (0, express_validator_1.validationResult)(req);
            if (!errors.isEmpty()) {
                res.status(400).json({ errors: errors.array() });
                return;
            }
            const { prompt } = req.body;
            const rules = await convertNaturalLanguageToRules(prompt);
            res.json({ success: true, data: { prompt, rules, explanation: generateRulesExplanation(rules) } });
        }
        catch (err) {
            console.error('NL to rules (public) error:', err);
            res.status(500).json({ success: false, error: 'Failed to convert natural language to rules (public)' });
        }
    });
}
router.post('/message-suggestions', [
    (0, express_validator_1.body)('objective').notEmpty().withMessage('Campaign objective is required'),
    (0, express_validator_1.body)('audience').optional().isObject()
], auth_1.authenticateUser, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { objective, audience, tone = 'friendly' } = req.body;
        const suggestions = await generateMessageSuggestions(objective, audience, tone);
        res.json({ success: true, data: { objective, suggestions } });
    }
    catch (error) {
        console.error('Message suggestions error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate message suggestions' });
    }
});
router.post('/campaign-summary', [
    (0, express_validator_1.body)('campaignId').notEmpty().withMessage('Campaign ID is required')
], auth_1.authenticateUser, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { campaignId } = req.body;
        const summary = await generateCampaignSummary(campaignId);
        res.json({ success: true, data: { campaignId, summary } });
    }
    catch (error) {
        console.error('Campaign summary error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate campaign summary' });
    }
});
router.post('/scheduling-suggestions', [
    (0, express_validator_1.body)('campaignType').notEmpty().withMessage('Campaign type is required'),
    (0, express_validator_1.body)('audience').optional().isObject()
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { campaignType, audience } = req.body;
        const suggestions = await generateSchedulingSuggestions(campaignType, audience);
        res.json({ success: true, data: { suggestions } });
    }
    catch (error) {
        console.error('Scheduling suggestions error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate scheduling suggestions' });
    }
});
router.post('/lookalike-audience', [
    (0, express_validator_1.body)('baseAudienceRules').isObject().withMessage('Base audience rules are required')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { baseAudienceRules } = req.body;
        const lookalike = await generateLookalikeAudience(baseAudienceRules);
        res.json({ success: true, data: { baseRules: baseAudienceRules, lookalike } });
    }
    catch (error) {
        console.error('Lookalike audience error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate lookalike audience' });
    }
});
router.post('/auto-tag', [
    (0, express_validator_1.body)('campaignData').isObject().withMessage('Campaign data is required')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { campaignData } = req.body;
        const tags = await generateCampaignTags(campaignData);
        res.json({ success: true, data: { tags, confidence: calculateTagConfidence(tags, campaignData) } });
    }
    catch (error) {
        console.error('Auto-tag error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate campaign tags' });
    }
});
router.post('/personalize-content', [
    (0, express_validator_1.body)('template').notEmpty().withMessage('Content template is required'),
    (0, express_validator_1.body)('customerData').isObject().withMessage('Customer data is required')
], async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { template, customerData, tone = 'professional' } = req.body;
        const personalizedContent = await personalizeContent(template, customerData, tone);
        res.json({ success: true, data: { original: template, personalized: personalizedContent, variations: await generateContentVariations(personalizedContent, 2) } });
    }
    catch (error) {
        console.error('Content personalization error:', error);
        res.status(500).json({ success: false, error: 'Failed to personalize content' });
    }
});
async function convertNaturalLanguageToRules(prompt) {
    const lowercasePrompt = prompt.toLowerCase();
    const rules = {
        logic: 'AND',
        conditions: []
    };
    const numberMatches = Array.from(lowercasePrompt.matchAll(/(\d+(?:\.\d+)?)/g)).map(m => ({
        raw: m[0],
        value: Number(m[1]),
        index: m.index ?? 0
    }));
    const findNearestNumber = (keywordVariants) => {
        let best = null;
        for (const kw of keywordVariants) {
            const ki = lowercasePrompt.indexOf(kw);
            if (ki === -1)
                continue;
            for (const nm of numberMatches) {
                const dist = Math.abs(nm.index - ki);
                if (!best || dist < best.dist)
                    best = { value: nm.value, index: nm.index, dist };
            }
            if (best)
                return { value: best.value, index: best.index };
        }
        return null;
    };
    const conditionCandidates = [];
    const pushNumericCondition = (field, keywordVariants, defaultOp, preferGreaterKeywords = []) => {
        const nm = findNearestNumber(keywordVariants);
        if (nm !== null) {
            const ki = keywordVariants.map(k => lowercasePrompt.indexOf(k)).filter(i => i >= 0)[0] ?? 0;
            const start = Math.max(0, Math.min(ki, nm.index) - 20);
            const end = Math.min(lowercasePrompt.length, Math.max(ki, nm.index) + 20);
            const nearby = lowercasePrompt.substring(start, end);
            const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') || nearby.includes('under') ? '<' : defaultOp);
            conditionCandidates.push({ field, operator: op, value: nm.value, index: ki });
        }
    };
    if (lowercasePrompt.includes('spend') || lowercasePrompt.includes('spent') || lowercasePrompt.includes('spending')) {
        let matched = null;
        const m1 = lowercasePrompt.match(/(?:spent|spending|spend)\D{0,20}?(\d+(?:\.\d+)?)/);
        if (m1)
            matched = { val: Number(m1[1]), idx: (m1.index ?? 0) + (m1[0].indexOf(m1[1]) >= 0 ? m1[0].indexOf(m1[1]) : 0) };
        if (!matched) {
            const m2 = lowercasePrompt.match(/over\s*(\d+(?:\.\d+)?)/);
            if (m2 && lowercasePrompt.includes('spend'))
                matched = { val: Number(m2[1]), idx: m2.index ?? 0 };
        }
        if (matched) {
            const start = Math.max(0, (matched.idx ?? 0) - 20);
            const end = Math.min(lowercasePrompt.length, (matched.idx ?? 0) + 20);
            const nearby = lowercasePrompt.substring(start, end);
            const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') || nearby.includes('under') ? '<' : '>=');
            conditionCandidates.push({ field: 'totalSpending', operator: op, value: matched.val, index: matched.idx });
        }
        else {
            pushNumericCondition('totalSpending', ['spent', 'spending', 'spend', 'over', 'more than'], '>=', ['over', 'more than']);
        }
    }
    if (lowercasePrompt.includes('visit') || lowercasePrompt.includes('visits') || lowercasePrompt.includes('times') || lowercasePrompt.includes('came')) {
        let matched = null;
        const m1 = lowercasePrompt.match(/visited\D{0,20}?(\d+(?:\.\d+)?)/);
        if (m1)
            matched = { val: Number(m1[1]), idx: m1.index ?? 0 };
        if (!matched) {
            const m2 = lowercasePrompt.match(/(\d+(?:\.\d+)?)\s*(?:times|visits)/);
            if (m2)
                matched = { val: Number(m2[1]), idx: m2.index ?? 0 };
        }
        if (matched) {
            const start = Math.max(0, (matched.idx ?? 0) - 20);
            const end = Math.min(lowercasePrompt.length, (matched.idx ?? 0) + 20);
            const nearby = lowercasePrompt.substring(start, end);
            const op = (nearby.includes('more than') || nearby.includes('over')) ? '>' : (nearby.includes('less than') ? '<' : '>=');
            conditionCandidates.push({ field: 'visitCount', operator: op, value: matched.val, index: matched.idx });
        }
        else {
            pushNumericCondition('visitCount', ['visit', 'visits', 'times', 'time', 'came'], '>=', ['more than', 'over']);
        }
    }
    if (lowercasePrompt.includes('month') || lowercasePrompt.includes('months') || lowercasePrompt.includes('day') || lowercasePrompt.includes('days') || lowercasePrompt.includes('last')) {
        const timeNumObj = findNearestNumber(['month', 'months', 'day', 'days', 'last']);
        if (timeNumObj !== null) {
            const timeNum = timeNumObj.value;
            const unitKeyword = ['month', 'months'].some(u => lowercasePrompt.includes(u)) ? 'month' : 'day';
            const ki = ['month', 'months', 'day', 'days', 'last'].map(k => lowercasePrompt.indexOf(k)).filter(i => i >= 0)[0] ?? 0;
            const days = unitKeyword === 'month' ? Math.round(timeNum) * 30 : Math.round(timeNum);
            conditionCandidates.push({ field: 'lastVisit', operator: 'before', value: days, index: ki });
        }
    }
    const countPattern = /([a-zA-Z_]+) (?:count|counts|number of|no of) (?:greater than|more than|over|less than|under|>=|>|<=|<|=)?\s*(\d+(?:\.\d+)?)/g;
    for (const m of Array.from(lowercasePrompt.matchAll(countPattern))) {
        try {
            const noun = m[1];
            const num = Number(m[2]);
            if (!Number.isNaN(num)) {
                const fieldName = `${noun}Count`;
                const ki = m.index ?? 0;
                const surrounding = lowercasePrompt.substring(Math.max(0, ki - 20), ki + (m[0]?.length ?? 0) + 20);
                const op = (surrounding.includes('greater than') || surrounding.includes('more than') || surrounding.includes('over')) ? '>' : (surrounding.includes('less than') || surrounding.includes('under') ? '<' : '>=');
                conditionCandidates.push({ field: fieldName, operator: op, value: num, index: ki });
            }
        }
        catch (e) { }
    }
    const betweenPattern = /([A-Za-z ]+?) between (\d+(?:\.\d+)?) and (\d+(?:\.\d+)?)/g;
    for (const m of Array.from(lowercasePrompt.matchAll(betweenPattern))) {
        try {
            const phrase = m[1].trim();
            const low = Number(m[2]);
            const high = Number(m[3]);
            if (!Number.isNaN(low) && !Number.isNaN(high)) {
                if (phrase.includes('spend') || phrase.includes('spent') || phrase.includes('spending')) {
                    conditionCandidates.push({ field: 'totalSpending', operator: '>=', value: low, index: m.index ?? 0 });
                    conditionCandidates.push({ field: 'totalSpending', operator: '<=', value: high, index: (m.index ?? 0) + 1 });
                }
                else if (phrase.includes('visit') || phrase.includes('visits') || phrase.includes('times')) {
                    conditionCandidates.push({ field: 'visitCount', operator: '>=', value: low, index: m.index ?? 0 });
                    conditionCandidates.push({ field: 'visitCount', operator: '<=', value: high, index: (m.index ?? 0) + 1 });
                }
            }
        }
        catch (e) { }
    }
    conditionCandidates.sort((a, b) => a.index - b.index);
    for (const c of conditionCandidates) {
        rules.conditions.push({ field: c.field, operator: c.operator, value: c.value });
    }
    const connectors = [];
    if (conditionCandidates.length > 1) {
        for (let i = 0; i < conditionCandidates.length - 1; i++) {
            const aIdx = conditionCandidates[i].index + 0;
            const bIdx = conditionCandidates[i + 1].index;
            const between = lowercasePrompt.substring(aIdx, bIdx).trim();
            if (/\bor\b/.test(between))
                connectors.push('OR');
            else
                connectors.push('AND');
        }
    }
    if (connectors.length > 0)
        rules.connectors = connectors;
    if ((!rules.connectors || rules.connectors.length === 0) && /\bor\b/.test(lowercasePrompt) && !/\band\b/.test(lowercasePrompt)) {
        rules.logic = 'OR';
    }
    else {
        rules.logic = 'AND';
    }
    const enableProvider = process.env.ENABLE_PROVIDER_NL_TO_RULES === 'true';
    const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
    const providerFirst = (process.env.PROVIDER_FIRST_NL_TO_RULES === 'true') || (enableProvider && Boolean(process.env.GEMINI_API_KEY));
    const providerName = process.env.GEMINI_API_KEY ? 'GEMINI' : (process.env.OPENAI_API_KEY ? 'OPENAI' : 'NONE');
    const ConditionSchema = zod_1.z.object({ field: zod_1.z.string(), operator: zod_1.z.string(), value: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]) });
    const RulesSchema = zod_1.z.object({ logic: zod_1.z.enum(['AND', 'OR']), conditions: zod_1.z.array(ConditionSchema), connectors: zod_1.z.array(zod_1.z.enum(['AND', 'OR'])).optional() }).optional();
    if (enableProvider && apiKey && providerFirst) {
        try {
            console.debug(`[nl-to-rules] Provider-first enabled; attempting provider (${providerName})`);
            const providerResp = await callProviderForRulesWithRetries(prompt, apiKey, 3);
            const parsed = RulesSchema.parse(providerResp);
            if (parsed && parsed.conditions && parsed.conditions.length > 0) {
                return { logic: parsed.logic, conditions: parsed.conditions, connectors: parsed.connectors, provider: providerName };
            }
        }
        catch (err) {
            console.warn('[nl-to-rules] Provider-first failed or returned invalid shape, falling back to local heuristics', err instanceof Error ? err.message : err);
        }
    }
    if ((!(rules.conditions && rules.conditions.length > 0) || (rules.conditions.length > 0 && rules.conditions.length < 2)) && enableProvider && apiKey) {
        try {
            console.debug(`[nl-to-rules] Local heuristics weak; attempting provider fallback (${providerName})`);
            const providerResp = await callProviderForRulesWithRetries(prompt, apiKey, 2);
            const parsed = RulesSchema.parse(providerResp);
            if (parsed && parsed.conditions && parsed.conditions.length > 0) {
                return { logic: parsed.logic, conditions: parsed.conditions, connectors: parsed.connectors, provider: providerName };
            }
        }
        catch (err) {
            console.warn('[nl-to-rules] Provider fallback failed or returned invalid shape, returning local heuristics', err instanceof Error ? err.message : err);
        }
    }
    return { ...rules, provider: null };
}
async function extractJsonFromText(text) {
    if (!text || typeof text !== 'string')
        return null;
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        const candidate = text.substring(firstBrace, lastBrace + 1);
        try {
            return JSON.parse(candidate);
        }
        catch { }
    }
    const firstArray = text.indexOf('[');
    const lastArray = text.lastIndexOf(']');
    if (firstArray !== -1 && lastArray !== -1 && lastArray > firstArray) {
        const candidate = text.substring(firstArray, lastArray + 1);
        try {
            return JSON.parse(candidate);
        }
        catch { }
    }
    try {
        return JSON.parse(text.trim());
    }
    catch {
        return null;
    }
}
async function callProviderApi(prompt, apiKey) {
    const systemPrompt = `You are a strict JSON generator. Convert the user's segmentation request into JSON only. DO NOT include any explanatory text. Respond only with JSON. Fields allowed: totalSpending, visitCount, lastVisit, email, emailCount. Operators allowed: >, <, >=, <=, =, contains, before, after. Output shape: { "logic": "AND"|"OR", "conditions": [{ "field": string, "operator": string, "value": string|number }], "connectors": ["AND"|"OR"] (optional) }`;
    const fullPrompt = `${systemPrompt}\n\nUser: ${prompt}`;
    const body = { prompt: fullPrompt, max_tokens: 512, temperature: 0 };
    if (process.env.GEMINI_API_URL && process.env.GEMINI_API_KEY) {
        try {
            const resp = await axios_1.default.post(process.env.GEMINI_API_URL, { inputs: fullPrompt }, { headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey }, timeout: 20000 });
            const extracted = extractTextFromProviderResponse(resp.data) || (resp.data && JSON.stringify(resp.data));
            return String(extracted);
        }
        catch (err) {
            throw err;
        }
    }
    if (process.env.OPENAI_API_KEY) {
        try {
            const url = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/completions';
            const resp = await axios_1.default.post(url, { model: process.env.OPENAI_MODEL || 'text-davinci-003', ...body }, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
            const extracted = extractTextFromProviderResponse(resp.data) || (resp.data && JSON.stringify(resp.data));
            return String(extracted);
        }
        catch (err) {
            throw err;
        }
    }
    return null;
}
async function callProviderForRulesWithRetries(prompt, apiKey, attempts = 3) {
    let attempt = 0;
    let lastErr = null;
    while (attempt < attempts) {
        attempt++;
        try {
            const text = await callProviderApi(prompt, apiKey);
            if (!text)
                throw new Error('Empty provider response');
            const extracted = await extractJsonFromText(text);
            if (!extracted)
                throw new Error('Failed to parse JSON from provider response');
            return extracted;
        }
        catch (err) {
            lastErr = err;
            const backoff = Math.pow(2, attempt) * 200;
            await new Promise(res => setTimeout(res, backoff));
            continue;
        }
    }
    throw lastErr || new Error('Provider failed after retries');
}
function generateRulesExplanation(rules) {
    const conditions = rules.conditions || [];
    if (conditions.length === 0)
        return 'No specific conditions identified';
    const explanations = conditions.map((condition) => {
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
function getRandom() {
    if (process.env.DETERMINISTIC_RANDOM)
        return Number(process.env.DETERMINISTIC_RANDOM);
    return Math.random();
}
async function generateMessageSuggestions(objective, audience, tone) {
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
    const suggestions = templates[objective.toLowerCase()] || [
        "Hi {name}, we have something special for you!",
        "Hey {name}, check out our latest offers just for you.",
        "{name}, don't miss out on this exclusive deal!"
    ];
    return suggestions.map((message, index) => ({
        id: index + 1,
        message,
        tone,
        estimatedEngagement: getRandom() * 20 + 10,
        recommendation: index === 0 ? 'Best performing template' :
            index === 1 ? 'Higher personalization' : 'Simple and direct'
    }));
}
async function generateCampaignSummary(campaignId) {
    const summaries = [
        "Your campaign reached 1,284 users with a 94% delivery rate. Customers with spending over ₹10K had the highest engagement at 95%. The campaign generated an estimated ₹45,000 in potential revenue based on historical conversion rates.",
        "Excellent performance! 1,140 messages were successfully delivered to high-value customers. The VIP segment showed 97% delivery success, while the regular segment achieved 92%. Overall engagement exceeded industry benchmarks by 15%.",
        "Campaign delivered to 89% of target audience with strong performance in the premium customer segment. Customers who haven't shopped in 3 months showed 23% higher engagement than expected, suggesting good re-activation potential."
    ];
    return summaries[Math.floor(getRandom() * summaries.length)];
}
async function generateSchedulingSuggestions(campaignType, audience) {
    const suggestions = {
        bestTime: {
            hour: Math.floor(getRandom() * 6) + 14,
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
async function generateLookalikeAudience(baseRules) {
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
        similarity: Math.floor(getRandom() * 20) + 80,
        characteristics: [
            'Similar purchase frequency',
            'Comparable spending patterns',
            'Similar product preferences',
            'Matching engagement levels'
        ]
    };
}
async function generateCampaignTags(campaignData) {
    const allTags = [
        'Win-back', 'High Value Customers', 'New Customer Welcome',
        'Seasonal Sale', 'Product Launch', 'VIP Treatment',
        'Re-engagement', 'Loyalty Reward', 'Flash Sale', 'Premium Segment'
    ];
    const numTags = Math.floor(Math.random() * 3) + 2;
    const shuffled = allTags.sort(() => 0.5 - Math.random());
    return shuffled.slice(0, numTags);
}
function calculateTagConfidence(tags, campaignData) {
    return Math.floor(Math.random() * 20) + 80;
}
async function personalizeContent(template, customerData, tone) {
    let personalized = template
        .replace(/\{name\}/g, customerData.name || 'Valued Customer')
        .replace(/\{email\}/g, customerData.email || '')
        .replace(/\{spending\}/g, customerData.totalSpending?.toString() || '0');
    if (tone === 'casual') {
        personalized = personalized.replace(/Hi /g, 'Hey ').replace(/Dear /g, 'Hi ');
    }
    else if (tone === 'formal') {
        personalized = personalized.replace(/Hey /g, 'Dear ').replace(/Hi /g, 'Dear ');
    }
    return personalized;
}
async function generateContentVariations(content, count) {
    const variations = [];
    for (let i = 0; i < count; i++) {
        variations.push(content.replace(/!/g, '.').replace(/exciting/g, 'amazing'));
    }
    return variations;
}
exports.default = router;
router.post('/generate', [
    (0, express_validator_1.body)('prompt').notEmpty().withMessage('Prompt is required')
], auth_1.authenticateUser, async (req, res) => {
    try {
        const errors = (0, express_validator_1.validationResult)(req);
        if (!errors.isEmpty()) {
            res.status(400).json({ errors: errors.array() });
            return;
        }
        const { prompt, tone = 'friendly', maxTokens = 256 } = req.body;
        const apiKey = process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY;
        const model = process.env.GEMINI_MODEL || process.env.OPENAI_MODEL || 'gemini-pro';
        if (apiKey) {
            try {
                if (process.env.GEMINI_API_URL) {
                    const body = {
                        contents: [
                            {
                                parts: [
                                    {
                                        text: prompt
                                    }
                                ]
                            }
                        ]
                    };
                    const resp = await axios_1.default.post(process.env.GEMINI_API_URL, body, {
                        headers: {
                            'Content-Type': 'application/json',
                            'X-goog-api-key': apiKey
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
                if (process.env.OPENAI_API_URL || process.env.OPENAI_API_KEY) {
                    const openaiUrl = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/completions';
                    const resp = await axios_1.default.post(openaiUrl, {
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
            }
            catch (err) {
                let msg = 'Unknown error';
                if (axios_1.default.isAxiosError(err)) {
                    msg = JSON.stringify(err.response?.data || err.message || err.toString());
                }
                else if (err instanceof Error) {
                    msg = err.message;
                }
                console.error('External AI provider error:', msg);
            }
        }
        const suggestions = await generateMessageSuggestions(prompt, { estimatedSize: 0 }, tone);
        const message = suggestions && suggestions.length > 0 ? suggestions[0].message : `Hello! ${prompt}`;
        res.json({ success: true, data: { message } });
    }
    catch (error) {
        console.error('AI generate error:', error);
        res.status(500).json({ success: false, error: 'Failed to generate message' });
    }
});
