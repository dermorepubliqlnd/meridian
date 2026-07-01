import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute";
import Login from "./routes/Login";
import Dashboard from "./routes/Dashboard";
import AppLayout from "./components/AppLayout";
import ProjectsPage from "./modules/projects/pages/ProjectsPage";
import TasksPage from "./modules/tasks/pages/TasksPage";
import ResourcesPage from "./modules/resources/pages/ResourcesPage";
import ReportsPage from "./modules/reports/pages/ReportsPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route path="reports" element={<ReportsPage />} />
      </Route>
    </Routes>
  );
}
