type ExposureBreakdownProps = {
  seriousCount: number;
  minorCount: number;
  passingRepoCount: number;
  repoCount: number;
};

export default function ExposureBreakdown({
  seriousCount,
  minorCount,
  passingRepoCount,
  repoCount,
}: ExposureBreakdownProps) {
  const totalFindings = seriousCount + minorCount;

  return (
    <article className="panel distribution-panel">
      <div className="panel-heading">
        <h2>Exposure</h2>
        <span className="distribution-total">
          {totalFindings} <small>issues</small>
        </span>
      </div>

      <div className="severity-bar" aria-label="Latest findings by severity">
        <span className="bar-serious" style={{ flex: Math.max(seriousCount, 0.1) }} />
        <span className="bar-minor" style={{ flex: Math.max(minorCount, 0.1) }} />
      </div>

      <div className="severity-breakdown">
        <div>
          <span className="severity-dot serious-dot" aria-hidden="true" />
          <span>Serious</span>
          <strong>{seriousCount}</strong>
        </div>
        <div>
          <span className="severity-dot minor-dot" aria-hidden="true" />
          <span>Minor</span>
          <strong>{minorCount}</strong>
        </div>
      </div>

      <div className="distribution-divider" />

      <div className="resolution-callout">
        <span className="callout-check" aria-hidden="true">✓</span>
        <div>
          <strong>{passingRepoCount} of {repoCount} repositories passing</strong>
          <small>No open vulnerabilities</small>
        </div>
      </div>
    </article>
  );
}
