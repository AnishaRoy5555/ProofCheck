const fs = require('fs').promises;
const path = require('path');
const { walkDirectory } = require('../languageDetector');

async function analyzeJavaScript(repoPath) {
    const result = {
        score: 0,
        filesAnalyzed: 0,
        complexity: {
            average: 0,
            max: 0,
            distribution: { low: 0, medium: 0, high: 0, veryHigh: 0 }
        },
        style: {
            score: 0,
            hasLinter: false,
            hasFormatter: false,
            issues: []
        },
        metrics: {
            totalLines: 0,
            codeLines: 0,
            commentLines: 0,
            functions: 0,
            arrowFunctions: 0,
            classes: 0,
            asyncFunctions: 0,
            imports: 0,
            exports: 0
        },
        patterns: {
            usesModules: false,
            usesAsync: false,
            usesClasses: false,
            usesTypeScript: false,
            usesReact: false,
            framework: null
        },
        issues: [],
        highlights: []
    };

    // Find all JS/TS files
    const jsFiles = [];
    await walkDirectory(repoPath, async (filePath) => {
        if (filePath.match(/\.(js|jsx|ts|tsx)$/)) {
            jsFiles.push(filePath);
        }
    });

    if (jsFiles.length === 0) {
        result.score = 0;
        result.message = 'No JavaScript/TypeScript files found';
        return result;
    }

    result.filesAnalyzed = jsFiles.length;

    // Check for config files
    await checkProjectConfig(repoPath, result);

    // Analyze all files
    for (const filePath of jsFiles) {
        await analyzeFile(filePath, result);
    }

    // Calculate complexity average
    const totalFunctions = result.metrics.functions + result.metrics.arrowFunctions;
    if (totalFunctions > 0) {
        result.complexity.average = Math.round(
            (result.complexity.distribution.low * 2 +
             result.complexity.distribution.medium * 7 +
             result.complexity.distribution.high * 15 +
             result.complexity.distribution.veryHigh * 25) / totalFunctions
        );
    }

    // Detect patterns
    detectPatterns(result);

    // Calculate final score
    result.score = calculateJSScore(result);

    // Generate highlights
    generateHighlights(result);

    return result;
}

async function checkProjectConfig(repoPath, result) {
    const files = await fs.readdir(repoPath).catch(() => []);
    const filesLower = files.map(f => f.toLowerCase());

    // Check for linter
    result.style.hasLinter = filesLower.some(f => 
        f.includes('eslint') || f.includes('.eslintrc') || 
        f === 'tslint.json' || f === 'biome.json'
    );

    // Check for formatter
    result.style.hasFormatter = filesLower.some(f => 
        f.includes('prettier') || f === '.prettierrc' || 
        f === '.prettierrc.json' || f === 'biome.json'
    );

    // Check package.json for more info
    try {
        const pkgPath = path.join(repoPath, 'package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

        // Check for TypeScript
        if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
            result.patterns.usesTypeScript = true;
        }

        // Check for React
        if (pkg.dependencies?.react || pkg.devDependencies?.react) {
            result.patterns.usesReact = true;
            result.patterns.framework = 'React';
        }

        // Check for other frameworks
        if (pkg.dependencies?.vue) result.patterns.framework = 'Vue';
        if (pkg.dependencies?.angular || pkg.dependencies?.['@angular/core']) {
            result.patterns.framework = 'Angular';
        }
        if (pkg.dependencies?.express) result.patterns.framework = 'Express';
        if (pkg.dependencies?.next) result.patterns.framework = 'Next.js';
        if (pkg.dependencies?.nuxt) result.patterns.framework = 'Nuxt';
        if (pkg.dependencies?.svelte) result.patterns.framework = 'Svelte';

        // Check for linter in package.json scripts
        if (pkg.scripts?.lint || pkg.scripts?.eslint) {
            result.style.hasLinter = true;
        }

    } catch (e) {
        // No package.json or can't parse
    }
}

async function analyzeFile(filePath, result) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');

        result.metrics.totalLines += lines.length;

        // Check if TypeScript
        if (filePath.match(/\.tsx?$/)) {
            result.patterns.usesTypeScript = true;
        }

        let inMultiLineComment = false;
        let braceDepth = 0;
        let currentFunctionComplexity = 1;
        let inFunction = false;

        for (const line of lines) {
            const trimmed = line.trim();

            // Track multi-line comments
            if (trimmed.includes('/*') && !trimmed.includes('*/')) {
                inMultiLineComment = true;
            }
            if (trimmed.includes('*/')) {
                inMultiLineComment = false;
            }

            // Count comments
            if (trimmed.startsWith('//') || trimmed.startsWith('/*') || inMultiLineComment) {
                result.metrics.commentLines++;
                continue;
            }

            // Skip empty lines
            if (!trimmed) continue;

            result.metrics.codeLines++;

            // Count imports/exports
            if (trimmed.startsWith('import ') || trimmed.match(/^const .+ = require\(/)) {
                result.metrics.imports++;
                result.patterns.usesModules = true;
            }
            if (trimmed.startsWith('export ')) {
                result.metrics.exports++;
                result.patterns.usesModules = true;
            }

            // Count functions
            if (trimmed.match(/function\s+\w+\s*\(/) || trimmed.match(/^\s*\w+\s*\([^)]*\)\s*{/)) {
                result.metrics.functions++;
                inFunction = true;
                currentFunctionComplexity = 1;
            }

            // Count arrow functions
            if (trimmed.match(/=>\s*{/) || trimmed.match(/=>\s*[^{]/)) {
                result.metrics.arrowFunctions++;
            }

            // Count async functions
            if (trimmed.includes('async ')) {
                result.metrics.asyncFunctions++;
                result.patterns.usesAsync = true;
            }

            // Count classes
            if (trimmed.match(/^class\s+\w+/)) {
                result.metrics.classes++;
                result.patterns.usesClasses = true;
            }

            // Track complexity (simplified)
            if (inFunction) {
                // Count complexity-adding statements
                if (trimmed.match(/\b(if|else|for|while|switch|case|catch|\?\?|\|\||&&)\b/)) {
                    currentFunctionComplexity++;
                }
                if (trimmed.match(/\?[^:]+:/)) { // Ternary
                    currentFunctionComplexity++;
                }

                // Track braces
                braceDepth += (trimmed.match(/{/g) || []).length;
                braceDepth -= (trimmed.match(/}/g) || []).length;

                if (braceDepth === 0 && trimmed.includes('}')) {
                    // Function ended, record complexity
                    categorizeComplexity(currentFunctionComplexity, result);
                    inFunction = false;
                    currentFunctionComplexity = 1;
                }
            }
        }

        // Check for common issues
        checkForIssues(content, filePath, result);

    } catch (e) {
        // Skip unreadable files
    }
}

function categorizeComplexity(complexity, result) {
    if (complexity <= 5) result.complexity.distribution.low++;
    else if (complexity <= 10) result.complexity.distribution.medium++;
    else if (complexity <= 20) result.complexity.distribution.high++;
    else result.complexity.distribution.veryHigh++;

    result.complexity.max = Math.max(result.complexity.max, complexity);
}

function checkForIssues(content, filePath, result) {
    const fileName = path.basename(filePath);

    // Check for console.log in production code
    const consoleMatches = content.match(/console\.(log|debug|info)/g);
    if (consoleMatches && consoleMatches.length > 5) {
        result.issues.push({
            type: 'style',
            severity: 'low',
            message: `Multiple console statements (${consoleMatches.length})`,
            file: fileName
        });
    }

    // Check for var usage (should use let/const)
    if (content.match(/\bvar\s+\w+/)) {
        result.issues.push({
            type: 'style',
            severity: 'low',
            message: 'Uses var instead of let/const',
            file: fileName
        });
    }

    // Check for very long lines
    const longLines = content.split('\n').filter(l => l.length > 150).length;
    if (longLines > 10) {
        result.issues.push({
            type: 'style',
            severity: 'low',
            message: `${longLines} lines exceed 150 characters`,
            file: fileName
        });
    }

    // Check for TODO/FIXME comments
    const todos = content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)/gi);
    if (todos && todos.length > 0) {
        result.issues.push({
            type: 'info',
            severity: 'low',
            message: `${todos.length} TODO/FIXME comments found`,
            file: fileName
        });
    }
}

function detectPatterns(result) {
    // Already detected during analysis
}

function calculateJSScore(result) {
    let score = 0;

    // Complexity score (25 points max)
    if (result.complexity.average <= 5) score += 25;
    else if (result.complexity.average <= 10) score += 20;
    else if (result.complexity.average <= 15) score += 12;
    else score += 5;

    // Linter/Formatter (15 points max)
    if (result.style.hasLinter) score += 10;
    if (result.style.hasFormatter) score += 5;

    // Modern patterns (20 points max)
    if (result.patterns.usesModules) score += 5;
    if (result.patterns.usesAsync) score += 5;
    if (result.patterns.usesTypeScript) score += 10;

    // Code organization (20 points max)
    const totalFunctions = result.metrics.functions + result.metrics.arrowFunctions;
    if (totalFunctions > 0) {
        // Reasonable function count
        if (totalFunctions / result.filesAnalyzed <= 20) score += 10;
        // Uses classes for organization
        if (result.metrics.classes > 0) score += 10;
    }

    // Comment ratio (10 points max)
    const commentRatio = result.metrics.codeLines > 0 
        ? result.metrics.commentLines / result.metrics.codeLines 
        : 0;
    if (commentRatio >= 0.05 && commentRatio <= 0.25) score += 10;
    else if (commentRatio > 0) score += 5;

    // Issue penalty (up to -10 points)
    const highIssues = result.issues.filter(i => i.severity === 'high').length;
    const mediumIssues = result.issues.filter(i => i.severity === 'medium').length;
    score -= Math.min(10, highIssues * 3 + mediumIssues);

    // Framework bonus (10 points)
    if (result.patterns.framework) score += 10;

    return Math.min(100, Math.max(0, score));
}

function generateHighlights(result) {
    if (result.patterns.usesTypeScript) {
        result.highlights.push('Uses TypeScript for type safety');
    }
    if (result.patterns.framework) {
        result.highlights.push(`Built with ${result.patterns.framework}`);
    }
    if (result.style.hasLinter && result.style.hasFormatter) {
        result.highlights.push('Has linting and formatting configured');
    }
    if (result.patterns.usesAsync) {
        result.highlights.push('Uses modern async/await patterns');
    }
    if (result.complexity.average <= 5) {
        result.highlights.push('Low code complexity');
    }
    if (result.patterns.usesModules) {
        result.highlights.push('Uses ES modules');
    }
}

module.exports = { analyzeJavaScript };
