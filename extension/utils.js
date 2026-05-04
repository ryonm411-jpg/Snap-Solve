export function cleanMathText(text) {
    if (!text) return '';
    return text
        .replace(/\s+/g, ' ')
        // Common OCR math misreads
        .replace(/l\s*\/\s*2/g, '1/2') 
        // Convert LaTeX commands to plain text words
        .replace(/\\int/g, 'integral ')
        .replace(/\\sum/g, 'sum ')
        .replace(/\\pi/g, 'pi')
        .replace(/\\theta/g, 'theta')
        .replace(/\\alpha/g, 'alpha')
        .replace(/\\beta/g, 'beta')
        .replace(/\\gamma/g, 'gamma')
        .replace(/\\infty/g, 'infinity')
        .replace(/\\sqrt(?:{([^}]+)})?/g, (m, p1) => p1 ? `sqrt(${p1})` : 'sqrt')
        .replace(/\\frac{([^}]+)}{([^}]+)}/g, '$1/$2')
        .replace(/\\pm/g, '±')
        .replace(/\\approx/g, '≈')
        .replace(/\\leq/g, '≤')
        .replace(/\\geq/g, '≥')
        .replace(/\\times/g, '×')
        .replace(/\\div/g, '÷')
        .replace(/\\circ/g, '°')
        // Convert unicode math symbols to text words
        .replace(/√/g, 'sqrt')
        .replace(/∫/g, 'integral ')
        .replace(/∑/g, 'sum ')
        .replace(/∞/g, 'infinity')
        // Formatting
        .replace(/(\d+)\s*\/\s*(\d+)/g, '$1/$2')
        .replace(/[{}]/g, '') // remove lingering LaTeX braces
        .trim();
}

export function cleanLatex(text) {
    if (!text) return '';
    let latex = text
        .replace(/\s+/g, ' ')
        // Common OCR misreads
        .replace(/l\s*\/\s*2/g, '1/2')
        // Convert unicode math symbols to LaTeX
        .replace(/√/g, '\\sqrt')
        .replace(/∫/g, '\\int ')
        .replace(/∑/g, '\\sum ')
        .replace(/∞/g, '\\infty')
        .replace(/±/g, '\\pm')
        .replace(/≈/g, '\\approx')
        .replace(/≤/g, '\\leq')
        .replace(/≥/g, '\\geq')
        .replace(/×/g, '\\times')
        .replace(/÷/g, '\\div')
        .replace(/°/g, '^\\circ')
        // Convert plain text math words to LaTeX
        .replace(/\bpi\b/gi, '\\pi')
        .replace(/\btheta\b/gi, '\\theta')
        .replace(/\balpha\b/gi, '\\alpha')
        .replace(/\bbeta\b/gi, '\\beta')
        .replace(/\bgamma\b/gi, '\\gamma')
        .replace(/\bintegral\b/gi, '\\int ')
        .replace(/\bsum\b/gi, '\\sum ')
        .replace(/\binfinity\b/gi, '\\infty')
        .replace(/sqrt\(([^)]+)\)/gi, '\\sqrt{$1}')
        .replace(/\bsqrt\b/gi, '\\sqrt')
        // Formatting rules
        .replace(/(?<!\\frac{)(\d+)\s*\/\s*(\d+)/g, '\\frac{$1}{$2}') // avoid double fractioning
        .replace(/([a-zA-Z])\^([a-zA-Z0-9]+)/g, '$1^{$2}')
        .trim();
    
    // If it looks like an equation and isn't already wrapped, wrap it
    if (/[=+\-*/\\]/.test(latex) && !latex.includes('\\[')) {
        latex = `\\[ ${latex} \\]`;
    }
    return latex;
}
