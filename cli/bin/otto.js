#!/usr/bin/env node
import { program } from 'commander'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

function getLocalGitRemote() {
  try {
    return execSync('git config --get remote.origin.url', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

function getLocalGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

async function api(baseUrl, token, method, apiPath, body) {
  const url = `${baseUrl.replace(/\/+$/, '')}${apiPath}`
  const headers = {
    'Content-Type': 'application/json',
    'ngrok-skip-browser-warning': 'true',
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(url, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const errorMsg = data?.error || `API returned HTTP ${res.status}`
    throw new Error(errorMsg)
  }
  return data
}

function buildWorkflowTemplate(env, branch) {
  const targetBranch = branch || (env === 'production' ? 'main' : env)
  return `name: Otto Security Scan (${env})

on:
  push:
    branches: [${targetBranch}]
  pull_request:
    branches: [${targetBranch}]

permissions:
  contents: read
  pull-requests: write

jobs:
  otto-scan:
    name: Security Scan
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Run Otto scan
        env:
          OTTO_API_URL: \${{ secrets.OTTO_API_URL }}
          OTTO_TOKEN: \${{ secrets.OTTO_TOKEN }}
          OTTO_REPO_ID: \${{ secrets.OTTO_REPO_ID }}
        run: |
          if [ -z "$OTTO_API_URL" ] || [ -z "$OTTO_TOKEN" ]; then
            echo "::error::Missing OTTO_API_URL or OTTO_TOKEN in repository secrets."
            exit 1
          fi

          API_URL="\${OTTO_API_URL%/}"
          PR_NUMBER=""
          if [ "\${{ github.event_name }}" = "pull_request" ]; then
            PR_NUMBER="\${{ github.event.pull_request.number }}"
          fi

          if [ -n "$OTTO_REPO_ID" ]; then
            ENDPOINT="$API_URL/repos/$OTTO_REPO_ID/scan"
            PAYLOAD="{}"
          else
            ENDPOINT="$API_URL/scan"
            PAYLOAD="{\\"repoFullName\\":\\"\${{ github.repository }}\\",\\"commitSha\\":\\"\${{ github.sha }}\\",\\"prNumber\\":\${PR_NUMBER:-null},\\"ref\\":\\"\${{ github.ref }}\\"}"
          fi

          RESPONSE=\$(curl -s -w "\\n%{http_code}" -X POST "\$ENDPOINT" \\
            -H "Authorization: Bearer \$OTTO_TOKEN" \\
            -H "Content-Type: application/json" \\
            -H "ngrok-skip-browser-warning: true" \\
            -d "\$PAYLOAD")

          HTTP_CODE=\$(echo "\$RESPONSE" | tail -n1)
          BODY=\$(echo "\$RESPONSE" | sed '\$d')

          if [ "\$HTTP_CODE" -ge 400 ] || [ "\$HTTP_CODE" -eq 0 ]; then
            echo "::error::Otto scan request failed with HTTP \$HTTP_CODE"
            echo "\$BODY"
            exit 1
          fi

          STATUS=\$(echo "\$BODY" | jq -r '.status // empty' 2>/dev/null || echo "unknown")
          if [ "\$STATUS" = "fail" ]; then
            echo "::error::Otto detected security vulnerabilities."
            echo "\$BODY" | jq . 2>/dev/null || echo "\$BODY"
            exit 1
          elif [ "\$STATUS" = "error" ]; then
            echo "::error::Otto scan encountered an internal error."
            echo "\$BODY" | jq . 2>/dev/null || echo "\$BODY"
            exit 1
          fi

          echo "Otto scan passed: no vulnerabilities detected."
`
}

program
  .name('otto')
  .description('Otto security scanner CLI')
  .version('0.1.0')
  .option('-u, --url <url>', 'Otto API base URL', process.env.OTTO_API_URL || 'http://localhost:4000')
  .option('-t, --token <token>', 'Otto JWT authentication token', process.env.OTTO_TOKEN || '')

program
  .command('scan')
  .description('Ingest and scan a repository for security vulnerabilities')
  .argument('[repo]', 'Git repository URL (defaults to remote origin of current git directory)')
  .option('-b, --branch <branch>', 'Branch name to scan')
  .option('--json', 'Output raw JSON scan findings')
  .action(async (repoArg, cmdOpts) => {
    const globalOpts = program.opts()
    const apiUrl = globalOpts.url
    const token = globalOpts.token

    if (!token) {
      console.error('Error: OTTO_TOKEN is required. Set OTTO_TOKEN environment variable or pass --token <jwt>.')
      process.exit(1)
    }

    const repoUrl = repoArg || getLocalGitRemote()
    if (!repoUrl) {
      console.error('Error: No repository URL provided and no remote origin detected in current git repository.')
      console.error('Usage: otto scan <repo-url>')
      process.exit(1)
    }

    const branch = cmdOpts.branch || getLocalGitBranch() || 'HEAD'

    try {
      if (!cmdOpts.json) {
        console.log(`[INFO] Ingesting repository: ${repoUrl} (branch: ${branch})`)
      }
      const setup = await api(apiUrl, token, 'POST', '/setup', { url: repoUrl, branch })

      if (!cmdOpts.json) {
        console.log(`[OK] Ingested ${setup.filesIngested} files (commit ${setup.commit.slice(0, 7)})`)
        console.log('[INFO] Running vulnerability scan...')
      }

      const result = await api(apiUrl, token, 'POST', `/repos/${setup.id}/scan`)

      if (cmdOpts.json) {
        console.log(JSON.stringify(result, null, 2))
        if (result.status === 'fail' || result.status === 'error') {
          process.exit(1)
        }
        return
      }

      if (result.status === 'pass') {
        console.log('[OK] Scan passed: 0 vulnerabilities found.')
      } else if (result.status === 'fail') {
        const findings = result.findings ?? []
        console.log(`[FAIL] Found ${findings.length} issue(s):\n`)
        for (const f of findings) {
          const sev = (f.severity || 'minor').toUpperCase()
          console.log(`  [${sev}] ${f.file}${f.line ? `:${f.line}` : ''}`)
          if (f.title) console.log(`    Title: ${f.title}`)
          if (f.ruleId) console.log(`    Rule:  ${f.ruleId}`)
          console.log(`    Note:  ${f.comment}`)
          if (f.fix) console.log(`    Fix:   ${f.fix}`)
          console.log()
        }
        process.exit(1)
      } else {
        console.error(`[ERROR] Scan error: ${result.error || result.logs || 'unknown failure'}`)
        process.exit(1)
      }
    } catch (err) {
      console.error(`[ERROR] ${err.message}`)
      process.exit(1)
    }
  })

program
  .command('setup')
  .description('Generate GitHub Actions CI workflow file for Otto scanning')
  .option('-e, --environment <env>', 'Environment name (dev, staging, production, etc.)', 'production')
  .option('-b, --branch <branch>', 'Branch name trigger for workflow')
  .option('-o, --output <path>', 'Destination path for workflow file')
  .option('--stdout', 'Print generated workflow directly to stdout without writing to disk')
  .action((cmdOpts) => {
    const env = cmdOpts.environment
    const content = buildWorkflowTemplate(env, cmdOpts.branch)

    if (cmdOpts.stdout) {
      process.stdout.write(content)
      return
    }

    const defaultDir = path.resolve('.github', 'workflows')
    const defaultFile = path.join(defaultDir, `otto-${env}.yml`)
    const targetFile = cmdOpts.output ? path.resolve(cmdOpts.output) : defaultFile

    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, content, 'utf8')

    console.log(`[OK] Generated workflow at ${path.relative(process.cwd(), targetFile) || targetFile}`)
    console.log()
    console.log('Required repository secrets (Settings -> Secrets and variables -> Actions):')
    console.log('  OTTO_API_URL    Base URL of your Otto server (e.g. https://api.otto.security)')
    console.log('  OTTO_TOKEN      Otto JWT authentication token')
    console.log('  OTTO_REPO_ID    (Optional) Repository ID from Otto dashboard')
  })

program.parse()
