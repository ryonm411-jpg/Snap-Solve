// Node 18+ has global fetch built-in

module.exports = async function claudeProvider({ apiKey, messages, systemPrompt }) {
    if (!apiKey) throw new Error('INVALID_KEY');

    // Convert OpenAI-style messages to Anthropic style if needed
    // Usually Anthropic wants { role: 'user', content: [...] } where content is an array
    const anthropicMessages = messages.map(msg => {
        if (typeof msg.content === 'string') {
            return { role: msg.role, content: msg.content };
        }
        
        // Handle array of parts (text / image_url)
        const parts = msg.content.map(part => {
            if (part.type === 'text') {
                return { type: 'text', text: part.text };
            }
            if (part.type === 'image_url') {
                // Parse base64 URL
                const match = part.image_url.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
                if (match) {
                    return {
                        type: 'image',
                        source: {
                            type: 'base64',
                            media_type: match[1],
                            data: match[2]
                        }
                    };
                }
            }
            return part;
        });
        
        return { role: msg.role, content: parts };
    });

    const payload = {
        model: 'claude-3-5-sonnet-20240620',
        max_tokens: 4096,
        system: systemPrompt,
        messages: anthropicMessages
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 401 || response.status === 403) throw new Error('INVALID_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status >= 500) throw new Error('PROVIDER_ERROR');
    if (!response.ok) throw new Error('PROVIDER_ERROR');

    try {
        const data = await response.json();
        return data.content[0].text;
    } catch (err) {
        throw new Error('PARSE_ERROR');
    }
};
