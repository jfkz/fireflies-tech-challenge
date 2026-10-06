import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Sign in', description: 'Sign in to BoringTalks to read your meeting summaries, speakers and tasks.', alternates: { canonical: '/signin' } };

export default function Page() {
  return (
    <Suspense>
      <AuthForm mode="signin" />
    </Suspense>
  );
}
