export default function GlobeMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 140" aria-hidden="true">
      <rect x="0" y="0" width="140" height="140" rx="28" fill="#0F2240" />
      <circle cx="70" cy="70" r="46" fill="none" stroke="#14B8A6" strokeWidth="6" />
      <ellipse cx="70" cy="70" rx="18" ry="46" fill="none" stroke="#14B8A6" strokeWidth="6" />
      <line x1="24" y1="70" x2="116" y2="70" stroke="#14B8A6" strokeWidth="6" />
      <circle cx="70" cy="70" r="7" fill="#5EEAD4" />
    </svg>
  );
}
