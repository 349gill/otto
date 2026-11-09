import { MoonIcon, SunIcon } from "./icons";

type TopbarProps = {
  selectedName: string;
  theme: "light" | "dark";
  previewMode: boolean;
  onToggleTheme: () => void;
  onSignOut: () => void;
};

export default function Topbar({
  selectedName,
  theme,
  previewMode,
  onToggleTheme,
  onSignOut,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="breadcrumbs">
        <span>Workspace</span>
        <span className="crumb-slash">/</span>
        <strong>{selectedName}</strong>
      </div>
      <div className="topbar-actions">
        <span className="demo-label">
          <span /> {previewMode ? "Preview mode" : "Live backend"}
        </span>
        <button
          className="theme-toggle"
          onClick={onToggleTheme}
          aria-pressed={theme === "dark"}
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
        >
          <span className="theme-symbol" aria-hidden="true">
            {theme === "light" ? <MoonIcon className="w-3.5 h-3.5" /> : <SunIcon className="w-3.5 h-3.5" />}
          </span>
          <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
        </button>
        <button className="signout-button" onClick={onSignOut} title="Sign out of Otto">
          Sign out
        </button>
      </div>
    </header>
  );
}
