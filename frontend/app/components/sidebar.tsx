import OttoLogo from "../otto-logo";
import type { ApiRepo } from "../otto-api";
import { CloseIcon, ExternalLinkIcon } from "./icons";

type SidebarProps = {
  userName: string;
  userEmail: string;
  userAvatar: string;
  previewMode: boolean;
  repos: ApiRepo[];
  selectedRepoId: string | null;
  activeView: "overview" | "repositories" | "target";
  allFindingsCount: number;
  portFindingsCount: number;
  onSelectView: (view: "overview" | "repositories" | "target") => void;
  onSelectRepo: (id: string | null) => void;
  onOpenConnectModal: () => void;
  onSignOut: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
};

export default function Sidebar({
  userName,
  userEmail,
  userAvatar,
  previewMode,
  repos,
  selectedRepoId,
  activeView,
  allFindingsCount,
  portFindingsCount,
  onSelectView,
  onSelectRepo,
  onOpenConnectModal,
  onSignOut,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  function scrollToSection(id: string) {
    setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    }, 50);
  }

  return (
    <>
      {isMobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}
      <aside className={`sidebar ${isMobileOpen ? "mobile-open" : ""}`}>
        <div className="sidebar-header-row">
          <a
            className="brand"
            href="#overview"
            aria-label="Otto home"
            onClick={(e) => {
              e.preventDefault();
              onSelectView("overview");
              onSelectRepo(null);
              onCloseMobile?.();
              scrollToSection("overview");
            }}
          >
            <OttoLogo className="h-5 w-auto" />
          </a>
          {onCloseMobile && (
            <button
              className="sidebar-close-mobile"
              onClick={onCloseMobile}
              aria-label="Close navigation"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          )}
        </div>

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
          {/* 1. OVERVIEW */}
          <button
            className={`nav-item ${activeView === "overview" && selectedRepoId === null ? "active" : ""}`}
            onClick={() => {
              onSelectView("overview");
              onSelectRepo(null);
              onCloseMobile?.();
              scrollToSection("overview");
            }}
          >
            <span className="nav-glyph">◫</span>
            <div className="nav-item-copy">
              <span className="nav-item-title">Overview</span>
              <span className="nav-item-subtitle">Past 30-day vulnerabilities</span>
            </div>
            {allFindingsCount > 0 && <span className="nav-count">{allFindingsCount}</span>}
          </button>

          {/* 2. REPOSITORIES */}
          <div className="sidebar-section">
            <div className="sidebar-heading">
              <button
                type="button"
                className={`heading-label-btn ${activeView === "repositories" ? "active" : ""}`}
                onClick={() => {
                  onSelectView("repositories");
                  onCloseMobile?.();
                  scrollToSection("repos-overview");
                }}
              >
                <span className="nav-glyph">🗂</span>
                <span>Repositories</span>
                <span className="target-count">{repos.length}</span>
              </button>
              <button
                className="add-repo-action-btn"
                aria-label="Connect repository"
                title="Connect repository"
                onClick={() => {
                  onOpenConnectModal();
                  onCloseMobile?.();
                }}
              >
                + Add
              </button>
            </div>

            <div className="repo-sublist">
              <button
                className={`target-item ${activeView === "repositories" && selectedRepoId === null ? "selected" : ""}`}
                onClick={() => {
                  onSelectView("repositories");
                  onSelectRepo(null);
                  onCloseMobile?.();
                  scrollToSection("repos-overview");
                }}
              >
                <span className="target-symbol all-symbol">•</span>
                <span className="target-label">All repos</span>
                <span className="target-count">{repos.length}</span>
              </button>

              {repos.map((repo, index) => {
                const isSelected = activeView === "repositories" && selectedRepoId === repo.id;
                const totalVulns = (repo.lastScan?.counts.serious ?? 0) + (repo.lastScan?.counts.minor ?? 0);
                return (
                  <button
                    key={repo.id}
                    className={`target-item ${isSelected ? "selected" : ""}`}
                    onClick={() => {
                      onSelectView("repositories");
                      onSelectRepo(repo.id);
                      onCloseMobile?.();
                      scrollToSection("findings");
                    }}
                  >
                    <span className={`repo-avatar ${["mint", "coral", "gold"][index % 3]}`}>
                      {repo.name.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="target-label" title={repo.githubFullName || repo.name}>
                      {repo.name}
                    </span>
                    <span className="target-count">
                      {totalVulns}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 3. PENETRATION TESTING */}
          <button
            className={`nav-item ${activeView === "target" ? "active" : ""}`}
            onClick={() => {
              onSelectView("target");
              onCloseMobile?.();
              scrollToSection("target");
            }}
          >
            <span className="nav-glyph">◎</span>
            <div className="nav-item-copy">
              <span className="nav-item-title">Penetration Testing</span>
              <span className="nav-item-subtitle">Port scan & API spec</span>
            </div>
            {portFindingsCount > 0 && <span className="nav-count">{portFindingsCount}</span>}
          </button>
        </nav>

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
    </>
  );
}
