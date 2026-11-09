import OttoLogo from "../otto-logo";
import type { ApiRepo } from "../otto-api";
import { ExternalLinkIcon } from "./icons";

type SidebarProps = {
  userName: string;
  userEmail: string;
  userAvatar: string;
  previewMode: boolean;
  repos: ApiRepo[];
  selectedRepoId: string | null;
  allFindingsCount: number;
  vulnFindingsCount: number;
  portFindingsCount: number;
  findingFilter: "all" | "vuln" | "port";
  onSelectRepo: (id: string | null) => void;
  onOpenConnectModal: () => void;
  onSetFindingFilter: (filter: "all" | "vuln" | "port") => void;
  onSignOut: () => void;
};

export default function Sidebar({
  userName,
  userEmail,
  userAvatar,
  previewMode,
  repos,
  selectedRepoId,
  allFindingsCount,
  vulnFindingsCount,
  portFindingsCount,
  findingFilter,
  onSelectRepo,
  onOpenConnectModal,
  onSetFindingFilter,
  onSignOut,
}: SidebarProps) {
  function scrollToSection(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Otto home">
        <OttoLogo className="h-5 w-auto" />
      </a>

      <div className="workspace-switcher">
        {userAvatar ? (
          <img src={userAvatar} alt={userName} className="workspace-avatar" style={{ borderRadius: "5px" }} />
        ) : (
          <span className="workspace-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span>
        )}
        <span className="workspace-copy">
          <strong>{userName || "Workspace"}</strong>
          <small>{userEmail || "Connected"}</small>
        </span>
      </div>

      <nav className="primary-nav" aria-label="Main navigation">
        <button
          className="nav-item active"
          onClick={() => scrollToSection("overview")}
        >
          <span className="nav-glyph">◫</span> Overview
        </button>
        <button
          className="nav-item"
          onClick={() => {
            onSetFindingFilter("all");
            scrollToSection("findings");
          }}
        >
          <span className="nav-glyph">⌕</span> Findings{" "}
          <span className="nav-count">{allFindingsCount}</span>
        </button>
        <button
          className={`nav-item${findingFilter === "vuln" ? " active" : ""}`}
          onClick={() => {
            onSetFindingFilter("vuln");
            scrollToSection("findings");
          }}
        >
          <span className="nav-glyph">!</span> Code{" "}
          <span className="nav-count">{vulnFindingsCount}</span>
        </button>
        <button
          className={`nav-item${findingFilter === "port" ? " active" : ""}`}
          onClick={() => {
            onSetFindingFilter("port");
            scrollToSection("findings");
          }}
        >
          <span className="nav-glyph">⇄</span> Ports{" "}
          <span className="nav-count">{portFindingsCount}</span>
        </button>
        <button
          className="nav-item"
          onClick={() => scrollToSection("activity")}
        >
          <span className="nav-glyph">↗</span> Activity
        </button>
        <button
          className="nav-item"
          onClick={() => scrollToSection("target")}
        >
          <span className="nav-glyph">◎</span> Target scan
        </button>
      </nav>

      <div className="sidebar-section">
        <div className="sidebar-heading">
          <span>Repositories</span>
          <button
            aria-label="Connect repository"
            title="Connect repository"
            onClick={onOpenConnectModal}
          >
            + Add
          </button>
        </div>

        <button
          className={`target-item ${selectedRepoId === null ? "selected" : ""}`}
          onClick={() => onSelectRepo(null)}
        >
          <span className="target-symbol all-symbol">•</span>
          <span className="target-label">All repos</span>
          <span className="target-count">{repos.length}</span>
        </button>

        {repos.map((repo, index) => (
          <button
            key={repo.id}
            className={`target-item ${selectedRepoId === repo.id ? "selected" : ""}`}
            onClick={() => onSelectRepo(repo.id)}
          >
            <span className={`repo-avatar ${["mint", "coral", "gold"][index % 3]}`}>
              {repo.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="target-label" title={repo.githubFullName || repo.name}>
              {repo.name}
            </span>
            <span className="target-count">
              {(repo.lastScan?.counts.serious ?? 0) + (repo.lastScan?.counts.minor ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <div className="sidebar-bottom">
        <div className="connection-state">
          <span className="connection-dot" /> {previewMode ? "Preview" : "Connected"}
        </div>
        <button className="profile-button" onClick={onSignOut} title="Sign out">
          {userAvatar ? (
            <img src={userAvatar} alt={userName} className="profile-avatar" style={{ borderRadius: "5px" }} />
          ) : (
            <span className="profile-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span>
          )}
          <span className="profile-copy">
            <strong>{userName || userEmail}</strong>
            <small>Sign out</small>
          </span>
          <ExternalLinkIcon className="w-3.5 h-3.5 text-muted ml-auto" />
        </button>
      </div>
    </aside>
  );
}
