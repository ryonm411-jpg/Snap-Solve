// Node 18+ has global fetch built-in

module.exports = async function githubProvider({ apiKey, messages, systemPrompt }) {
    const token = apiKey || process.env.GITHUB_TOKEN;
    
    if (!token || token === 'YOUR-GITHUB-TOKEN-GOES-HERE') {
        throw new Error('INVALID_KEY');
    }

    const payload = {
        model: 'gpt-4o',
        messages: [
            { role: 'system', content: systemPrompt },
            ...messages
        ]
    };

    const response = await fetch('https://models.github.ai/inference/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
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
