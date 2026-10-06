import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Reset password', alternates: { canonical: '/reset' } };

export default function Page() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
