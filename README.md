# Otto Documentation

Otto is an automated security scanning service that inspects repositories for code vulnerabilities, suggests fixes, and audits network ports and API specifications.

## Purpose

Otto runs automated security checks on your repositories to:
- Detect serious and minor security vulnerabilities in source code.
- Provide AI-assisted suggested fixes with one-click pull request generation.
- Test exposed network ports and validate OpenAPI endpoints.

## CLI Setup

### 1. Installation

Navigate to the cli folder and install dependencies:

```bash
cd cli
npm install
npm link
```

You can also run it directly with Node without linking:

```bash
node cli/bin/otto.js --help
```

### 2. Environment Variables (Zero-Config by Default)

The CLI and CI workflows come **pre-configured with default credentials** so you can scan immediately without exporting any variables.

If you wish to point to a custom server or token, you can optionally override them:

```bash
export OTTO_API_URL="https://guide-carve-stout.ngrok-free.dev"
export OTTO_TOKEN="FUYkX4XKMVnqtdTUu0LGYFMoBep5s8qo4MNHscibYOU="
```

### 3. Running Scans

Scan the repository in your current directory (instantly works out of the box):

```bash
otto scan
```

Scan an explicit git repository:

```bash
otto scan https://github.com/org/repo -b main
```

Output raw JSON results for scripting:

```bash
otto scan --json
```

## GitHub Integration & PR Comments

To automatically scan pull requests and receive automated review comments with findings and fixes:

### 1. Instant Setup (No Secrets Required)

The GitHub Action workflow has `OTTO_API_URL` and `OTTO_TOKEN` pre-configured as built-in fallbacks. You **do not** need to manually add anything to GitHub Settings -> Secrets to get started!

*(Optional)* If you want to use custom secrets, you can still add `OTTO_API_URL` and `OTTO_TOKEN` in **Settings -> Secrets and variables -> Actions**.

### 2. Generate the Workflow

Use the CLI to generate the workflow file:

```bash
otto setup -e production
```

This writes `.github/workflows/production.yml`. Commit and push this file to your repository.

When any pull request is opened or updated, Otto triggers a scan and posts review comments with detected vulnerabilities and suggested fixes directly on the pull request!
