const fs = require('fs').promises;
const path = require('path');

// File extensions to language mapping
const EXTENSION_MAP = {
    '.py': 'Python',
    '.pyw': 'Python',
    '.js': 'JavaScript',
    '.jsx': 'JavaScript',
    '.ts': 'TypeScript',
    '.tsx': 'TypeScript',
    '.cpp': 'C++',
    '.cc': 'C++',
    '.cxx': 'C++',
    '.c': 'C',
    '.h': 'C/C++ Header',
    '.hpp': 'C++ Header',
    '.java': 'Java',
    '.go': 'Go',
    '.rs': 'Rust',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.cs': 'C#',
    '.swift': 'Swift',
    '.kt': 'Kotlin',
    '.scala': 'Scala',
    '.r': 'R',
    '.R': 'R',
    '.m': 'MATLAB/Objective-C',
    '.sql': 'SQL',
    '.sh': 'Shell',
    '.bash': 'Shell',
    '.zsh': 'Shell',
    '.ps1': 'PowerShell',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
    '.sass': 'Sass',
    '.less': 'Less',
    '.json': 'JSON',
    '.xml': 'XML',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.md': 'Markdown',
    '.vue': 'Vue',
    '.svelte': 'Svelte'
};

// Directories to ignore
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '__pycache__', '.venv', 'venv',
    'env', '.env', 'dist', 'build', 'target', '.idea',
    '.vscode', 'vendor', 'packages', '.next', '.nuxt',
    'coverage', '.nyc_output', 'bower_components'
]);

async function detectLanguages(repoPath) {
    const stats = {};
    
    await walkDirectory(repoPath, async (filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        const language = EXTENSION_MAP[ext];
        
        if (language) {
            if (!stats[language]) {
                stats[language] = {
                    files: 0,
                    lines: 0,
                    bytes: 0
                };
            }
            
            try {
                const content = await fs.readFile(filePath, 'utf-8');
                const fileStats = await fs.stat(filePath);
                
                stats[language].files++;
                stats[language].lines += content.split('\n').length;
                stats[language].bytes += fileStats.size;
            } catch (e) {
                // Skip binary or unreadable files
                stats[language].files++;
            }
        }
    });
    
    // Calculate percentages and identify primary languages
    const totalLines = Object.values(stats).reduce((sum, s) => sum + s.lines, 0);
    const totalFiles = Object.values(stats).reduce((sum, s) => sum + s.files, 0);
    
    const result = {
        primary: null,
        breakdown: {},
        totalFiles,
        totalLines
    };
    
    let maxLines = 0;
    
    for (const [lang, data] of Object.entries(stats)) {
        const percentage = totalLines > 0 ? Math.round((data.lines / totalLines) * 100) : 0;
        result.breakdown[lang] = {
            ...data,
            percentage
        };
        
        if (data.lines > maxLines) {
            maxLines = data.lines;
            result.primary = lang;
        }
    }
    
    // Sort breakdown by lines (descending)
    result.breakdown = Object.fromEntries(
        Object.entries(result.breakdown)
            .sort(([,a], [,b]) => b.lines - a.lines)
    );
    
    return result;
}

async function walkDirectory(dir, callback) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                await walkDirectory(fullPath, callback);
            }
        } else if (entry.isFile()) {
            await callback(fullPath);
        }
    }
}

module.exports = { detectLanguages, EXTENSION_MAP, IGNORE_DIRS, walkDirectory };
