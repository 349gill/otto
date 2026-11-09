#!/usr/bin/env node
import { program } from 'commander'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const API = 'https://guide-carve-stout.ngrok-free.dev'
const TOKEN = 'FUYkX4XKMVnqtdTUu0LGYFMoBep5s8qo4MNHscibYOU='

// ── helpers ──────────────────────────────────────────────────────────

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.error(`✗ ${data?.error ?? `API returned ${res.status}`}`)
    process.exit(1)
  }
  return data
}

function workflow(env) {
  const branch = env === 'production' ? 'main' : env
  return `name: Otto Scan (${env})

on:
  push:
    branches: [${branch}]
  pull_request:
    branches: [${branch}]

jobs:
  otto-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Otto scan
        env:
          OTTO_API_URL: \${{ secrets.OTTO_API_URL }}
          OTTO_TOKEN: \${{ secrets.OTTO_TOKEN }}
          OTTO_REPO_ID: \${{ secrets.OTTO_REPO_ID }}
        run: |
          RESULT=$(curl -s -w "\\n%{http_code}" -X POST "$OTTO_API_URL/repos/$OTTO_REPO_ID/scan" \\
            -H "Authorization: Bearer $OTTO_TOKEN" \\
            -H "Content-Type: application/json")

          HTTP_CODE=$(echo "$RESULT" | tail -1)
          BODY=$(echo "$RESULT" | sed '$ d')

          echo "$BODY" | jq .

          STATUS=$(echo "$BODY" | jq -r '.status // empty')
          if [ "$STATUS" = "fail" ]; then
            echo "::error::Otto found vulnerabilities"
            exit 1
          elif [ "$STATUS" = "error" ]; then
            echo "::error::Otto scan errored"
            exit 1
          fi

          echo "✓ Otto scan passed"
`
}

// ── commands ─────────────────────────────────────────────────────────

program.name('otto').description('Otto security scanner CLI').version('0.1.0')

program
  .command('scan')
  .argument('<repo>', 'GitHub/GitLab/Bitbucket repo URL')
  .description('Set up and scan a repository')
  .action(async (repo) => {
    if (!TOKEN) {
      console.error('✗ Set OTTO_TOKEN (JWT from GitHub OAuth sign-in)')
      process.exit(1)
    }

    console.log(`→ Ingesting ${repo}...`)
    const setup = await api('POST', '/setup', { url: repo })
    console.log(
      `✓ Ingested ${setup.filesIngested} files (${setup.commit.slice(0, 7)})`,
    )

    console.log(`→ Running scan...`)
    const result = await api('POST', `/repos/${setup.id}/scan`)

    if (result.status === 'pass') {
      console.log('✓ All clear — no vulnerabilities found')
    } else if (result.status === 'fail') {
      const findings = result.findings ?? []
      console.log(`✗ Found ${findings.length} issue(s):\n`)
      for (const f of findings) {
        const sev = f.severity === 'severe' ? '🔴' : '🟡'
        console.log(`  ${sev} ${f.file}${f.line ? `:${f.line}` : ''}`)
        console.log(`    ${f.comment}`)
        if (f.fix) console.log(`    Fix: ${f.fix}`)
        console.log()
      }
      process.exit(1)
    } else {
      console.error(`✗ Scan error: ${result.error ?? result.logs ?? 'unknown'}`)
      process.exit(1)
    }
  })

program
  .command('setup')
  .description('Generate GitHub Actions workflow files')
  .requiredOption(
    '-e, --environment <env>',
    'Environment name (dev, staging, production, etc.)',
  )
  .action(({ environment: env }) => {
    const dir = path.resolve('.github', 'workflows')
    const file = path.join(dir, `${env}.yml`)

    mkdirSync(dir, { recursive: true })
    writeFileSync(file, workflow(env))

    console.log(`✓ Created ${path.relative(process.cwd(), file)}`)
    console.log()
    console.log('  Add these secrets to your GitHub repo:')
    console.log('    OTTO_API_URL    → your Otto backend URL')
    console.log('    OTTO_TOKEN      → your JWT from GitHub OAuth sign-in')
    console.log('    OTTO_REPO_ID    → repo ID from the Otto dashboard')
  })

program.parse()
