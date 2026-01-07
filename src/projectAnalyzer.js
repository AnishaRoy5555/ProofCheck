const fs = require('fs').promises;
const path = require('path');

async function analyzeProject(repoPath, repoUrl) {
    const metrics = {
        hasReadme: false,
        readmeQuality: 0,
        hasLicense: false,
        hasTests: false,
        hasCI: false,
        hasDocker: false,
        hasPackageManager: false,
        hasDocs: false,
        structureScore: 0,
        score: 0
    };

    const files = await fs.readdir(repoPath);
    const filesLower = files.map(f => f.toLowerCase());

    // Check README
    const readmeFile = files.find(f => f.toLowerCase().startsWith('readme'));
    if (readmeFile) {
        metrics.hasReadme = true;
        metrics.readmeQuality = await analyzeReadme(path.join(repoPath, readmeFile));
    }

    // Check License
    metrics.hasLicense = filesLower.some(f => 
        f.includes('license') || f.includes('licence') || f === 'copying'
    );

    // Check for tests
    metrics.hasTests = await checkForTests(repoPath, files);

    // Check CI/CD
    metrics.hasCI = await checkForCI(repoPath, files);

    // Check Docker
    metrics.hasDocker = filesLower.some(f => 
        f === 'dockerfile' || f === 'docker-compose.yml' || f === 'docker-compose.yaml'
    );

    // Check package managers
    metrics.hasPackageManager = filesLower.some(f => 
        f === 'package.json' || f === 'requirements.txt' || f === 'pyproject.toml' ||
        f === 'cargo.toml' || f === 'go.mod' || f === 'pom.xml' || f === 'build.gradle' ||
        f === 'gemfile' || f === 'composer.json' || f === 'cmakelists.txt'
    );

    // Check for docs folder
    metrics.hasDocs = files.some(f => 
        f.toLowerCase() === 'docs' || f.toLowerCase() === 'documentation'
    );

    // Analyze structure
    metrics.structureScore = await analyzeStructure(repoPath, files);

    // Calculate overall project score
    metrics.score = calculateProjectScore(metrics);

    return metrics;
}

async function analyzeReadme(readmePath) {
    try {
        const content = await fs.readFile(readmePath, 'utf-8');
        let score = 0;
        const contentLower = content.toLowerCase();

        // Length score (up to 25 points)
        const wordCount = content.split(/\s+/).length;
        if (wordCount > 500) score += 25;
        else if (wordCount > 200) score += 20;
        else if (wordCount > 100) score += 15;
        else if (wordCount > 50) score += 10;
        else score += 5;

        // Has title/headers (15 points)
        if (content.match(/^#\s+.+/m)) score += 15;

        // Has description section (10 points)
        if (contentLower.includes('description') || contentLower.includes('about') || 
            contentLower.includes('overview')) score += 10;

        // Has installation instructions (15 points)
        if (contentLower.includes('install') || contentLower.includes('setup') ||
            contentLower.includes('getting started')) score += 15;

        // Has usage examples (15 points)
        if (contentLower.includes('usage') || contentLower.includes('example') ||
            content.includes('```')) score += 15;

        // Has contributing section (5 points)
        if (contentLower.includes('contribut')) score += 5;

        // Has license mention (5 points)
        if (contentLower.includes('license') || contentLower.includes('licence')) score += 5;

        // Has badges (5 points)
        if (content.includes('![') || content.includes('[![')) score += 5;

        // Has links (5 points)
        if (content.match(/\[.+\]\(.+\)/)) score += 5;

        return Math.min(100, score);
    } catch (e) {
        return 0;
    }
}

async function checkForTests(repoPath, files) {
    // Check common test directories and files
    const testIndicators = ['test', 'tests', 'spec', 'specs', '__tests__', 'test.py', 'test.js'];
    
    for (const file of files) {
        const fileLower = file.toLowerCase();
        if (testIndicators.some(t => fileLower.includes(t))) {
            return true;
        }
    }

    // Check for test files in subdirectories
    try {
        const src = path.join(repoPath, 'src');
        if (await fileExists(src)) {
            const srcFiles = await fs.readdir(src);
            if (srcFiles.some(f => f.toLowerCase().includes('test'))) {
                return true;
            }
        }
    } catch (e) {}

    // Check package.json for test script
    try {
        const pkgPath = path.join(repoPath, 'package.json');
        const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
        if (pkg.scripts && (pkg.scripts.test && !pkg.scripts.test.includes('no test'))) {
            return true;
        }
        if (pkg.devDependencies) {
            const testPackages = ['jest', 'mocha', 'chai', 'jasmine', 'vitest', 'ava', 'tap'];
            if (testPackages.some(p => pkg.devDependencies[p])) {
                return true;
            }
        }
    } catch (e) {}

    // Check for pytest
    try {
        const setupPy = await fs.readFile(path.join(repoPath, 'setup.py'), 'utf-8');
        if (setupPy.includes('pytest') || setupPy.includes('unittest')) {
            return true;
        }
    } catch (e) {}

    return false;
}

async function checkForCI(repoPath, files) {
    // GitHub Actions
    try {
        const ghActions = path.join(repoPath, '.github', 'workflows');
        await fs.access(ghActions);
        return true;
    } catch (e) {}

    // Other CI configs
    const ciFiles = [
        '.travis.yml', '.circleci', 'Jenkinsfile', 'azure-pipelines.yml',
        '.gitlab-ci.yml', 'bitbucket-pipelines.yml', '.drone.yml',
        'appveyor.yml', '.github'
    ];

    return files.some(f => ciFiles.some(ci => f.toLowerCase().includes(ci.toLowerCase())));
}

async function analyzeStructure(repoPath, files) {
    let score = 50; // Base score

    // Has source directory
    const srcDirs = ['src', 'lib', 'app', 'source', 'core'];
    if (files.some(f => srcDirs.includes(f.toLowerCase()))) {
        score += 15;
    }

    // Has config files organized
    const configFiles = files.filter(f => 
        f.endsWith('.json') || f.endsWith('.yml') || f.endsWith('.yaml') || 
        f.endsWith('.toml') || f.endsWith('.ini') || f.startsWith('.')
    );
    if (configFiles.length > 0 && configFiles.length < 10) {
        score += 10;
    }

    // Not too many files in root
    const rootFiles = files.filter(f => !f.startsWith('.'));
    if (rootFiles.length <= 15) {
        score += 10;
    } else if (rootFiles.length > 30) {
        score -= 15;
    }

    // Has meaningful directory structure
    const meaningfulDirs = files.filter(f => 
        ['src', 'lib', 'test', 'tests', 'docs', 'scripts', 'utils', 
         'helpers', 'components', 'models', 'views', 'controllers'].includes(f.toLowerCase())
    );
    score += Math.min(15, meaningfulDirs.length * 5);

    return Math.max(0, Math.min(100, score));
}

function calculateProjectScore(metrics) {
    let score = 0;
    
    // README (25 points max)
    if (metrics.hasReadme) {
        score += Math.round(metrics.readmeQuality * 0.25);
    }
    
    // License (10 points)
    if (metrics.hasLicense) score += 10;
    
    // Tests (20 points)
    if (metrics.hasTests) score += 20;
    
    // CI/CD (15 points)
    if (metrics.hasCI) score += 15;
    
    // Docker (5 points)
    if (metrics.hasDocker) score += 5;
    
    // Package manager (10 points)
    if (metrics.hasPackageManager) score += 10;
    
    // Structure (15 points max)
    score += Math.round(metrics.structureScore * 0.15);
    
    return Math.min(100, score);
}

async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

module.exports = { analyzeProject };
