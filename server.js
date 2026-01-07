const express = require('express');
const cors = require('cors');
const path = require('path');
const { analyzeRepo } = require('./src/ingestion');

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
        res.status(500).json({ error: error.message || 'Analysis failed' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`  PROOF-CHECK SERVER`);
    console.log(`  Running on http://localhost:${PORT}`);
    console.log(`========================================\n`);
});
