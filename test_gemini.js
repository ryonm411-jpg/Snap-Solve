

async function test() {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=•••••••••••••••••••••••••••••••••••••••`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{role: "user", parts: [{text: "hello"}]}]
        })
    });
    console.log("Status:", response.status);
    console.log("Body:", await response.text());
}
test();
