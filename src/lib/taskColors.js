// Light, clean color accents — subtle left-border + pale fill, not solid pills.
export const PHASE_COLORS = [
  "bg-blue-50 border-blue-300 text-blue-700",
  "bg-purple-50 border-purple-300 text-purple-700",
  "bg-emerald-50 border-emerald-300 text-emerald-700",
  "bg-amber-50 border-amber-300 text-amber-700",
  "bg-pink-50 border-pink-300 text-pink-700",
  "bg-cyan-50 border-cyan-300 text-cyan-700",
];

export const STATUS_STYLES = {
  "Not Started": "bg-gray-50 border-gray-300 text-gray-600",
  "In Progress": "bg-blue-50 border-blue-400 text-blue-700",
  Blocked: "bg-rose-50 border-rose-400 text-rose-700",
  Done: "bg-emerald-50 border-emerald-400 text-emerald-700",
};

export function phaseColor(index) {
  return PHASE_COLORS[index % PHASE_COLORS.length];
}
