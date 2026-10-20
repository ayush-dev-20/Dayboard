export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading canvas"
      className="h-[60vh] animate-pulse rounded-md bg-secondary/60 motion-reduce:animate-none"
    />
  );
}
