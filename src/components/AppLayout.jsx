import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

export default function AppLayout() {
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8 bg-slate-50 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
