// Page-level loading uses quiet tonal blocks, not spinners (UI/UX spec §18).
export default function Loading() {
  return (
    <div className="max-w-content animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="mb-8 h-8 w-48 rounded-md bg-secondary" />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex h-9 items-center border-b border-border">
          <div className="h-3 w-2/3 rounded-sm bg-secondary" />
        </div>
      ))}
    </div>
  );
}
