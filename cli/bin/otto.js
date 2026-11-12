#!/usr/bin/env node
import { program } from 'commander'
import { writeFileSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'
import path from 'node:path'

const DEFAULT_OTTO_URL = 'https://guide-carve-stout.ngrok-free.dev'
const DEFAULT_OTTO_TOKEN = 'FUYkX4XKMVnqtdTUu0LGYFMoBep5s8qo4MNHscibYOU='

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
          OTTO_API_URL: \${{ secrets.OTTO_API_URL || secrets.OTTO_URL || '${DEFAULT_OTTO_URL}' }}
          OTTO_TOKEN: \${{ secrets.OTTO_TOKEN || secrets.OTTO_API_TOKEN || '${DEFAULT_OTTO_TOKEN}' }}
          OTTO_REPO_ID: \${{ secrets.OTTO_REPO_ID }}
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
        run: |
          TOKEN="\${OTTO_TOKEN:-${DEFAULT_OTTO_TOKEN}}"
          API_URL="\${OTTO_API_URL:-${DEFAULT_OTTO_URL}}"

          API_URL="\${API_URL%/}"
          PR_NUMBER=""
          COMMIT_SHA="\${{ github.sha }}"

          if [ "\${{ github.event_name }}" = "pull_request" ]; then
            PR_NUMBER="\${{ github.event.pull_request.number }}"
            COMMIT_SHA="\${{ github.event.pull_request.head.sha }}"
          fi

          if [ -n "$OTTO_REPO_ID" ]; then
            ENDPOINT="$API_URL/repos/$OTTO_REPO_ID/scan"
            PAYLOAD="{}"
          else
            ENDPOINT="$API_URL/scan"
            PAYLOAD="{\\"repoFullName\\":\\"\${{ github.repository }}\\",\\"commitSha\\":\\"$COMMIT_SHA\\",\\"prNumber\\":\${PR_NUMBER:-null},\\"ref\\":\\"\${{ github.ref }}\\"}"
          fi

          RESPONSE=\$(curl -s -w "\\n%{http_code}" -X POST "\$ENDPOINT" \\
            -H "Authorization: Bearer \$TOKEN" \\
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

          echo "\$BODY" > scan_response.json

          STATUS=\$(jq -r '.status // "unknown"' scan_response.json 2>/dev/null || echo "unknown")
          SERIOUS=\$(jq -r '.counts.serious // 0' scan_response.json 2>/dev/null || echo "0")
          MINOR=\$(jq -r '.counts.minor // 0' scan_response.json 2>/dev/null || echo "0")

          echo "### Otto Security Scan" >> "\$GITHUB_STEP_SUMMARY"
          echo "" >> "\$GITHUB_STEP_SUMMARY"
          echo "- **Status:** \$STATUS" >> "\$GITHUB_STEP_SUMMARY"
          echo "- **Serious Issues:** \$SERIOUS" >> "\$GITHUB_STEP_SUMMARY"
          echo "- **Minor Issues:** \$MINOR" >> "\$GITHUB_STEP_SUMMARY"

          # Automatically post comment to Pull Request if triggered by a PR
          if [ -n "$PR_NUMBER" ] && [ -f scan_response.json ]; then
            COMMENT_FILE="pr_comment.md"
            echo "## Otto Security Scan" > "\$COMMENT_FILE"
            echo "" >> "\$COMMENT_FILE"
            echo "**Commit:** \`\$COMMIT_SHA\`" >> "\$COMMENT_FILE"
            echo "**Status:** \$STATUS (\$SERIOUS serious, \$MINOR minor vulnerabilities)" >> "\$COMMENT_FILE"
            echo "" >> "\$COMMENT_FILE"

            if [ "\$STATUS" = "fail" ]; then
              echo "### Detected Vulnerabilities" >> "\$COMMENT_FILE"
              echo "| Severity | File | Issue | Fix |" >> "\$COMMENT_FILE"
              echo "|---|---|---|---|" >> "\$COMMENT_FILE"
              jq -r '.findings[]? | "| **" + (.severity|ascii_upcase) + "** | \`" + .file + (if .line then ":" + (.line|tostring) else "" end) + "\` | " + (.title // .comment) + " | " + (.fix // "—") + " |"' scan_response.json >> "\$COMMENT_FILE" 2>/dev/null || true
              echo "" >> "\$COMMENT_FILE"
            elif [ "\$STATUS" = "pass" ]; then
              echo "✅ **All security checks passed! No vulnerabilities detected.**" >> "\$COMMENT_FILE"
            fi

            gh pr comment "\$PR_NUMBER" --body-file "\$COMMENT_FILE" 2>/dev/null || true
          fi

          if [ "\$STATUS" = "fail" ]; then
            echo "::error::Otto detected \$SERIOUS serious and \$MINOR minor vulnerabilities."
            jq . scan_response.json 2>/dev/null || echo "\$BODY"
            exit 1
          elif [ "\$STATUS" = "error" ]; then
            echo "::error::Otto scan encountered an error."
            jq . scan_response.json 2>/dev/null || echo "\$BODY"
            exit 1
          fi

          echo "Otto scan passed: 0 vulnerabilities found."
`
}

program
  .name('otto')
  .description('Otto security scanner CLI')
  .version('0.1.0')
  .option('-u, --url <url>', 'Otto API base URL', process.env.OTTO_API_URL || process.env.OTTO_URL || DEFAULT_OTTO_URL)
  .option('-t, --token <token>', 'Otto JWT authentication token', process.env.OTTO_TOKEN || process.env.OTTO_API_TOKEN || DEFAULT_OTTO_TOKEN)

program
  .command('scan')
  .description('Ingest and scan a repository for security vulnerabilities')
  .argument('[repo]', 'Git repository URL (defaults to remote origin of current git directory)')
  .option('-b, --branch <branch>', 'Branch name to scan')
  .option('--json', 'Output raw JSON scan findings')
  .action(async (repoArg, cmdOpts) => {
    const globalOpts = program.opts()
    const apiUrl = globalOpts.url || DEFAULT_OTTO_URL
    const token = globalOpts.token || DEFAULT_OTTO_TOKEN

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
  .command('setup [filename]')
  .description('Generate GitHub Actions CI workflow file for Otto scanning')
  .option('-e, --environment <env>', 'Environment name (dev, staging, production, etc.)', 'production')
  .option('-b, --branch <branch>', 'Branch name trigger for workflow')
  .option('-o, --output <path>', 'Destination path for workflow file')
  .option('-n, --name <name>', 'Workflow filename (e.g. production.yml)')
  .option('--stdout', 'Print generated workflow directly to stdout without writing to disk')
  .action((filenameArg, cmdOpts) => {
    const env = cmdOpts.environment || 'production'
    const content = buildWorkflowTemplate(env, cmdOpts.branch)

    if (cmdOpts.stdout) {
      process.stdout.write(content)
      return
    }

    let targetFile
    if (cmdOpts.output) {
      targetFile = path.resolve(cmdOpts.output)
    } else {
      const rawName = filenameArg || cmdOpts.name || `${env}.yml`
      const fileName = rawName.endsWith('.yml') || rawName.endsWith('.yaml') ? rawName : `${rawName}.yml`
      targetFile = path.resolve('.github', 'workflows', fileName)
    }

    mkdirSync(path.dirname(targetFile), { recursive: true })
    writeFileSync(targetFile, content, 'utf8')

    console.log(`[OK] Generated workflow at ${path.relative(process.cwd(), targetFile) || targetFile}`)
    console.log()
    console.log('Pre-configured by default. Ready to scan immediately without setting secrets!')
    console.log('(Optional overrides via Settings -> Secrets and variables -> Actions):')
    console.log(`  OTTO_API_URL    Default: ${DEFAULT_OTTO_URL}`)
    console.log(`  OTTO_TOKEN      Default: ${DEFAULT_OTTO_TOKEN.slice(0, 10)}...`)
    console.log('  OTTO_REPO_ID    (Optional) Repository ID from Otto dashboard')
  })

program.parse()
