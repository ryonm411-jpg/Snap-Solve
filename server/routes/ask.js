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
        const { question, ocrText, solutionText, provider = 'github', apiKey = '' } = req.body;

        if (!question) {
            return res.status(400).json({ error: 'Question is required' });
        }

        const userText = `User question:\n${question}\n\nContent:\n${ocrText || 'None'}\n\nSolution/context:\n${solutionText || 'None'}`;

        const messages = [
            {
                role: 'user',
                content: userText
            }
        ];

        const answer = await invokeProvider({
            provider,
            apiKey,
            messages,
            systemPrompt: SOLVE_PROMPT
        });

        res.json({ answer });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
