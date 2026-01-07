const simpleGit = require('simple-git');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { detectLanguages } = require('./languageDetector');
const { analyzeProject } = require('./projectAnalyzer');
const { runAnalyzers } = require('./router');

const TEMP_DIR = path.join(__dirname, '..', 'temp');

async function analyzeRepo(repoUrl) {
    const repoId = uuidv4();
    const clonePath = path.join(TEMP_DIR, repoId);
    
    try {
        // Step 1: Clone the repository
        console.log(`[1/4] Cloning repository...`);
        const git = simpleGit();
        await git.clone(repoUrl, clonePath, ['--depth', '1']);
        
        // Step 2: Detect languages
        console.log(`[2/4] Detecting languages...`);
        const languageStats = await detectLanguages(clonePath);
        
        // Step 3: Analyze project-level metrics
        console.log(`[3/4] Analyzing project structure...`);
        const projectMetrics = await analyzeProject(clonePath, repoUrl);
        
        // Step 4: Run language-specific analyzers
        console.log(`[4/4] Running code analyzers...`);
        const codeAnalysis = await runAnalyzers(clonePath, languageStats);
        
        // Compile final report
        const report = compileReport(repoUrl, languageStats, projectMetrics, codeAnalysis);
        
        return report;
        
    } finally {
        // Cleanup: Remove cloned repo
        try {
            await fs.rm(clonePath, { recursive: true, force: true });
        } catch (e) {
            console.error('Cleanup error:', e.message);
        }
    }
}

function compileReport(repoUrl, languageStats, projectMetrics, codeAnalysis) {
    // Calculate overall score (weighted average)
    const projectScore = projectMetrics.score;
    const codeScore = codeAnalysis.overallScore;
    
    // Weight: 40% project quality, 60% code quality
    const overallScore = Math.round(projectScore * 0.4 + codeScore * 0.6);
    
    return {
        repoUrl,
        analyzedAt: new Date().toISOString(),
        overallScore,
        grade: scoreToGrade(overallScore),
        summary: generateSummary(overallScore, projectMetrics, codeAnalysis),
        languages: languageStats,
        projectMetrics,
        codeAnalysis,
        strengths: identifyStrengths(projectMetrics, codeAnalysis),
        improvements: identifyImprovements(projectMetrics, codeAnalysis)
    };
}

function scoreToGrade(score) {
    if (score >= 90) return 'A+';
    if (score >= 85) return 'A';
    if (score >= 80) return 'A-';
    if (score >= 75) return 'B+';
    if (score >= 70) return 'B';
    if (score >= 65) return 'B-';
    if (score >= 60) return 'C+';
    if (score >= 55) return 'C';
    if (score >= 50) return 'C-';
    if (score >= 40) return 'D';
    return 'F';
}

function generateSummary(score, projectMetrics, codeAnalysis) {
    const grade = scoreToGrade(score);
    let summary = '';
    
    if (score >= 80) {
        summary = 'This repository demonstrates strong software engineering practices. ';
    } else if (score >= 60) {
        summary = 'This repository shows competent development skills with room for improvement. ';
    } else if (score >= 40) {
        summary = 'This repository meets basic standards but needs significant improvements. ';
    } else {
        summary = 'This repository requires substantial work to meet professional standards. ';
    }
    
    if (projectMetrics.hasTests) {
        summary += 'Test coverage is present. ';
    }
    if (projectMetrics.hasReadme && projectMetrics.readmeQuality >= 70) {
        summary += 'Documentation is well-maintained. ';
    }
    if (codeAnalysis.overallScore >= 75) {
        summary += 'Code quality is above average.';
    }
    
    return summary.trim();
}

function identifyStrengths(projectMetrics, codeAnalysis) {
    const strengths = [];
    
    if (projectMetrics.readmeQuality >= 80) strengths.push('Excellent documentation');
    if (projectMetrics.hasTests) strengths.push('Includes test suite');
    if (projectMetrics.hasCI) strengths.push('CI/CD configured');
    if (projectMetrics.hasLicense) strengths.push('Properly licensed');
    if (projectMetrics.structureScore >= 80) strengths.push('Well-organized file structure');
    if (codeAnalysis.overallScore >= 80) strengths.push('High code quality');
    
    for (const lang of Object.keys(codeAnalysis.byLanguage || {})) {
        const analysis = codeAnalysis.byLanguage[lang];
        if (analysis.score >= 85) {
            strengths.push(`Strong ${lang} implementation`);
        }
    }
    
    return strengths.length > 0 ? strengths : ['Repository analyzed successfully'];
}

function identifyImprovements(projectMetrics, codeAnalysis) {
    const improvements = [];
    
    if (!projectMetrics.hasReadme) improvements.push('Add a README file');
    else if (projectMetrics.readmeQuality < 50) improvements.push('Improve README documentation');
    
    if (!projectMetrics.hasTests) improvements.push('Add unit tests');
    if (!projectMetrics.hasLicense) improvements.push('Add a license file');
    if (!projectMetrics.hasCI) improvements.push('Set up CI/CD pipeline');
    if (projectMetrics.structureScore < 50) improvements.push('Improve project organization');
    
    for (const lang of Object.keys(codeAnalysis.byLanguage || {})) {
        const analysis = codeAnalysis.byLanguage[lang];
        if (analysis.complexity?.average > 15) {
            improvements.push(`Reduce complexity in ${lang} code`);
        }
        if (analysis.issues?.length > 5) {
            improvements.push(`Address code quality issues in ${lang}`);
        }
    }
    
    return improvements.slice(0, 5); // Top 5 improvements
}

module.exports = { analyzeRepo };
