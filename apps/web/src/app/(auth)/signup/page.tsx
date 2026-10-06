import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Create account', description: 'Create a free BoringTalks account. A demo meeting is waiting so you can see the summary before you record anything.', alternates: { canonical: '/signup' } };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="signup" />
    </Suspense>
  );
}
