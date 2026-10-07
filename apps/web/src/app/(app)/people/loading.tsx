export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading people">
      <div className="h-12 w-48 animate-pulse rounded-full bg-call-light/60" />
      <div className="sticker mt-6 h-72 animate-pulse" />
    </div>
  );
}
