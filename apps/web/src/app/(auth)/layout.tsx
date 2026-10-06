import { AuthMoodProvider, SleepyHead } from '@/components/auth/AuthMood';
import { Logo } from '@/components/brand/Logo';

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <AuthMoodProvider>
      <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col px-5 py-5 sm:px-10">
          <Logo />
          <main className="mx-auto my-auto w-full max-w-md py-8">{children}</main>
        </div>
        <aside className="relative order-first flex items-end justify-center overflow-hidden bg-call pt-20 lg:order-none lg:pt-0" aria-label="Receptionist">
          <div className="pointer-events-none absolute inset-x-0 top-[12%] hidden text-center lg:block">
            <p className="font-display mx-auto max-w-[16ch] text-5xl leading-[1] text-white">Front desk. Please don’t ring the bell.</p>
          </div>
          <div className="relative w-full">
            <SleepyHead />
            <div className="relative -mt-[12%] h-24 border-t-[3px] border-ink bg-call-deep lg:h-40" aria-hidden>
              <div className="h-3 bg-[#7f89ff]" />
              <div className="h-[3px] bg-ink" />
            </div>
          </div>
        </aside>
      </div>
    </AuthMoodProvider>
  );
}
