const express = require('express');
const { invokeProvider } = require('../providers');

const router = express.Router();

const SOLVE_PROMPT = `You are an expert math tutor. 
Your goal is to provide a premium, structured solution.

STRICT FORMATTING RULES:
1. NEVER repeat variables or equations. (e.g., write "$x=1$", NOT "$x=1$ x=1").
2. ALWAYS wrap every single variable, number, and equation in LaTeX ($...$ for inline, $$...$$ for blocks).
3. Use clean Markdown: **Step 1:**, **Step 2:**, etc.
4. Use horizontal rules (---) between major steps.
5. End with a bold **Final Answer:** section.
6. Avoid conversational filler like "Here is the solution" or "I hope this helps".
7. Ensure all math renders perfectly in KaTeX.
8. If the input is messy, clean it up and only solve the core problem.`;

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

        // DeepSeek doesn't support images. If provider is deepseek, we only
        // pass the text question (which was extracted by the GitHub OCR fallback).
        if (image && provider !== 'deepseek') {
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
