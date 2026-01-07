const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { walkDirectory } = require('../languageDetector');

const execAsync = promisify(exec);

async function analyzeCpp(repoPath) {
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
            hasHeaderGuards: true,
            namingConventions: 'unknown',
            issues: []
        },
        metrics: {
            totalLines: 0,
            codeLines: 0,
            commentLines: 0,
            functions: 0,
            classes: 0,
            templates: 0,
            includes: 0,
            macros: 0
        },
        patterns: {
            usesSmartPointers: false,
            usesSTL: false,
            usesRAII: false,
            usesCpp11Plus: false,
            hasBuildSystem: false,
            buildSystem: null
        },
        memoryManagement: {
            rawPointers: 0,
            smartPointers: 0,
            newDelete: 0,
            score: 0
        },
        issues: [],
        highlights: []
    };

    // Find all C/C++ files
    const cppFiles = [];
    const headerFiles = [];
    
    await walkDirectory(repoPath, async (filePath) => {
        if (filePath.match(/\.(cpp|cc|cxx|c)$/)) {
            cppFiles.push(filePath);
        } else if (filePath.match(/\.(h|hpp|hxx)$/)) {
            headerFiles.push(filePath);
        }
    });

    if (cppFiles.length === 0 && headerFiles.length === 0) {
        result.score = 0;
        result.message = 'No C/C++ files found';
        return result;
    }

    result.filesAnalyzed = cppFiles.length + headerFiles.length;

    // Check for build system
    await checkBuildSystem(repoPath, result);

    // Analyze source files
    for (const filePath of cppFiles) {
        await analyzeFile(filePath, result, false);
    }

    // Analyze header files
    for (const filePath of headerFiles) {
        await analyzeFile(filePath, result, true);
    }

    // Calculate complexity average
    if (result.metrics.functions > 0) {
        const totalComplexity = 
            result.complexity.distribution.low * 3 +
            result.complexity.distribution.medium * 7 +
            result.complexity.distribution.high * 15 +
            result.complexity.distribution.veryHigh * 25;
        result.complexity.average = Math.round(totalComplexity / result.metrics.functions);
    }

    // Calculate memory management score
    calculateMemoryScore(result);

    // Calculate final score
    result.score = calculateCppScore(result);

    // Generate highlights
    generateHighlights(result);

    return result;
}

async function checkBuildSystem(repoPath, result) {
    const files = await fs.readdir(repoPath).catch(() => []);
    const filesLower = files.map(f => f.toLowerCase());

    if (filesLower.includes('cmakelists.txt')) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'CMake';
    } else if (filesLower.includes('makefile') || filesLower.includes('makefile.am')) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'Make';
    } else if (filesLower.some(f => f.endsWith('.vcxproj'))) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'Visual Studio';
    } else if (filesLower.includes('meson.build')) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'Meson';
    } else if (filesLower.includes('conanfile.txt') || filesLower.includes('conanfile.py')) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'Conan';
    } else if (filesLower.includes('premake5.lua')) {
        result.patterns.hasBuildSystem = true;
        result.patterns.buildSystem = 'Premake';
    }
}

async function analyzeFile(filePath, result, isHeader) {
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.split('\n');
        const fileName = path.basename(filePath);

        result.metrics.totalLines += lines.length;

        let inMultiLineComment = false;
        let braceDepth = 0;
        let currentFunctionComplexity = 1;
        let inFunction = false;
        let hasHeaderGuard = false;

        // Check header guard for headers
        if (isHeader) {
            const firstLines = lines.slice(0, 5).join('\n');
            if (firstLines.match(/#ifndef\s+\w+/) && firstLines.match(/#define\s+\w+/)) {
                hasHeaderGuard = true;
            } else if (firstLines.includes('#pragma once')) {
                hasHeaderGuard = true;
            }
            if (!hasHeaderGuard) {
                result.style.hasHeaderGuards = false;
                result.issues.push({
                    type: 'style',
                    severity: 'medium',
                    message: 'Missing header guard',
                    file: fileName
                });
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
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

            // Count includes
            if (trimmed.startsWith('#include')) {
                result.metrics.includes++;
                // Check for STL usage
                if (trimmed.match(/<(vector|map|string|memory|algorithm|iostream|fstream|set|queue|stack|list|deque|array|unordered_map|unordered_set)>/)) {
                    result.patterns.usesSTL = true;
                }
                // Check for smart pointers
                if (trimmed.includes('<memory>')) {
                    result.patterns.usesSmartPointers = true;
                }
            }

            // Count macros
            if (trimmed.startsWith('#define') && !trimmed.includes('_H') && !trimmed.includes('_HPP')) {
                result.metrics.macros++;
            }

            // Count classes/structs
            if (trimmed.match(/^(class|struct)\s+\w+/)) {
                result.metrics.classes++;
            }

            // Count templates
            if (trimmed.startsWith('template')) {
                result.metrics.templates++;
                result.patterns.usesCpp11Plus = true;
            }

            // Detect C++11+ features
            if (trimmed.match(/\b(auto|nullptr|constexpr|override|final|noexcept|decltype|static_assert)\b/)) {
                result.patterns.usesCpp11Plus = true;
            }
            if (trimmed.match(/\b(unique_ptr|shared_ptr|weak_ptr|make_unique|make_shared)\b/)) {
                result.patterns.usesSmartPointers = true;
                result.memoryManagement.smartPointers++;
            }

            // Count raw pointers and new/delete
            const rawPtrMatches = trimmed.match(/\*\s*\w+/g);
            if (rawPtrMatches && !trimmed.includes('unique_ptr') && !trimmed.includes('shared_ptr')) {
                result.memoryManagement.rawPointers += rawPtrMatches.length;
            }
            if (trimmed.match(/\bnew\s+\w+/)) {
                result.memoryManagement.newDelete++;
            }
            if (trimmed.match(/\bdelete\s+/)) {
                result.memoryManagement.newDelete++;
            }

            // Count functions (simplified detection)
            if (trimmed.match(/^\w+[\s\*&]+\w+\s*\([^;]*\)\s*(const)?\s*{?$/) ||
                trimmed.match(/^(void|int|bool|char|float|double|auto)\s+\w+\s*\(/)) {
                if (!trimmed.endsWith(';')) { // Not a declaration
                    result.metrics.functions++;
                    inFunction = true;
                    currentFunctionComplexity = 1;
                }
            }

            // Track complexity
            if (inFunction) {
                if (trimmed.match(/\b(if|else|for|while|switch|case|catch|\?|&&|\|\|)\b/)) {
                    currentFunctionComplexity++;
                }

                braceDepth += (trimmed.match(/{/g) || []).length;
                braceDepth -= (trimmed.match(/}/g) || []).length;

                if (braceDepth === 0 && trimmed.includes('}')) {
                    categorizeComplexity(currentFunctionComplexity, result);
                    inFunction = false;
                    currentFunctionComplexity = 1;
                }
            }
        }

        // Check for common issues
        checkForIssues(content, fileName, result);

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

function checkForIssues(content, fileName, result) {
    // Check for goto statements
    if (content.match(/\bgoto\s+\w+/)) {
        result.issues.push({
            type: 'style',
            severity: 'medium',
            message: 'Uses goto statements',
            file: fileName
        });
    }

    // Check for C-style casts
    const cStyleCasts = content.match(/\(\s*(int|float|double|char|void)\s*\*?\s*\)/g);
    if (cStyleCasts && cStyleCasts.length > 5) {
        result.issues.push({
            type: 'style',
            severity: 'low',
            message: `Uses C-style casts (${cStyleCasts.length} found)`,
            file: fileName
        });
    }

    // Check for magic numbers
    const magicNumbers = content.match(/[^0-9a-zA-Z_]([2-9]\d{2,}|[1-9]\d{3,})[^0-9a-zA-Z_]/g);
    if (magicNumbers && magicNumbers.length > 10) {
        result.issues.push({
            type: 'style',
            severity: 'low',
            message: 'Contains magic numbers - consider using constants',
            file: fileName
        });
    }

    // Check for very long functions (rough estimate)
    const longFunctions = content.split(/^{/m).filter(block => block.split('\n').length > 100);
    if (longFunctions.length > 0) {
        result.issues.push({
            type: 'complexity',
            severity: 'medium',
            message: 'Contains very long functions (>100 lines)',
            file: fileName
        });
    }
}

function calculateMemoryScore(result) {
    const total = result.memoryManagement.rawPointers + 
                  result.memoryManagement.smartPointers + 
                  result.memoryManagement.newDelete;
    
    if (total === 0) {
        result.memoryManagement.score = 80; // No pointers is fine
        return;
    }

    const smartRatio = result.memoryManagement.smartPointers / total;
    const newDeleteRatio = result.memoryManagement.newDelete / total;

    // Prefer smart pointers, penalize raw new/delete
    result.memoryManagement.score = Math.round(
        50 + (smartRatio * 40) - (newDeleteRatio * 30)
    );
    result.memoryManagement.score = Math.max(0, Math.min(100, result.memoryManagement.score));

    // Flag if using raw new/delete without smart pointers
    if (result.memoryManagement.newDelete > 5 && !result.patterns.usesSmartPointers) {
        result.issues.push({
            type: 'memory',
            severity: 'medium',
            message: 'Manual memory management without smart pointers',
            file: 'project'
        });
    }
}

function calculateCppScore(result) {
    let score = 0;

    // Complexity score (20 points max)
    if (result.complexity.average <= 5) score += 20;
    else if (result.complexity.average <= 10) score += 15;
    else if (result.complexity.average <= 15) score += 10;
    else score += 5;

    // Build system (15 points)
    if (result.patterns.hasBuildSystem) score += 15;

    // Modern C++ usage (20 points max)
    if (result.patterns.usesCpp11Plus) score += 10;
    if (result.patterns.usesSmartPointers) score += 10;

    // Memory management (15 points max)
    score += Math.round(result.memoryManagement.score * 0.15);

    // Code organization (15 points max)
    if (result.style.hasHeaderGuards) score += 5;
    if (result.metrics.classes > 0) score += 5;
    if (result.patterns.usesSTL) score += 5;

    // Comment ratio (10 points max)
    const commentRatio = result.metrics.codeLines > 0 
        ? result.metrics.commentLines / result.metrics.codeLines 
        : 0;
    if (commentRatio >= 0.1 && commentRatio <= 0.3) score += 10;
    else if (commentRatio > 0.05) score += 5;

    // Issue penalty (up to -15 points)
    const highIssues = result.issues.filter(i => i.severity === 'high').length;
    const mediumIssues = result.issues.filter(i => i.severity === 'medium').length;
    score -= Math.min(15, highIssues * 5 + mediumIssues * 2);

    return Math.min(100, Math.max(0, score));
}

function generateHighlights(result) {
    if (result.patterns.usesCpp11Plus) {
        result.highlights.push('Uses modern C++ features (C++11+)');
    }
    if (result.patterns.usesSmartPointers) {
        result.highlights.push('Uses smart pointers for memory safety');
    }
    if (result.patterns.hasBuildSystem) {
        result.highlights.push(`Build system configured (${result.patterns.buildSystem})`);
    }
    if (result.patterns.usesSTL) {
        result.highlights.push('Leverages STL containers/algorithms');
    }
    if (result.style.hasHeaderGuards) {
        result.highlights.push('Proper header guards');
    }
    if (result.complexity.average <= 7) {
        result.highlights.push('Low code complexity');
    }
    if (result.memoryManagement.score >= 80) {
        result.highlights.push('Good memory management practices');
    }
}

module.exports = { analyzeCpp };
