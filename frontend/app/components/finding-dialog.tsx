import OttoLogo from "../otto-logo";
import type { DisplayFinding } from "./findings-table";
import { CloseIcon } from "./icons";

type FindingDialogProps = {
  finding: DisplayFinding | null;
  applyingFix: boolean;
  fixResult: { number: number; html_url: string; title: string } | null;
  existingPR?: { number: number; html_url: string; title: string } | null;
  fixError: string;
  onClose: () => void;
  onApplyFix: () => void;
};

function shortCommit(commit?: string | null) {
  return commit ? commit.slice(0, 7) : "";
}

export default function FindingDialog({
  finding,
  applyingFix,
  fixResult,
  existingPR,
  fixError,
  onClose,
  onApplyFix,
}: FindingDialogProps) {
  if (!finding) return null;

  const currentPR = fixResult || existingPR;

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <section
        className="finding-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-top">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className={`severity-pill ${finding.severity === "serious" ? "serious" : "minor"}`}>
              {finding.severity === "serious" ? "High Risk" : "Low Risk"}
            </span>
            <span className={`source-badge ${finding.source}`}>
              {finding.source === "ai" ? "Gemini" : "Static"}
            </span>
            <span className="rule-id" style={{ fontSize: "10px" }}>
              {finding.ruleId}
            </span>
          </div>
          <button onClick={onClose} aria-label="Close dialog" className="dialog-close-btn">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="dialog-id">
          {finding.repoName} {finding.commit ? `· ${shortCommit(finding.commit)}` : ""}
        </div>

        <h2 id="dialog-title">{finding.title || finding.comment}</h2>
        <p className="dialog-location">
          {finding.file}
          {finding.line > 0 ? `:${finding.line}` : ""}
        </p>

        <div className="dialog-section">
          <p>{finding.comment}</p>
        </div>

        {finding.fix && (
          <div className="otto-suggestion">
            <div className="otto-suggestion-heading">
              <OttoLogo className="h-3 w-auto" />
              <strong>Suggested fix</strong>
            </div>
            <div className="otto-suggestion-text">
              <p>{finding.fix}</p>
            </div>

            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {!currentPR ? (
                <button
                  className="fix-pr-button"
                  disabled={applyingFix}
                  onClick={onApplyFix}
                  type="button"
                >
                  {applyingFix ? "Opening pull request..." : "Create Fix PR"}
                </button>
              ) : (
                <div className="fix-pr-result">
                  <span>PR opened:</span>
                  <a href={currentPR.html_url} target="_blank" rel="noopener noreferrer">
                    #{currentPR.number} {currentPR.title}
                  </a>
                </div>
              )}
              {fixError && <div className="fix-pr-error" role="alert">{fixError}</div>}
            </div>
          </div>
        )}

        <button className="dialog-done" onClick={onClose}>
          Close
        </button>
      </section>
    </div>
  );
}
