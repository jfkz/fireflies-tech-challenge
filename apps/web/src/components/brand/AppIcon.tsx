import { Avatar } from '@/components/avatar/Avatar';
import { stillPose } from '@/lib/avatar/pose';
import { INK, MEN, WOMEN } from '@/lib/avatar/styles';

/**
 * The app icon, drawn in SVG:
 * two heads in a periwinkle rounded square, one of them mid-sentence.
 */
export function AppIcon({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="100 100 824 824"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <defs>
        <linearGradient id="bt-icon-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6b7aff" />
          <stop offset="1" stopColor="#3845db" />
        </linearGradient>
        <clipPath id="bt-icon-clip">
          <rect x={100} y={100} width={824} height={824} rx={185} />
        </clipPath>
      </defs>
      <rect x={100} y={100} width={824} height={824} rx={185} fill="url(#bt-icon-bg)" />
      <g clipPath="url(#bt-icon-clip)">
        <Avatar style={MEN[0]} pose={stillPose()} look={1} x={147} y={494} width={430} height={430} />
        <Avatar style={WOMEN[0]} pose={stillPose({ mouth: 0.55 })} look={-0.4} x={407} y={454} width={470} height={470} />
      </g>
      <rect x={517} y={192} width={330} height={170} rx={70} fill="#fff" stroke={INK} strokeWidth={14} />
      <path d="M580 340Q580 396 541.5 422Q597.5 393 650 340Z" fill="#fff" />
      <path
        d="M580 355Q580 396 541.5 422Q597.5 393 650 355"
        fill="none"
        stroke={INK}
        strokeWidth={14}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {[616, 682, 748].map((cx) => (
        <circle key={cx} cx={cx} cy={277} r={20} fill={INK} />
      ))}
    </svg>
  );
}
