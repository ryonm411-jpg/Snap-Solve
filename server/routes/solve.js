const express = require('express');
const { invokeProvider } = require('../providers');

const router = express.Router();

const SOLVE_PROMPT = `You are an expert tutor.
Explain clearly and concisely.
Use clean Markdown formatting.
Use LaTeX for all math:
- Inline: $...$
- Block: $$...$$
Structure solutions step-by-step using **Step 1:**, **Step 2:**, etc.
End with **Final Answer:** section.
Use horizontal separators (---) between sections.
Avoid unnecessary verbosity.
Ensure output is clean, readable, and copy-paste ready.
Your output must render perfectly in KaTeX.`;

router.post('/', async (req, res, next) => {
    try {
        const { question, image, provider = 'github', apiKey = '' } = req.body;

        if (!question && !image) {
            return res.status(400).json({ error: 'Either question or image must be provided' });
        }

        const content = [];

        if (question) {
            content.push({
                type: 'text',
                text: `Here is the problem:\n${question}`
            });
        }

        if (image) {
            content.push({
                type: 'image_url',
                image_url: { url: image }
            });
        }

        const messages = [
            {
                role: 'user',
                content
            }
        ];

        const solution = await invokeProvider({
            provider,
            apiKey,
            messages,
            systemPrompt: SOLVE_PROMPT
        });

        res.json({ solution });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
