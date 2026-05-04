const express = require('express');
const { invokeProvider } = require('../providers');

const router = express.Router();

const OCR_PROMPT = 'You are an expert math formatter and OCR tool. Transcribe the text from the image exactly. STRICT FORMATTING RULES: (1) ALL math must use ONLY dollar-sign delimiters: inline $...$ and display $$...$$. (2) NEVER use backslash-bracket or backslash-paren delimiters. (3) NEVER output raw math without dollar signs - every variable like $X$, $a$, $b$ must be wrapped. Write $e^x$ not e^x, write $\\frac{5}{6}$ not 5/6. (4) Convert ALL vertical or stacked fractions into $\\frac{numerator}{denominator}$. (5) Use proper LaTeX: \\int, \\frac, \\infty, \\leq, \\geq, \\text, \\begin{cases}. (6) NEVER use markdown. Output ONLY the extracted content, no commentary. Output MUST render perfectly in KaTeX.';

router.post('/', async (req, res, next) => {
    try {
        const { image, provider = 'github', apiKey = '' } = req.body;

        if (!image) {
            return res.status(400).json({ error: 'Image is required' });
        }

        const messages = [
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: image } }
                ]
            }
        ];

        const extractedText = await invokeProvider({
            provider,
            apiKey,
            messages,
            systemPrompt: OCR_PROMPT
        });

        res.json({
            ParsedResults: [
                {
                    ParsedText: extractedText
                }
            ]
        });
    } catch (error) {
        next(error);
    }
});

module.exports = router;
