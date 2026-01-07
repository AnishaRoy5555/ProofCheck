const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const { walkDirectory } = require('../languageDetector');

const execAsync = promisify(exec);

async function analyzePython(repoPath) {
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
            issues: []
        },
        metrics: {
            totalLines: 0,
            codeLines: 0,
            commentLines: 0,
            docstrings: 0,
            functions: 0,
            classes: 0
        },
        issues: [],
        highlights: []
    };

    // Find all Python files
    const pythonFiles = [];
    await walkDirectory(repoPath, async (filePath) => {
        if (filePath.endsWith('.py')) {
            pythonFiles.push(filePath);
        }
    });

    if (pythonFiles.length === 0) {
        result.score = 0;
        result.message = 'No Python files found';
        return result;
    }

    result.filesAnalyzed = pythonFiles.length;

    // Run complexity analysis with radon
    await analyzeComplexity(repoPath, result);

    // Run style analysis with pylint
    await analyzeStyle(repoPath, pythonFiles, result);

    // Analyze code metrics
    await analyzeMetrics(pythonFiles, result);

    // Calculate final score
    result.score = calculatePythonScore(result);

    // Generate highlights
    generateHighlights(result);

    return result;
}

async function analyzeComplexity(repoPath, result) {
    try {
        // Run radon cc (cyclomatic complexity)
        const { stdout } = await execAsync(
            `python -m radon cc "${repoPath}" -a -s --json`,
            { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
        );

        if (stdout.trim()) {
            const complexityData = JSON.parse(stdout);
            let totalComplexity = 0;
            let functionCount = 0;
            let maxComplexity = 0;

            for (const [file, functions] of Object.entries(complexityData)) {
                for (const func of functions) {
                    totalComplexity += func.complexity;
                    functionCount++;
                    maxComplexity = Math.max(maxComplexity, func.complexity);

                    // Categorize complexity
                    if (func.complexity <= 5) result.complexity.distribution.low++;
                    else if (func.complexity <= 10) result.complexity.distribution.medium++;
                    else if (func.complexity <= 20) result.complexity.distribution.high++;
                    else result.complexity.distribution.veryHigh++;

                    // Flag high complexity functions
                    if (func.complexity > 15) {
                        result.issues.push({
                            type: 'complexity',
                            severity: func.complexity > 25 ? 'high' : 'medium',
                            message: `High complexity (${func.complexity}) in ${func.name}`,
                            file: path.basename(file),
                            line: func.lineno
                        });
                    }
                }
            }

            result.complexity.average = functionCount > 0 
                ? Math.round((totalComplexity / functionCount) * 10) / 10 
                : 0;
            result.complexity.max = maxComplexity;
            result.metrics.functions = functionCount;
        }
    } catch (error) {
        // Radon might not be installed or failed
        result.complexity.error = 'Complexity analysis unavailable';
    }
}

async function analyzeStyle(repoPath, pythonFiles, result) {
    try {
        // Run pylint with JSON output
        const { stdout, stderr } = await execAsync(
            `python -m pylint "${repoPath}" --output-format=json --disable=C0114,C0115,C0116 --exit-zero`,
            { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }
        ).catch(e => ({ stdout: e.stdout || '[]', stderr: e.stderr }));

        if (stdout && stdout.trim() && stdout.trim() !== '[]') {
            try {
                const issues = JSON.parse(stdout);
                
                // Count by type
                const counts = { error: 0, warning: 0, convention: 0, refactor: 0 };
                
                for (const issue of issues) {
                    counts[issue.type] = (counts[issue.type] || 0) + 1;
                    
                    // Store first 10 significant issues
                    if (result.style.issues.length < 10 && 
                        (issue.type === 'error' || issue.type === 'warning')) {
                        result.style.issues.push({
                            type: issue.type,
                            message: issue.message,
                            file: path.basename(issue.path),
                            line: issue.line,
                            symbol: issue.symbol
                        });
                    }
                }

                // Calculate style score (start at 100, deduct points)
                let styleScore = 100;
                styleScore -= counts.error * 5;
                styleScore -= counts.warning * 2;
                styleScore -= counts.convention * 0.5;
                styleScore -= counts.refactor * 1;

                result.style.score = Math.max(0, Math.min(100, Math.round(styleScore)));
                result.style.counts = counts;
            } catch (parseError) {
                result.style.score = 70; // Default if parsing fails
            }
        } else {
            result.style.score = 85; // Good score if no issues
        }
    } catch (error) {
        result.style.score = 70; // Default score
        result.style.error = 'Style analysis limited';
    }
}

async function analyzeMetrics(pythonFiles, result) {
    for (const filePath of pythonFiles) {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            const lines = content.split('\n');
            
            result.metrics.totalLines += lines.length;
            
            let inDocstring = false;
            let docstringChar = null;
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                // Track docstrings
                if (!inDocstring && (trimmed.startsWith('"""') || trimmed.startsWith("'''"))) {
                    docstringChar = trimmed.substring(0, 3);
                    if (trimmed.length > 3 && trimmed.endsWith(docstringChar)) {
                        result.metrics.docstrings++;
                    } else {
                        inDocstring = true;
                    }
                } else if (inDocstring && trimmed.endsWith(docstringChar)) {
                    inDocstring = false;
                    result.metrics.docstrings++;
                }
                
                // Count comments
                if (trimmed.startsWith('#')) {
                    result.metrics.commentLines++;
                }
                
                // Count code lines (non-empty, non-comment)
                if (trimmed && !trimmed.startsWith('#') && !inDocstring) {
                    result.metrics.codeLines++;
                }
                
                // Count classes
                if (trimmed.startsWith('class ')) {
                    result.metrics.classes++;
                }
            }
        } catch (e) {
            // Skip unreadable files
        }
    }
}

function calculatePythonScore(result) {
    let score = 0;
    
    // Complexity score (30 points max)
    if (result.complexity.average <= 5) score += 30;
    else if (result.complexity.average <= 10) score += 25;
    else if (result.complexity.average <= 15) score += 18;
    else if (result.complexity.average <= 20) score += 10;
    else score += 5;
    
    // Style score (30 points max)
    score += Math.round(result.style.score * 0.3);
    
    // Documentation score (20 points max)
    const docRatio = result.metrics.functions > 0 
        ? result.metrics.docstrings / result.metrics.functions 
        : 0;
    if (docRatio >= 0.8) score += 20;
    else if (docRatio >= 0.5) score += 15;
    else if (docRatio >= 0.3) score += 10;
    else if (docRatio > 0) score += 5;
    
    // Comment ratio (10 points max)
    const commentRatio = result.metrics.codeLines > 0 
        ? result.metrics.commentLines / result.metrics.codeLines 
        : 0;
    if (commentRatio >= 0.1 && commentRatio <= 0.3) score += 10;
    else if (commentRatio > 0) score += 5;
    
    // Code organization - bonus for classes (10 points max)
    if (result.metrics.classes > 0) {
        score += Math.min(10, result.metrics.classes * 2);
    }
    
    return Math.min(100, Math.max(0, score));
}

function generateHighlights(result) {
    if (result.complexity.average <= 5) {
        result.highlights.push('Low code complexity - easy to maintain');
    }
    if (result.style.score >= 80) {
        result.highlights.push('Follows Python style conventions');
    }
    if (result.metrics.docstrings > 0 && 
        result.metrics.functions > 0 && 
        result.metrics.docstrings / result.metrics.functions >= 0.5) {
        result.highlights.push('Good documentation coverage');
    }
    if (result.metrics.classes > 0) {
        result.highlights.push('Uses object-oriented design');
    }
    if (result.issues.length === 0) {
        result.highlights.push('No major code issues detected');
    }
}

module.exports = { analyzePython };
