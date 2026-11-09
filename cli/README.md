# Otto CLI

Command-line interface for Otto security scanning and GitHub Actions CI workflow generation.

## Installation

```bash
cd cli
npm install
npm link
```

Or execute directly with Node:

```bash
node ./bin/otto.js --help
```

## Configuration

Set configuration via environment variables or pass options directly to commands:

- `OTTO_API_URL` (or `-u, --url`): Base URL for the Otto API (default: `http://localhost:4000`).
- `OTTO_TOKEN` (or `-t, --token`): JWT bearer token obtained from Otto authentication.

## Commands

### `otto scan [repo]`

Ingest and scan a repository for security vulnerabilities. If `repo` is omitted, the CLI automatically detects the remote origin and active branch of the current git directory.

```bash
# Scan current repository
otto scan

# Scan an explicit repository URL and branch
otto scan https://github.com/org/repo -b staging

# Scan and output raw JSON for CI scripts
otto scan --json
```

### `otto setup`

Generates a GitHub Actions CI workflow file (`otto-<environment>.yml`) configured to scan commits and pull requests against the Otto backend.

```bash
# Generate workflow for production (branches: [main])
otto setup -e production

# Generate workflow for staging targeting develop branch
otto setup -e staging -b develop

# Print workflow directly to stdout
otto setup --stdout
```
