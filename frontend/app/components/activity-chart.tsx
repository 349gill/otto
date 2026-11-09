import { useState, useEffect } from "react";
import type { ScanHistoryPoint } from "../otto-api";

type ActivityChartProps = {
  chartHistory: ScanHistoryPoint[];
  chartMaximum: number;
  selectedName: string;
};

function makeChartPoints(values: number[], maximum: number) {
  const width = 640;
  const height = 180;
  const padding = 16;
  return values
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
      const y = height - padding - (value / maximum) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function makeChartBand(values: number[], maximum: number) {
  const width = 640;
  const height = 180;
  const padding = 16;
  const upper = values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
    const y = height - padding - (value / maximum) * (height - padding * 2);
    return `${x},${y}`;
  });
  const lower = values
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
      const y = height - padding - (value / maximum) * (height - padding * 2);
      return `${x},${Math.min(height - padding, y + 10)}`;
    })
    .reverse();
  return [...upper, ...lower].join(" ");
}

export default function ActivityChart({
  chartHistory,
  chartMaximum,
  selectedName,
}: ActivityChartProps) {
  const [animKey, setAnimKey] = useState(0);

  useEffect(() => {
    setAnimKey((k) => k + 1);
  }, [selectedName, chartHistory]);

  const severeLine = makeChartPoints(
    chartHistory.map((point) => point.serious),
    chartMaximum
  );
  const minorLine = makeChartPoints(
    chartHistory.map((point) => point.minor),
    chartMaximum
  );
  const severeBand = makeChartBand(
    chartHistory.map((point) => point.serious),
    chartMaximum
  );
  const minorBand = makeChartBand(
    chartHistory.map((point) => point.minor),
    chartMaximum
  );

  return (
    <article className="panel chart-panel">
      <div className="panel-heading chart-heading">
        <h2>Activity</h2>
        <span className="chart-period">14 days</span>
      </div>

      <div className="chart-legend">
        <span>
          <i className="legend-dot severe-dot" aria-hidden="true" /> Serious
        </span>
        <span>
          <i className="legend-dot minor-dot" aria-hidden="true" /> Minor
        </span>
        <span className="chart-target">{selectedName}</span>
      </div>

      {chartHistory.length > 0 ? (
        <>
          <div className="chart-wrap">
            <div className="chart-y-labels" aria-hidden="true">
              <span>{chartMaximum}</span>
              <span>{Math.round(chartMaximum * 0.66)}</span>
              <span>{Math.round(chartMaximum * 0.33)}</span>
              <span>0</span>
            </div>
            <svg
              key={animKey}
              className="activity-chart"
              viewBox="0 0 640 180"
              preserveAspectRatio="none"
              role="img"
              aria-label={`Vulnerabilities over 14 days for ${selectedName}`}
            >
              <polygon points={minorBand} className="chart-area minor-area" />
              <polygon points={severeBand} className="chart-area severe-area" />
              {[16, 65, 115, 164].map((y) => (
                <line key={`grid-${y}`} x1="16" y1={y} x2="624" y2={y} className="chart-gridline" />
              ))}
              <polyline points={severeLine} pathLength="1" className="chart-line severe-line" />
              <polyline points={minorLine} pathLength="1" className="chart-line minor-line" />
              {chartHistory.map((point, index) => {
                const width = 640;
                const height = 180;
                const padding = 16;
                const x = padding + (index * (width - padding * 2)) / Math.max(chartHistory.length - 1, 1);
                const ySevere = height - padding - (point.serious / chartMaximum) * (height - padding * 2);
                const yMinor = height - padding - (point.minor / chartMaximum) * (height - padding * 2);
                return (
                  <g key={point.date}>
                    {point.serious > 0 && (
                      <circle
                        cx={x}
                        cy={ySevere}
                        r="3.5"
                        className="chart-point severe-point"
                        stroke="var(--surface)"
                        strokeWidth="1.5"
                      >
                        <title>{`${point.date}: ${point.serious} serious vulnerability${point.serious > 1 ? "s" : ""}`}</title>
                      </circle>
                    )}
                    {point.minor > 0 && (
                      <circle
                        cx={x}
                        cy={yMinor}
                        r="3.5"
                        className="chart-point minor-point"
                        stroke="var(--surface)"
                        strokeWidth="1.5"
                      >
                        <title>{`${point.date}: ${point.minor} minor vulnerability${point.minor > 1 ? "s" : ""}`}</title>
                      </circle>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="chart-x-labels">
            {chartHistory.map((point, index) => (
              <span
                className={
                  index % Math.max(1, Math.ceil(chartHistory.length / 5)) === 0 ||
                  index === chartHistory.length - 1
                    ? ""
                    : "label-hidden"
                }
                key={point.date}
              >
                {new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="chart-empty">No scan history recorded.</div>
      )}
    </article>
  );
}
