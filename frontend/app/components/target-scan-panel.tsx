import type { ApiFinding } from "../otto-api";

type TargetScanPanelProps = {
  targetAuthorized: boolean;
  targetHost: string;
  apiBaseUrl: string;
  apiSpec: string;
  targetBusy: "port" | "api" | null;
  targetError: string;
  targetSummary: string;
  targetFindings: ApiFinding[];
  onAuthorizeChange: (checked: boolean) => void;
  onTargetHostChange: (host: string) => void;
  onApiBaseUrlChange: (url: string) => void;
  onApiSpecChange: (spec: string) => void;
  onRunPortScan: () => void;
  onRunApiScan: () => void;
};

export default function TargetScanPanel({
  targetAuthorized,
  targetHost,
  apiBaseUrl,
  apiSpec,
  targetBusy,
  targetError,
  targetSummary,
  targetFindings,
  onAuthorizeChange,
  onTargetHostChange,
  onApiBaseUrlChange,
  onApiSpecChange,
  onRunPortScan,
  onRunApiScan,
}: TargetScanPanelProps) {
  return (
    <section className="panel target-section" id="target">
      <div className="target-header">
        <h2>Penetration Testing</h2>
        <label className="target-auth-label">
          <input
            type="checkbox"
            checked={targetAuthorized}
            onChange={(event) => onAuthorizeChange(event.target.checked)}
          />
          <span>Authorized target</span>
        </label>
      </div>

      <div className="target-grid">
        <div className="target-column" id="target-port-scan">
          <span className="target-col-label">Port scan</span>
          <input
            id="target-host-input"
            className="target-input"
            placeholder="Host or IP (e.g. 127.0.0.1)"
            value={targetHost}
            onChange={(event) => onTargetHostChange(event.target.value)}
          />
          <button
            className="scan-trigger"
            disabled={targetBusy !== null}
            onClick={onRunPortScan}
          >
            {targetBusy === "port" ? "Scanning..." : "Run port scan"}
          </button>
        </div>

        <div className="target-column" id="target-api-scan">
          <span className="target-col-label">API spec test</span>
          <input
            id="target-api-input"
            className="target-input"
            placeholder="Base URL (e.g. http://localhost:3000)"
            value={apiBaseUrl}
            onChange={(event) => onApiBaseUrlChange(event.target.value)}
          />
          <textarea
            className="target-textarea"
            placeholder="OpenAPI JSON spec"
            value={apiSpec}
            onChange={(event) => onApiSpecChange(event.target.value)}
            rows={4}
          />
          <button
            className="scan-trigger"
            disabled={targetBusy !== null}
            onClick={onRunApiScan}
          >
            {targetBusy === "api" ? "Scanning..." : "Run API scan"}
          </button>
        </div>
      </div>

      {targetError && <p className="target-error" role="alert">{targetError}</p>}
      {targetSummary && <p className="target-summary">{targetSummary}</p>}

      {targetFindings.length > 0 && (
        <ul className="target-findings">
          {targetFindings.map((finding, index) => {
            const isSerious = finding.severity === "serious" || (finding.severity as string) === "severe";
            return (
              <li key={index} className="target-finding-item">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                  <span className={`severity-pill ${isSerious ? "serious" : "minor"}`}>
                    {isSerious ? "SERIOUS" : "MINOR"}
                  </span>
                  {finding.ruleId && <span className="rule-id">{finding.ruleId}</span>}
                  {finding.file && <code>{finding.file}</code>}
                  <strong>{finding.title}</strong>
                </div>
                <div className="target-finding-detail">{finding.comment}</div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
