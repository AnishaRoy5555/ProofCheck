const { analyzePython } = require('./analyzers/pythonAnalyzer');
const { analyzeJavaScript } = require('./analyzers/javascriptAnalyzer');
const { analyzeCpp } = require('./analyzers/cppAnalyzer');

// Map languages to their analyzers
const ANALYZERS = {
    'Python': analyzePython,
    'JavaScript': analyzeJavaScript,
    'TypeScript': analyzeJavaScript, // Use same analyzer
    'C++': analyzeCpp,
    'C': analyzeCpp, // Use C++ analyzer for C
    'C/C++ Header': null, // Skip headers, analyzed with source
    'C++ Header': null
};

// Languages we fully support
const SUPPORTED_LANGUAGES = new Set(['Python', 'JavaScript', 'TypeScript', 'C++', 'C']);

async function runAnalyzers(repoPath, languageStats) {
    const results = {
        byLanguage: {},
        overallScore: 0,
        analyzedLanguages: []
    };

    const languagesToAnalyze = Object.entries(languageStats.breakdown)
        .filter(([lang, data]) => {
            return SUPPORTED_LANGUAGES.has(lang) && data.percentage >= 5;
        })
        .slice(0, 3); // Analyze top 3 languages

    if (languagesToAnalyze.length === 0) {
        results.overallScore = 50; // Default score if no supported languages
        results.message = 'No supported languages found with significant code';
        return results;
    }

    let totalWeight = 0;
    let weightedScore = 0;

    for (const [lang, data] of languagesToAnalyze) {
        const analyzer = ANALYZERS[lang];
        
        if (analyzer) {
            try {
                console.log(`   → Analyzing ${lang}...`);
                const analysis = await analyzer(repoPath);
                results.byLanguage[lang] = analysis;
                results.analyzedLanguages.push(lang);

                // Weight by percentage of codebase
                const weight = data.percentage;
                totalWeight += weight;
                weightedScore += analysis.score * weight;
            } catch (error) {
                console.error(`   ✗ ${lang} analysis failed:`, error.message);
                results.byLanguage[lang] = {
                    score: 50,
                    error: error.message
                };
            }
        }
    }

    // Calculate weighted average score
    results.overallScore = totalWeight > 0 
        ? Math.round(weightedScore / totalWeight) 
        : 50;

    return results;
}

module.exports = { runAnalyzers, SUPPORTED_LANGUAGES };
