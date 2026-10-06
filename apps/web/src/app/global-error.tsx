'use client';

// Replaces the root layout when it fails, so it brings its own <html> and no app styles.
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#5b67f5', color: '#fff', display: 'grid', placeItems: 'center', minHeight: '100vh', margin: 0 }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>BoringTalks fell asleep.</h1>
          <p style={{ opacity: 0.9 }}>Something went wrong while loading the page.</p>
          <button type="button" onClick={retry} style={{ font: 'inherit', fontWeight: 800, padding: '10px 20px', borderRadius: 999, border: '2.5px solid #292133', background: '#ffd140', color: '#292133', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
