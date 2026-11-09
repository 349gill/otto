type SummaryCardsProps = {
  seriousCount: number;
  minorCount: number;
  repoCount: number;
  passingRepoCount: number;
  totalScans: number;
};

export default function SummaryCards({
  seriousCount,
  minorCount,
  repoCount,
  passingRepoCount,
  totalScans,
}: SummaryCardsProps) {
  return (
    <section className="summary-grid" aria-label="Latest scan summary">
      <article className="summary-card serious-card">
        <div className="summary-card-top">
          <span>Serious</span>
          <span className="severity-mark serious-mark" aria-hidden="true">!</span>
        </div>
        <div className="summary-number">
          {seriousCount}
        </div>
        <div className="summary-foot">
          <span className="severity-dot serious-dot" aria-hidden="true" />
          High risk
        </div>
      </article>

      <article className="summary-card minor-card">
        <div className="summary-card-top">
          <span>Minor</span>
          <span className="severity-mark minor-mark" aria-hidden="true">~</span>
        </div>
        <div className="summary-number">
          {minorCount}
        </div>
        <div className="summary-foot">
          <span className="severity-dot minor-dot" aria-hidden="true" />
          Low risk
        </div>
      </article>

      <article className="summary-card info-card">
        <div className="summary-card-top">
          <span>Repositories</span>
          <span className="severity-mark info-mark" aria-hidden="true">#</span>
        </div>
        <div className="summary-number">
          {repoCount}
        </div>
        <div className="summary-foot">
          <span className="severity-dot info-dot" aria-hidden="true" />
          Monitored
        </div>
      </article>

      <article className="summary-card resolved-card">
        <div className="summary-card-top">
          <span>Passing</span>
          <span className="resolved-mark" aria-hidden="true">✓</span>
        </div>
        <div className="summary-number">
          {passingRepoCount}<span className="summary-unit">/{repoCount}</span>
        </div>
        <div className="summary-foot">
          <span className="resolved-trend" aria-hidden="true">↗</span>
          {totalScans} scans
        </div>
      </article>
    </section>
  );
}
