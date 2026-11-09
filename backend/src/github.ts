// GitHub REST API client using standard headers and authentication.

const API = "https://api.github.com";

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "otto-security-platform",
  };
}

export async function getGitHubUser(
  accessToken: string,
): Promise<{ id: number; login: string; email: string; avatar_url: string }> {
  const res = await fetch(`${API}/user`, { headers: headers(accessToken) });
  if (!res.ok) throw new Error(`GitHub /user ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;

  // email may be null if the user's email is private; try /user/emails
  let email: string = data.email ?? "";
  if (!email) {
    try {
      const emailRes = await fetch(`${API}/user/emails`, { headers: headers(accessToken) });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as any[];
        const primary = emails.find((e: any) => e.primary && e.verified);
        if (primary) email = primary.email;
      }
    } catch {
      /* best-effort */
    }
  }

  return { id: data.id, login: data.login, email, avatar_url: data.avatar_url ?? "" };
}

export async function getGitHubRepos(
  accessToken: string,
): Promise<
  Array<{
    id: number;
    full_name: string;
    name: string;
    private: boolean;
    default_branch: string;
    html_url: string;
    description: string;
  }>
> {
  const all: any[] = [];
  let page = 1;
  // Paginate up to 5 pages (500 repos) to stay reasonable
  while (page <= 5) {
    const res = await fetch(
      `${API}/user/repos?per_page=100&sort=updated&page=${page}`,
      { headers: headers(accessToken) },
    );
    if (!res.ok) throw new Error(`GitHub /user/repos ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as any[];
    if (data.length === 0) break;
    all.push(...data);
    page++;
  }

  return all.map((r: any) => ({
    id: r.id,
    full_name: r.full_name,
    name: r.name,
    private: r.private ?? false,
    default_branch: r.default_branch ?? "main",
    html_url: r.html_url ?? "",
    description: r.description ?? "",
  }));
}

export async function postPRComment(
  token: string,
  owner: string,
  repo: string,
  prNumber: number,
  body: string,
): Promise<void> {
  const url = `${API}/repos/${owner}/${repo}/issues/${prNumber}/comments`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PR comment ${res.status}: ${text}`);
  }
}

export async function getCommitDiff(
  token: string,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string> {
  const url = `${API}/repos/${owner}/${repo}/commits/${commitSha}`;
  const res = await fetch(url, {
    headers: {
      ...headers(token),
      Accept: "application/vnd.github.diff",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub commit diff ${res.status}: ${text}`);
  }
  return res.text();
}

/**
 * Exchange an OAuth authorization code for an access token.
 */
export async function exchangeCodeForToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!res.ok) throw new Error(`GitHub OAuth token exchange ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as any;
  if (data.error) throw new Error(`GitHub OAuth error: ${data.error_description ?? data.error}`);
  return data.access_token;
}

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  branchName: string,
  fromSha: string,
): Promise<void> {
  const url = `${API}/repos/${owner}/${repo}/git/refs`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: fromSha }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub create branch ${res.status}: ${text}`);
  }
}

export async function createOrUpdateFile(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  content: string,
  message: string,
  branch: string,
): Promise<void> {
  // Fetch existing file sha so the PUT is treated as an update, not a conflict
  let sha: string | undefined;
  const getUrl = `${API}/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`;
  const getRes = await fetch(getUrl, { headers: headers(token) });
  if (getRes.ok) {
    const data = (await getRes.json()) as any;
    sha = data.sha;
  }

  const putUrl = `${API}/repos/${owner}/${repo}/contents/${filePath}`;
  const body: Record<string, any> = {
    message,
    content: Buffer.from(content).toString("base64"),
    branch,
    committer: {
      name: "otto-security[bot]",
      email: "353917578+otto-security[bot]@users.noreply.github.com",
    },
    author: {
      name: "otto-security[bot]",
      email: "353917578+otto-security[bot]@users.noreply.github.com",
    },
  };
  if (sha) body.sha = sha;

  const res = await fetch(putUrl, {
    method: "PUT",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub create/update file ${res.status}: ${text}`);
  }
}

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  title: string,
  body: string,
  head: string,
  base: string,
): Promise<{ number: number; html_url: string }> {
  const url = `${API}/repos/${owner}/${repo}/pulls`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...headers(token), "Content-Type": "application/json" },
    body: JSON.stringify({ title, body, head, base }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub create PR ${res.status}: ${text}`);
  }
  const data = (await res.json()) as any;
  return { number: data.number, html_url: data.html_url };
}

export async function getPullRequest(
  token: string,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<{ headRef: string; headSha: string; baseRef: string }> {
  const url = `${API}/repos/${owner}/${repo}/pulls/${pullNumber}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub get PR ${res.status}: ${text}`);
  }
  const data = (await res.json()) as any;
  return {
    headRef: data.head?.ref ?? "",
    headSha: data.head?.sha ?? "",
    baseRef: data.base?.ref ?? "main",
  };
}

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string,
): Promise<{ branch: string; sha: string }> {
  const repoRes = await fetch(`${API}/repos/${owner}/${repo}`, { headers: headers(token) });
  if (!repoRes.ok) throw new Error(`GitHub get repo ${repoRes.status}: ${await repoRes.text()}`);
  const repoData = (await repoRes.json()) as any;
  const defaultBranch: string = repoData.default_branch ?? "main";

  const refRes = await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/${defaultBranch}`, {
    headers: headers(token),
  });
  if (!refRes.ok) throw new Error(`GitHub get ref ${refRes.status}: ${await refRes.text()}`);
  const refData = (await refRes.json()) as any;

  return { branch: defaultBranch, sha: refData.object.sha };
}

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<string> {
  const url = `${API}/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`;
  const res = await fetch(url, { headers: headers(token) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub get file ${res.status}: ${text}`);
  }
  const data = (await res.json()) as any;
  return Buffer.from(data.content, "base64").toString("utf-8");
}
