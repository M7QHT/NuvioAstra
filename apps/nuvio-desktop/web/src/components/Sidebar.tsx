// Side navigation: Início, TV, Buscar, Biblioteca; Configurações at the bottom above the profile.

import type { ProfileInfo } from "../types";
import { Avatar } from "./ProfileMenu";
import { syncLabel, useAccount } from "../account";

export type Tab = "home" | "tv" | "search" | "library" | "settings";

const ITEMS: { tab: Tab; label: string; icon: string }[] = [
  { tab: "home", label: "Início", icon: "⌂" },
  { tab: "tv", label: "TV", icon: "📺" },
  { tab: "search", label: "Buscar", icon: "⌕" },
  { tab: "library", label: "Biblioteca", icon: "📚" },
];

interface Props {
  current: Tab;
  onSelect(tab: Tab): void;
  profile: ProfileInfo | null;
  /** Opens the profile switcher. */
  onProfile(): void;
}

export function Sidebar({ current, onSelect, profile, onProfile }: Props) {
  const account = useAccount();
  return (
    <nav className="sidebar" aria-label="Navegação principal">
      <div className="brand" title="Nuvio Astra">
        <img className="brand-logo" src="./nuvio-astra-128.png" alt="" draggable={false} />
        <span className="nav-label">Nuvio Astra</span>
      </div>
      <ul>
        {ITEMS.map((item) => (
          <li key={item.tab}>
            <button
              className={`nav-item ${current === item.tab ? "active" : ""}`}
              aria-current={current === item.tab ? "page" : undefined}
              onClick={() => onSelect(item.tab)}
              data-tab={item.tab}
            >
              <span className="nav-icon" aria-hidden>{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <span className="spacer" />
      <button
        className={`nav-item ${current === "settings" ? "active" : ""}`}
        aria-current={current === "settings" ? "page" : undefined}
        onClick={() => onSelect("settings")}
        data-tab="settings"
      >
        <span className="nav-icon" aria-hidden>
          ⚙
          {account?.signedIn && <span className={`nav-sync ${syncLabel(account).tone}`} data-testid="nav-sync" data-state={account.state} />}
        </span>
        <span className="nav-label">Configurações</span>
        {account?.signedIn && <span className="sr-only">{syncLabel(account).text}</span>}
      </button>
      {profile && (
        <button className="profile-chip" title={`${profile.name} · trocar de perfil`} onClick={onProfile} data-testid="profile-chip" aria-haspopup="menu">
          <Avatar profile={profile} />
          <span className="nav-label">{profile.name}</span>
        </button>
      )}
    </nav>
  );
}
