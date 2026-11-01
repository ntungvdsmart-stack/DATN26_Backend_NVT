const { SYSTEM_INSTRUCTION, buildChatbotInput } = require('./chatbotPrompt');
const { createHash } = require('node:crypto');
const cooldowns = new Map();
function getApiKeys() {
    const numbered = Object.keys(process.env).filter(name => /^GEMINI_API_KEY_\d+$/.test(name)).sort((a, b) => Number(a.split('_').at(-1)) - Number(b.split('_').at(-1)));
    return [...new Set([process.env.GEMINI_API_KEY, ...numbered.map(name => process.env[name]), ...(process.env.GEMINI_API_KEYS || '').split(/[,;\n]/)].map(key => String(key || '').trim()).filter(key => key && !/your_|placeholder|paste_/i.test(key)))];
}
function cooling(id) { return (cooldowns.get(id) || 0) > Date.now(); }
function pause(id, ms) { cooldowns.set(id, Date.now() + ms); }

const failure = (status, code) => Object.assign(new Error('AI provider unavailable'), { status, code });
async function generateAdvice(input) {
    const models = [...new Set([process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'])];
    const keys = getApiKeys();
    if (!keys.length) throw failure(503, 'NO_API_KEY');
    for (const [id, until] of cooldowns) if (until <= Date.now()) cooldowns.delete(id);
    const deadline = Date.now() + 25000;
    let attempts = 0;
    const body = JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: buildChatbotInput(input) }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 }
    });
    let lastError;
    for (const model of models) {
        for (const key of keys) {
            const keyId = createHash('sha256').update(key).digest('hex');
            const pairId = `${keyId}:${model}`;
            if (cooling(keyId) || cooling(pairId)) continue;
            const remaining = deadline - Date.now();
            if (remaining < 1000 || attempts >= 6) break;
            attempts += 1;
            try {
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
                    method: 'POST', signal: AbortSignal.timeout(Math.min(7000, remaining)),
                    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    lastError = failure(response.status, data.error?.status || 'PROVIDER_ERROR');
                    const invalidKey = data.error?.details?.some(detail => ['API_KEY_INVALID', 'API_KEY_EXPIRED'].includes(detail.reason));
                    if ([401, 403].includes(response.status) || invalidKey) {
                        pause(keyId, 300000);
                        continue;
                    }
                    if ([404, 429].includes(response.status)) {
                        const retry = data.error?.details?.find(item => item.retryDelay)?.retryDelay;
                        const seconds = /^\d+(?:\.\d+)?s$/.test(retry || '') ? Number(retry.slice(0, -1)) : 60;
                        pause(pairId, response.status === 404 ? 300000 : Math.min(3600, Math.max(60, seconds)) * 1000);
                        continue;
                    }
                    if (response.status < 500) throw lastError;
                    pause(pairId, 10000);
                } else {
                    const candidate = data.candidates?.[0];
                    const text = candidate?.content?.parts?.filter(part => !part.thought).map(part => part.text || '').join('').trim();
                    if (text) return text;
                    if (data.promptFeedback?.blockReason || ['SAFETY', 'PROHIBITED_CONTENT'].includes(candidate?.finishReason)) throw failure(422, 'CONTENT_BLOCKED');
                    lastError = failure(502, 'EMPTY_RESPONSE');
                }
            } catch (error) {
                if (error.status && error.status < 500) throw error;
                lastError = error.status ? error : failure(503, error.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR');
                pause(pairId, 10000);
            }
        }
    }
    throw lastError || failure(429, 'MODEL_COOLDOWN');
}
module.exports = { generateAdvice, hasApiKeys: () => getApiKeys().length > 0 };
