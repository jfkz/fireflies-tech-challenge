export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading meeting">
      <div className="h-10 w-3/4 animate-pulse rounded-full bg-call-light/60" />
      <div className="mt-8 grid gap-8 lg:grid-cols-[7fr_5fr]">
        <div className="sticker h-72 animate-pulse" />
        <div className="sticker h-96 animate-pulse" />
      </div>
    </div>
  );
}
