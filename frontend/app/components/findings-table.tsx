import type { ApiFinding } from "../otto-api";

export type DisplayFinding = ApiFinding & {
  key: string;
  repoId: string;
  repoName: string;
  scannedAt: string;
  commit: string;
};

type FindingsTableProps = {
  findings: DisplayFinding[];
  search?: string;
  onSearchChange?: (value: string) => void;
  onSelectFinding: (finding: DisplayFinding) => void;
};

function displayDate(value?: string | null) {
  if (!value) return "Not scanned";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(date);
}

function shortCommit(commit?: string | null) {
  return commit ? commit.slice(0, 7) : "-";
}

export default function FindingsTable({
  findings,
  onSelectFinding,
}: FindingsTableProps) {
  return (
    <section className="panel findings-panel" id="findings">
      <div className="panel-heading findings-heading">
        <h2>Findings</h2>
      </div>

      <div className="findings-table" role="table" aria-label="Current repository findings">
        <div
          className="finding-header"
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(260px, 3.5fr) minmax(140px, 1.5fr) 100px 90px 110px",
          }}
        >
          <span>Vulnerability</span>
          <span>Repository</span>
          <span>Rule</span>
          <span>Severity</span>
          <span>Scan</span>
        </div>

        {findings.length > 0 ? (
          findings.map((finding) => (
            <button
              className="finding-row"
              key={finding.key}
              onClick={() => onSelectFinding(finding)}
              role="row"
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(260px, 3.5fr) minmax(140px, 1.5fr) 100px 90px 110px",
              }}
            >
              <span className="finding-main">
                <span className={`row-severity ${finding.severity === "serious" ? "serious" : "minor"}`} />
                <span className="finding-copy">
                  <strong>{finding.title || finding.comment}</strong>
                  <small>
                    {finding.file}
                    {finding.line > 0 ? `:${finding.line}` : ""} <i /> {shortCommit(finding.commit)}
                  </small>
                </span>
              </span>

              <span className="finding-repo">
                <span>{finding.repoName}</span>
              </span>

              <span>
                <span className="rule-id">{finding.ruleId || "-"}</span>
              </span>

              <span>
                <span className={`severity-pill ${finding.severity === "serious" ? "serious" : "minor"}`}>
                  {finding.severity === "serious" ? "High Risk" : "Low Risk"}
                </span>
              </span>

              <span className="finding-age">{displayDate(finding.scannedAt)}</span>
            </button>
          ))
        ) : (
          <div className="empty-state">
            No open vulnerabilities detected.
          </div>
        )}
      </div>

      <div className="findings-footer">
        <span>{findings.length} findings</span>
      </div>
    </section>
  );
}
