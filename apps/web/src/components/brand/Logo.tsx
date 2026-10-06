import Link from 'next/link';
import { AppIcon } from './AppIcon';

export function Logo({ href = '/', tone = 'ink', className = '' }: { href?: string; tone?: 'ink' | 'white'; className?: string }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2.5 rounded-xl ${className}`} aria-label="BoringTalks home">
      <AppIcon className="h-9 w-9 shrink-0" />
      <span className={`font-display text-[1.45rem] leading-none tracking-tight ${tone === 'white' ? 'text-white' : 'text-ink'}`}>
        BoringTalks
      </span>
    </Link>
  );
}
