import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthAction } from '@/components/auth/AuthForm';

// The links in Firebase's emails (password reset) open here, on our domain.
export const metadata: Metadata = { title: 'Choose a new password', robots: { index: false, follow: false } };

export default function Page() {
  return (
    <Suspense>
      <AuthAction />
    </Suspense>
  );
}
