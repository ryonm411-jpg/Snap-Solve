
async function test() {
    const payload = {
        model: 'deepseek-chat',
        messages: [
            { role: 'user', content: 'hello' }
        ]
    };
    const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer sk-invalid123`
        },
        body: JSON.stringify(payload)
    });
    console.log("Status:", response.status);
    console.log("Body:", await response.text());
}
test();
