const github = require('./github');
const openai = require('./openai');
const claude = require('./claude');
const gemini = require('./gemini');

/**
 * Dispatcher to route requests to the correct provider
 * @param {Object} params
 * @param {string} params.provider - 'github' | 'openai' | 'claude' | 'gemini'
 * @param {string} params.apiKey - The API key
 * @param {Array} params.messages - The messages array (can include image data URLs)
 * @param {string} params.systemPrompt - The system prompt
 * @returns {Promise<string>} The plain text response
 */
async function invokeProvider({ provider, apiKey, messages, systemPrompt }) {
    switch (provider) {
        case 'github':
            return await github({ apiKey, messages, systemPrompt });
        case 'openai':
            return await openai({ apiKey, messages, systemPrompt });
        case 'claude':
            return await claude({ apiKey, messages, systemPrompt });
        case 'gemini':
            return await gemini({ apiKey, messages, systemPrompt });
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}

module.exports = { invokeProvider };
