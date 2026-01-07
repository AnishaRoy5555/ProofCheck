# ProofCheck 

A system that quantifies developer skill directly from code, replacing resumes and self-reported experience with measurable signals.

Unlike linters or CI tools that operate file-by-file, ProofCheck evaluates repositories holistically, combining architecture, testing discipline, language idioms, and maintainability into a unified assessment.

## Architecture
<img width="1280" height="720" alt="ProofCheck_Flowchart" src="https://github.com/user-attachments/assets/6da1e079-ea7f-4549-8e5e-b6f4912ee798" />

## What it Does

1. Takes a public GitHub repository URL
2. Clones and analyzes the codebase
3. Runs language-specific quality checks
4. Outputs a score with detailed breakdown

## Metrics Analyzed

### Project Level
- README quality and completeness
- Test suite presence
- CI/CD configuration
- License
- File structure organization
- Package manager usage

### Code Level (per language)

**Python:**
- Cyclomatic complexity (via radon)
- PEP8 style compliance (via pylint)
- Docstring coverage
- Comment ratio

**JavaScript/TypeScript:**
- Complexity analysis
- Modern patterns (ES modules, async/await, TypeScript)
- Linter/formatter configuration
- Framework detection

**C++:**
- Memory management patterns (smart pointers vs raw)
- Modern C++ features (C++11+)
- Header guards
- Build system presence
- STL usage

## Setup

### Prerequisites

```bash
node --version    # v18+
npm --version
git --version
python --version  # 3.8+
```

Install Python tools:
```bash
pip install pylint radon
```

### Install & Run

```bash
# Clone or download this project
cd proof-check

# Install dependencies
npm install

# Start server
npm start
```

Open http://localhost:3000 in your browser.

## Project Structure

```
proof-check/
├── server.js                 # Express server
├── public/
│   └── index.html            # Frontend UI
└── src/
    ├── ingestion.js          # Clone & orchestrate analysis
    ├── languageDetector.js   # Detect languages in repo
    ├── projectAnalyzer.js    # Project-level metrics
    ├── router.js             # Route to language analyzers
    └── analyzers/
        ├── pythonAnalyzer.js
        ├── javascriptAnalyzer.js
        └── cppAnalyzer.js
```

## Deployment

### Manual VPS
```bash
npm install --production
PORT=3000 node server.js
```

## Extending

Add a new language analyzer:

1. Create `src/analyzers/newLanguageAnalyzer.js`
2. Export `analyzeNewLanguage(repoPath)` function
3. Add to `ANALYZERS` map in `src/router.js`
4. Add language extensions to `src/languageDetector.js`

## Limitations

- Only works with public GitHub repositories
- Large repositories may fail on Windows due to path length limits
- Currently supports Python, JavaScript/TypeScript, and C++ only
- Analysis depth is limited compared to enterprise tools like SonarQube

## License

This project is not open source. All rights reserved.  
For inquiries, contact [roy.anisha2006@gmail.com].
