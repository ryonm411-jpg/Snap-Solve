const fetch = require('node-fetch');

module.exports = async function geminiProvider({ apiKey, messages, systemPrompt }) {
    if (!apiKey) throw new Error('INVALID_KEY');

    // Convert OpenAI-style messages to Gemini style
    const geminiContents = messages.map(msg => {
        if (typeof msg.content === 'string') {
            return { role: msg.role === 'user' ? 'user' : 'model', parts: [{ text: msg.content }] };
        }
        
        // Handle array of parts (text / image_url)
        const parts = msg.content.map(part => {
            if (part.type === 'text') {
                return { text: part.text };
            }
            if (part.type === 'image_url') {
                const match = part.image_url.url.match(/^data:(image\/[^;]+);base64,(.+)$/);
                if (match) {
                    return {
                        inline_data: {
                            mime_type: match[1],
                            data: match[2]
                        }
                    };
                }
            }
            return part;
        });
        
        return { role: msg.role === 'user' ? 'user' : 'model', parts };
    });

    const payload = {
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: geminiContents
    };

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (response.status === 400 && !response.ok) {
        // Sometimes invalid keys return 400 for gemini, check status text
    }
    if (response.status === 401 || response.status === 403) throw new Error('INVALID_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status >= 500) throw new Error('PROVIDER_ERROR');
    if (!response.ok) throw new Error('PROVIDER_ERROR');

    try {
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
    } catch (err) {
        throw new Error('PARSE_ERROR');
    }
};
