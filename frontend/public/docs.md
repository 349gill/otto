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

### 2. Environment Variables

Set your backend URL and authentication token:

```bash
export OTTO_API_URL="https://guide-carve-stout.ngrok-free.dev"
export OTTO_TOKEN="your-jwt-token"
```

You can obtain your token from the Otto dashboard session.

### 3. Running Scans

Scan the repository in your current directory:

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

### 1. Add Repository Secrets

In your GitHub repository, open Settings -> Secrets and variables -> Actions, then add:

- `OTTO_API_URL`: Your Otto backend instance URL (e.g. https://guide-carve-stout.ngrok-free.dev)
- `OTTO_TOKEN`: Your Otto JWT authentication token

### 2. Generate the Workflow

Use the CLI to generate the workflow file:

```bash
otto setup -e production
```

This writes `.github/workflows/production.yml`. Commit and push this file to your repository.

When any pull request is opened or updated, Otto triggers a scan and posts comments with detected vulnerabilities and suggested fixes directly on the pull request.
