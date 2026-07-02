import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import GlobeMark from "./GlobeMark";

const links = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/projects", label: "Projects" },
  { to: "/tasks", label: "Tasks" },
  { to: "/resources", label: "People & Resources" },
  { to: "/reports", label: "Reports" },
];

export default function Sidebar() {
  const { user, profile, logout } = useAuth();

  const navClass = ({ isActive }) =>
    `block px-2.5 py-1.5 rounded-md text-[13px] font-medium font-heading transition ${
      isActive ? "bg-teal text-navy" : "text-white/80 hover:bg-white/10"
    }`;

  return (
    <aside className="w-56 bg-navy text-white min-h-screen flex flex-col text-[13px]">
      <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2.5">
        <GlobeMark size={32} />
        <div>
          <h1 className="text-xl font-bold font-heading">Meridian</h1>
          <p className="text-xs text-teal-light">True north.</p>
        </div>
      </div>
      <nav className="flex-1 px-2.5 py-3 space-y-0.5">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
            {l.label}
          </NavLink>
        ))}
        {profile?.role === "Admin" && (
          <>
            <div className="pt-2 pb-0.5 px-2.5 text-[10px] text-white/30 uppercase tracking-wider">Admin</div>
            <NavLink to="/users" className={navClass}>User Management</NavLink>
            <NavLink to="/settings" className={navClass}>Settings</NavLink>
          </>
        )}
      </nav>
      <div className="px-4 py-3 border-t border-white/10 text-[11px] text-white/60">
        <p className="mb-1 truncate">{profile?.name || user?.email}</p>
        <p className="mb-2 text-white/40">{profile?.role}</p>
        <button onClick={logout} className="text-teal hover:underline">Sign out</button>
      </div>
    </aside>
  );
}
