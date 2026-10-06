export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading meetings">
      <div className="h-12 w-56 animate-pulse rounded-full bg-call-light/60" />
      <div className="sticker mt-6 h-64 animate-pulse" />
    </div>
  );
}
