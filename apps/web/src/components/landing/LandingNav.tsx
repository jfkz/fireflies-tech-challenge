import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';

/** Sits on top of the hero; scrolls away with it. */
export function LandingNav() {
  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <nav aria-label="Main" className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 sm:px-8 lg:px-[3%]">
        <Logo tone="white" />
        <div className="flex items-center gap-1 sm:gap-2">
          <a href="#how" className="hidden rounded-full px-3 py-2 font-extrabold text-white/90 hover:text-white md:inline-block">
            How it works
          </a>
          <a href="#download" className="hidden rounded-full px-3 py-2 font-extrabold text-white/90 hover:text-white md:inline-block">
            Download
          </a>
          <Link href="/signin" className="rounded-full px-3 py-2 font-extrabold text-white hover:text-white max-sm:hidden">
            Sign in
          </Link>
          <Link href="/signup" className="btn btn-secondary btn-sm">
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}
