export default function TasksPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-navy mb-1">Tasks</h2>
      <p className="text-sm text-gray-500 mb-6">
        Module 2 — Task tracker. Key in estimated hours; Meridian auto-computes date coverage
        based on assignee capacity, holidays, and time off.
      </p>
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-6 text-sm text-gray-400">
        Task grid coming next: name, assignee, hours, auto start/due dates, status, dependencies.
      </div>
    </div>
  );
}
