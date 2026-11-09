"use client";

import { useEffect, useState, type ReactNode } from "react";

const FALLBACK_DOCS = `# Otto Documentation

Otto is an automated security scanning service that inspects repositories for code vulnerabilities, suggests fixes, and audits network ports and API specifications.

## Purpose

Otto runs automated security checks on your repositories to:
- Detect serious and minor security vulnerabilities in source code.
- Provide AI-assisted suggested fixes with one-click pull request generation.
- Test exposed network ports and validate OpenAPI endpoints.

## CLI Setup

### 1. Installation

Navigate to the cli folder and install dependencies:

\`\`\`bash
cd cli
npm install
npm link
\`\`\`

You can also run it directly with Node without linking:

\`\`\`bash
node cli/bin/otto.js --help
\`\`\`

### 2. Environment Variables (Zero-Config by Default)

The CLI and CI workflows come **pre-configured with default credentials** so you can scan immediately without exporting any variables.

If you wish to point to a custom server or token, you can optionally override them:

\`\`\`bash
export OTTO_API_URL="https://guide-carve-stout.ngrok-free.dev"
export OTTO_TOKEN="FUYkX4XKMVnqtdTUu0LGYFMoBep5s8qo4MNHscibYOU="
\`\`\`

### 3. Running Scans

Scan the repository in your current directory (instantly works out of the box):

\`\`\`bash
otto scan
\`\`\`

Scan an explicit git repository:

\`\`\`bash
otto scan https://github.com/org/repo -b main
\`\`\`

Output raw JSON results for scripting:

\`\`\`bash
otto scan --json
\`\`\`

## GitHub Integration & PR Comments

To automatically scan pull requests and receive automated review comments with findings and fixes:

### 1. Instant Setup (No Secrets Required)

The GitHub Action workflow has \`OTTO_API_URL\` and \`OTTO_TOKEN\` pre-configured as built-in fallbacks. You **do not** need to manually add anything to GitHub Settings -> Secrets to get started!

*(Optional)* If you want to use custom secrets, you can still add \`OTTO_API_URL\` and \`OTTO_TOKEN\` in **Settings -> Secrets and variables -> Actions**.

### 2. Generate the Workflow

Use the CLI to generate the workflow file:

\`\`\`bash
otto setup -e production
\`\`\`

This writes \`.github/workflows/production.yml\`. Commit and push this file to your repository.

When any pull request is opened or updated, Otto triggers a scan and posts comments with detected vulnerabilities and suggested fixes directly on the pull request.
`;

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`(.*)$/);
    if (codeMatch) {
      if (codeMatch[1]) parts.push(codeMatch[1]);
      parts.push(<code key={key++}>{codeMatch[2]}</code>);
      remaining = codeMatch[3];
      continue;
    }

    const linkMatch = remaining.match(/^(.*?)\[([^\]]+)\]\(([^)]+)\)(.*)$/);
    if (linkMatch) {
      if (linkMatch[1]) parts.push(linkMatch[1]);
      parts.push(
        <a key={key++} href={linkMatch[3]} target="_blank" rel="noopener noreferrer">
          {linkMatch[2]}
        </a>
      );
      remaining = linkMatch[4];
      continue;
    }

    parts.push(remaining);
    break;
  }

  return parts;
}

function renderMarkdown(md: string): ReactNode[] {
  const lines = md.split("\n");
  const nodes: ReactNode[] = [];
  let inCode = false;
  const codeBuffer: string[] = [];
  let listBuffer: string[] = [];

  function flushList() {
    if (listBuffer.length > 0) {
      nodes.push(
        <ul key={`ul-${nodes.length}`}>
          {listBuffer.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listBuffer = [];
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("```")) {
      flushList();
      if (inCode) {
        nodes.push(
          <pre key={`code-${nodes.length}`}>
            <code>{codeBuffer.join("\n")}</code>
          </pre>
        );
        codeBuffer.length = 0;
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (line.startsWith("### ")) {
      flushList();
      nodes.push(<h3 key={`h3-${nodes.length}`}>{renderInline(line.slice(4))}</h3>);
    } else if (line.startsWith("## ")) {
      flushList();
      nodes.push(<h2 key={`h2-${nodes.length}`}>{renderInline(line.slice(3))}</h2>);
    } else if (line.startsWith("# ")) {
      flushList();
      nodes.push(<h1 key={`h1-${nodes.length}`}>{renderInline(line.slice(2))}</h1>);
    } else if (line.startsWith("- ")) {
      listBuffer.push(line.slice(2));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      nodes.push(<p key={`p-${nodes.length}`}>{renderInline(line)}</p>);
    }
  }

  flushList();
  if (inCode && codeBuffer.length > 0) {
    nodes.push(
      <pre key={`code-${nodes.length}`}>
        <code>{codeBuffer.join("\n")}</code>
      </pre>
    );
  }

  return nodes;
}

export default function DocsView() {
  const [content, setContent] = useState(FALLBACK_DOCS);

  useEffect(() => {
    fetch("/README.md")
      .then((res) => {
        if (res.ok) return res.text();
        return FALLBACK_DOCS;
      })
      .then((text) => setContent(text))
      .catch(() => {});
  }, []);

  return (
    <>
      <section className="page-heading" id="docs">
        <div>
          <h1>Documentation</h1>
        </div>
      </section>

      <div className="panel docs-panel">
        <article className="docs-content">{renderMarkdown(content)}</article>
      </div>
    </>
  );
}
