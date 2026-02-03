/**
 * GitHub API-based repository fetcher
 * Replaces git clone to work on platforms without git installed
 */

const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const { v4: uuidv4 } = require('uuid');

// Configuration constants
const CONFIG = {
    // Directories to skip
    SKIP_DIRS: new Set([
        'node_modules', '.git', 'dist', 'build', 'vendor', '__pycache__',
        '.env', '.venv', 'venv', 'env', '.idea', '.vscode', 'coverage',
        '.nyc_output', 'bower_components', '.next', '.nuxt', 'target',
        'packages', '.cache', '.temp', 'tmp', '.tmp'
    ]),

    // File extensions to analyze
    ALLOWED_EXTENSIONS: new Set([
        '.py', '.js', '.ts', '.jsx', '.tsx', '.cpp', '.c', '.h', '.hpp',
        '.cc', '.cxx', '.hxx', '.pyw'
    ]),

    // Config/project files to always include
    CONFIG_FILES: new Set([
        'package.json', 'requirements.txt', 'pyproject.toml', 'setup.py',
        'cmakelists.txt', 'makefile', 'dockerfile', 'docker-compose.yml',
        'docker-compose.yaml', '.eslintrc', '.eslintrc.json', '.eslintrc.js',
        '.prettierrc', '.prettierrc.json', 'tsconfig.json', 'jest.config.js',
        '.travis.yml', '.gitlab-ci.yml', 'readme.md', 'readme.txt', 'readme',
        'license', 'license.md', 'license.txt', 'copying'
    ]),

    // Skip binary and media file extensions
    SKIP_EXTENSIONS: new Set([
        '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg', '.webp', '.bmp',
        '.mp4', '.mp3', '.wav', '.avi', '.mov', '.webm', '.ogg',
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so',
        '.dylib', '.bin', '.dat', '.db', '.sqlite', '.woff', '.woff2',
        '.ttf', '.eot', '.otf', '.map', '.min.js', '.min.css',
        '.lock', '.log'
    ]),

    // Limits
    MAX_FILE_SIZE: 1024 * 1024,  // 1MB
    MAX_FILES: 500,
    BATCH_SIZE: 10,
    REQUEST_TIMEOUT: 30000,  // 30 seconds
    TOTAL_TIMEOUT: 300000,   // 5 minutes

    // Rate limiting
    MAX_RETRIES: 3,
    BASE_RETRY_DELAY: 1000,  // 1 second
};

// Temp directory for storing downloaded files
const TEMP_DIR = path.join(__dirname, '..', 'temp');

/**
 * Parse GitHub URL to extract owner and repo
 */
function parseGitHubUrl(url) {
    // Support various GitHub URL formats
    const patterns = [
        /github\.com\/([^\/]+)\/([^\/\?#]+)/,
        /github\.com:([^\/]+)\/([^\/\?#]+)/
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
            const owner = match[1];
            let repo = match[2];
            // Remove .git suffix if present
            repo = repo.replace(/\.git$/, '');
            return { owner, repo };
        }
    }

    throw new Error('Invalid GitHub URL format');
}

/**
 * Make HTTPS request with timeout and retry logic
 */
function httpsRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const timeout = options.timeout || CONFIG.REQUEST_TIMEOUT;

        const req = https.get(url, {
            headers: {
                'User-Agent': 'ProofCheck-Analyzer/1.0',
                'Accept': 'application/vnd.github.v3+json',
                ...options.headers
            }
        }, (res) => {
            // Handle redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                resolve(httpsRequest(res.headers.location, options));
                return;
            }

            // Check rate limit headers
            const rateLimit = {
                remaining: parseInt(res.headers['x-ratelimit-remaining'] || '60'),
                reset: parseInt(res.headers['x-ratelimit-reset'] || '0'),
                limit: parseInt(res.headers['x-ratelimit-limit'] || '60')
            };

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data,
                    rateLimit
                });
            });
        });

        req.on('error', reject);
        req.setTimeout(timeout, () => {
            req.destroy();
            reject(new Error(`Request timeout after ${timeout}ms`));
        });
    });
}

/**
 * Make request with retry logic and exponential backoff
 */
async function requestWithRetry(url, options = {}, retries = CONFIG.MAX_RETRIES) {
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await httpsRequest(url, options);

            // Handle rate limiting
            if (response.statusCode === 403 && response.rateLimit.remaining === 0) {
                const resetTime = response.rateLimit.reset * 1000;
                const waitTime = Math.max(0, resetTime - Date.now());

                if (waitTime > 60000) {
                    throw new Error(
                        `GitHub API rate limit exceeded. Resets at ${new Date(resetTime).toISOString()}. ` +
                        `Please try again later or use a GitHub token.`
                    );
                }

                console.log(`   Rate limited. Waiting ${Math.ceil(waitTime / 1000)}s...`);
                await sleep(waitTime + 1000);
                continue;
            }

            // Handle other errors
            if (response.statusCode === 404) {
                throw new Error('Repository not found or is private');
            }

            if (response.statusCode >= 400) {
                throw new Error(`GitHub API error: ${response.statusCode}`);
            }

            return response;

        } catch (error) {
            lastError = error;

            if (attempt < retries) {
                const delay = CONFIG.BASE_RETRY_DELAY * Math.pow(2, attempt);
                console.log(`   Retry ${attempt + 1}/${retries} after ${delay}ms...`);
                await sleep(delay);
            }
        }
    }

    throw lastError;
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch repository file tree from GitHub API
 */
async function fetchFileTree(owner, repo, branch = 'HEAD') {
    console.log(`   Fetching file tree for ${owner}/${repo}...`);

    // First, get the default branch if not specified
    let targetBranch = branch;
    if (branch === 'HEAD') {
        const repoResponse = await requestWithRetry(
            `https://api.github.com/repos/${owner}/${repo}`
        );
        const repoData = JSON.parse(repoResponse.data);
        targetBranch = repoData.default_branch || 'main';
    }

    // Fetch the tree recursively
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${targetBranch}?recursive=1`;
    const treeResponse = await requestWithRetry(treeUrl);

    if (treeResponse.statusCode !== 200) {
        throw new Error(`Failed to fetch file tree: ${treeResponse.statusCode}`);
    }

    const treeData = JSON.parse(treeResponse.data);

    if (treeData.truncated) {
        console.log('   Warning: Repository is very large, file tree was truncated');
    }

    return {
        branch: targetBranch,
        tree: treeData.tree || [],
        truncated: treeData.truncated
    };
}

/**
 * Filter files based on configuration
 */
function filterFiles(tree) {
    const files = [];

    for (const item of tree) {
        // Skip if not a file (blob)
        if (item.type !== 'blob') continue;

        const filePath = item.path;
        const fileName = path.basename(filePath).toLowerCase();
        const ext = path.extname(filePath).toLowerCase();
        const dirParts = path.dirname(filePath).split('/');

        // Skip if file is too large (GitHub API provides size)
        if (item.size && item.size > CONFIG.MAX_FILE_SIZE) {
            continue;
        }

        // Skip files in ignored directories
        if (dirParts.some(dir => CONFIG.SKIP_DIRS.has(dir.toLowerCase()))) {
            continue;
        }

        // Skip binary/media files
        if (CONFIG.SKIP_EXTENSIONS.has(ext)) {
            continue;
        }

        // Include config files always
        if (CONFIG.CONFIG_FILES.has(fileName)) {
            files.push(item);
            continue;
        }

        // Include only allowed extensions for analysis
        if (CONFIG.ALLOWED_EXTENSIONS.has(ext)) {
            files.push(item);
            continue;
        }

        // Include some other useful files (YAML configs, shell scripts)
        if (['.yml', '.yaml', '.json', '.md', '.sh', '.bash'].includes(ext)) {
            files.push(item);
        }
    }

    // Sort by size (smallest first) and limit total files
    files.sort((a, b) => (a.size || 0) - (b.size || 0));

    if (files.length > CONFIG.MAX_FILES) {
        console.log(`   Limiting analysis to ${CONFIG.MAX_FILES} files (repo has ${files.length} matching files)`);
        return files.slice(0, CONFIG.MAX_FILES);
    }

    return files;
}

/**
 * Download a single file from raw.githubusercontent.com
 */
async function downloadFile(owner, repo, branch, filePath, destPath) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`;

    try {
        const response = await requestWithRetry(url, { timeout: 15000 });

        if (response.statusCode === 200) {
            // Ensure directory exists
            const dir = path.dirname(destPath);
            await fs.mkdir(dir, { recursive: true });

            // Write file
            await fs.writeFile(destPath, response.data, 'utf-8');
            return true;
        }

        return false;
    } catch (error) {
        // Silently skip files that fail to download
        return false;
    }
}

/**
 * Download files in batches with concurrency control
 */
async function downloadFilesInBatches(owner, repo, branch, files, destDir) {
    const totalFiles = files.length;
    let downloaded = 0;
    let failed = 0;

    // Process in batches
    for (let i = 0; i < files.length; i += CONFIG.BATCH_SIZE) {
        const batch = files.slice(i, i + CONFIG.BATCH_SIZE);

        const promises = batch.map(async (file) => {
            const destPath = path.join(destDir, file.path);
            const success = await downloadFile(owner, repo, branch, file.path, destPath);

            if (success) {
                downloaded++;
            } else {
                failed++;
            }
        });

        await Promise.all(promises);

        // Progress update every 50 files
        if (downloaded % 50 === 0 || i + CONFIG.BATCH_SIZE >= files.length) {
            console.log(`   Downloaded ${downloaded}/${totalFiles} files...`);
        }
    }

    return { downloaded, failed };
}

/**
 * Main function: Fetch repository using GitHub API
 */
async function fetchRepository(repoUrl) {
    const startTime = Date.now();
    const repoId = uuidv4();
    const destDir = path.join(TEMP_DIR, repoId);

    // Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(repoUrl);
    console.log(`   Repository: ${owner}/${repo}`);

    // Ensure temp directory exists
    await fs.mkdir(destDir, { recursive: true });

    try {
        // Set up timeout for entire operation
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error(`Repository fetch timed out after ${CONFIG.TOTAL_TIMEOUT / 1000}s`));
            }, CONFIG.TOTAL_TIMEOUT);
        });

        const fetchPromise = (async () => {
            // Fetch file tree
            const { branch, tree, truncated } = await fetchFileTree(owner, repo);
            console.log(`   Branch: ${branch}, Total items in tree: ${tree.length}`);

            // Filter files
            const filesToDownload = filterFiles(tree);
            console.log(`   Files to download: ${filesToDownload.length}`);

            if (filesToDownload.length === 0) {
                throw new Error('No analyzable files found in repository');
            }

            // Download files
            const { downloaded, failed } = await downloadFilesInBatches(
                owner, repo, branch, filesToDownload, destDir
            );

            const elapsed = Math.round((Date.now() - startTime) / 1000);
            console.log(`   Completed: ${downloaded} files downloaded, ${failed} failed (${elapsed}s)`);

            return {
                path: destDir,
                repoId,
                owner,
                repo,
                branch,
                stats: {
                    totalFiles: filesToDownload.length,
                    downloaded,
                    failed,
                    truncated,
                    elapsedSeconds: elapsed
                }
            };
        })();

        // Race between fetch and timeout
        return await Promise.race([fetchPromise, timeoutPromise]);

    } catch (error) {
        // Clean up on error
        try {
            await fs.rm(destDir, { recursive: true, force: true });
        } catch (e) {
            // Ignore cleanup errors
        }
        throw error;
    }
}

/**
 * Clean up downloaded repository
 */
async function cleanupRepository(repoPath) {
    try {
        await fs.rm(repoPath, { recursive: true, force: true });
    } catch (e) {
        console.error('Cleanup error:', e.message);
    }
}

/**
 * Check GitHub API rate limit status
 */
async function checkRateLimit() {
    try {
        const response = await httpsRequest('https://api.github.com/rate_limit');
        const data = JSON.parse(response.data);
        return {
            remaining: data.resources.core.remaining,
            limit: data.resources.core.limit,
            reset: new Date(data.resources.core.reset * 1000).toISOString()
        };
    } catch (error) {
        return { error: error.message };
    }
}

module.exports = {
    fetchRepository,
    cleanupRepository,
    parseGitHubUrl,
    checkRateLimit,
    CONFIG
};
