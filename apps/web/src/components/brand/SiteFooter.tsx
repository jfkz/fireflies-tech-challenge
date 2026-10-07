import Link from 'next/link';
import { VersionTag } from '@/components/app/UpdatePrompt';
import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="border-t-[3px] border-ink bg-ink px-5 py-10 text-white">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo tone="white" />
          <p className="mt-3 text-sm font-semibold text-white/70">This website could have been an email.</p>
          <VersionTag className="mt-2 block text-white/45" />
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-extrabold text-white/85">
          <Link href="/#download" className="hover:text-sun">
            Download for Mac
          </Link>
          <Link href="/record" className="hover:text-sun">
            Record in the browser
          </Link>
          <Link href="/signin" className="hover:text-sun">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-sun">
            Create account
          </Link>
        </nav>
      </div>
    </footer>
  );
}
