export default function Dashboard() {
  return (
    <div>
      <h2 className="text-2xl font-bold font-heading text-navy mb-1">Dashboard</h2>
      <p className="text-sm text-gray-500 mb-6">Welcome to Meridian.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {["Active Projects", "Overdue Tasks", "Team Bandwidth"].map((label) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-5">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">{label}</p>
            <p className="text-3xl font-bold text-navy">—</p>
          </div>
        ))}
      </div>
    </div>
  );
}
