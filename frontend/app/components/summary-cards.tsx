type SummaryCardsProps = {
  seriousCount: number;
  minorCount: number;
  repoCount?: number;
  passingRepoCount?: number;
  totalScans?: number;
};

export default function SummaryCards({
  seriousCount,
  minorCount,
}: SummaryCardsProps) {
  return (
    <section
      className="summary-grid"
      style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", marginBottom: "16px" }}
      aria-label="Risk summary"
    >
      <article className="summary-card serious-card">
        <div className="summary-card-top">
          <span>High Risk</span>
        </div>
        <div className="summary-number">
          {seriousCount}
        </div>
      </article>

      <article className="summary-card minor-card">
        <div className="summary-card-top">
          <span>Low Risk</span>
        </div>
        <div className="summary-number">
          {minorCount}
        </div>
      </article>
    </section>
  );
}
