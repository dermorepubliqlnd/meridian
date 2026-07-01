import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/projects", label: "Projects" },
  { to: "/tasks", label: "Tasks" },
  { to: "/resources", label: "People & Resources" },
  { to: "/reports", label: "Reports" },
];

export default function Sidebar() {
  const { user, profile, logout } = useAuth();

  return (
    <aside className="w-60 bg-navy text-white min-h-screen flex flex-col">
      <div className="px-6 py-5 border-b border-white/10">
        <h1 className="text-xl font-bold">Meridian</h1>
        <p className="text-xs text-white/60">L&D Project Management</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm font-medium transition ${
                isActive ? "bg-teal text-navy" : "text-white/80 hover:bg-white/10"
              }`
            }
          >
            {l.label}
          </NavLink>
        ))}
        {profile?.role === "Admin" && (
          <NavLink
            to="/users"
            className={({ isActive }) =>
              `block px-3 py-2 rounded-md text-sm font-medium transition ${
                isActive ? "bg-teal text-navy" : "text-white/80 hover:bg-white/10"
              }`
            }
          >
            User Management
          </NavLink>
        )}
      </nav>
      <div className="px-4 py-4 border-t border-white/10 text-xs text-white/60">
        <p className="mb-1 truncate">{profile?.name || user?.email}</p>
        <p className="mb-2 text-white/40">{profile?.role}</p>
        <button onClick={logout} className="text-teal hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
