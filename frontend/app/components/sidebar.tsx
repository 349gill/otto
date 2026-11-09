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
  activeView: "overview" | "repositories" | "target" | "docs";
  allFindingsCount: number;
  targetFindingsCount?: number;
  portFindingsCount?: number;
  onSelectView: (view: "overview" | "repositories" | "target" | "docs") => void;
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
  repos,
  selectedRepoId,
  activeView,
  allFindingsCount,
  targetFindingsCount,
  portFindingsCount,
  onSelectView,
  onSelectRepo,
  onOpenConnectModal,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  function scrollToSection(id: string) {
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: "smooth" });
        const input = el.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
        input?.focus();
      }
    }, 60);
  }

  const pentestCount = targetFindingsCount ?? portFindingsCount ?? 0;

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
            <span className="nav-item-title">Overview</span>
            {allFindingsCount > 0 && <span className="nav-count">{allFindingsCount}</span>}
          </button>

          {/* 2. PENETRATION TESTING */}
          <button
            className={`nav-item ${activeView === "target" ? "active" : ""}`}
            onClick={() => {
              onSelectView("target");
              onCloseMobile?.();
              scrollToSection("target");
            }}
          >
            <span className="nav-item-title">Penetration Testing</span>
            {pentestCount > 0 && <span className="nav-count">{pentestCount}</span>}
          </button>

          {/* 3. DOCUMENTATION */}
          <button
            className={`nav-item ${activeView === "docs" ? "active" : ""}`}
            onClick={() => {
              onSelectView("docs");
              onSelectRepo(null);
              onCloseMobile?.();
              scrollToSection("docs");
            }}
          >
            <span className="nav-item-title">Documentation</span>
          </button>

          {/* 4. REPOSITORIES */}
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
                +
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
                <span className="target-label">All repos</span>
                <span className="target-count">{repos.length}</span>
              </button>

              {repos.map((repo) => {
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
        </nav>

        <div className="sidebar-bottom">
          <a
            href={userName ? `https://github.com/${userName}` : "https://github.com"}
            target="_blank"
            rel="noopener noreferrer"
            className="profile-button"
            title={`Open ${userName || "GitHub"} on GitHub`}
            style={{ textDecoration: "none" }}
          >
            {userAvatar ? (
              <img src={userAvatar} alt={userName} className="profile-avatar" style={{ borderRadius: "5px" }} />
            ) : (
              <span className="profile-avatar">{userName.slice(0, 1).toUpperCase() || "O"}</span>
            )}
            <span className="profile-copy">
              <strong>{userName || userEmail}</strong>
            </span>
            <ExternalLinkIcon className="w-3.5 h-3.5 text-muted ml-auto" />
          </a>
        </div>
      </aside>
    </>
  );
}
