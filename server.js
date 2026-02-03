const express = require('express');
const cors = require('cors');
const path = require('path');
const { analyzeRepo } = require('./src/ingestion');
const { checkRateLimit } = require('./src/githubFetcher');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Main analysis endpoint
app.post('/api/analyze', async (req, res) => {
    const { repoUrl } = req.body;

    if (!repoUrl) {
        return res.status(400).json({ error: 'Repository URL is required' });
    }

    // Validate GitHub URL
    const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
    if (!githubRegex.test(repoUrl)) {
        return res.status(400).json({ error: 'Invalid GitHub repository URL' });
    }

    try {
        console.log(`\n[${new Date().toISOString()}] Analyzing: ${repoUrl}`);
        const result = await analyzeRepo(repoUrl);
        res.json(result);
    } catch (error) {
        console.error('Analysis error:', error);

        // Provide user-friendly error messages
        let errorMessage = error.message || 'Analysis failed';

        if (errorMessage.includes('rate limit')) {
            return res.status(429).json({
                error: 'GitHub API rate limit exceeded',
                message: errorMessage,
                suggestion: 'Please try again later or check /api/rate-limit for reset time'
            });
        }

        if (errorMessage.includes('not found') || errorMessage.includes('private')) {
            return res.status(404).json({
                error: 'Repository not found',
                message: 'The repository does not exist or is private'
            });
        }

        res.status(500).json({ error: errorMessage });
    }
});

// GitHub API rate limit status
app.get('/api/rate-limit', async (req, res) => {
    try {
        const rateLimit = await checkRateLimit();
        res.json({
            status: 'ok',
            rateLimit,
            message: rateLimit.remaining > 0
                ? `${rateLimit.remaining} API requests remaining`
                : `Rate limit exceeded. Resets at ${rateLimit.reset}`
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to check rate limit' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: '1.1.0',
        features: ['GitHub API fetching', 'No git dependency required']
    });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  PROOF-CHECK SERVER v1.1.0`);
    console.log(`  Running on http://localhost:${PORT}`);
    console.log(`  Using GitHub API (no git required)`);
    console.log(`========================================\n`);
});
