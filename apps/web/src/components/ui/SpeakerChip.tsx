import { Avatar } from '@/components/avatar/Avatar';
import { stillPose } from '@/lib/avatar/pose';
import { styleForSpeaker } from '@/lib/avatar/styles';

const pose = stillPose();

/** A speaker's name with their little head, in their shirt colour. */
export function SpeakerChip({ name, size = 'sm', active = false }: { name: string; size?: 'sm' | 'md'; active?: boolean }) {
  const style = styleForSpeaker(name);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-ink pr-2.5 font-extrabold text-ink ${active ? 'bg-sun' : 'bg-white'} ${
        size === 'md' ? 'py-0.5 pl-0.5 text-sm' : 'pl-0.5 text-xs'
      }`}
    >
      <span className="overflow-hidden rounded-full" style={{ background: style.shirt }}>
        <Avatar style={style} pose={pose} className={size === 'md' ? 'h-6 w-6' : 'h-5 w-5'} />
      </span>
      {name}
    </span>
  );
}

/** The colour used for a speaker's name in the transcript. */
export function speakerColor(name: string): string {
  return styleForSpeaker(name).shirt;
}
