const fetch = require('node-fetch');

module.exports = async function openaiProvider({ apiKey, messages, systemPrompt }) {
    if (!apiKey) throw new Error('INVALID_KEY');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ]
    };

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 401 || response.status === 403) throw new Error('INVALID_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status >= 500) throw new Error('PROVIDER_ERROR');
    if (!response.ok) throw new Error('PROVIDER_ERROR');

    try {
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (err) {
        throw new Error('PARSE_ERROR');
    }
};
