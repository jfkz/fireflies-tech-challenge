'use client';

import { BOT_MEETING_URL } from '@boringtalks/shared';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { useSendBot } from '@/hooks/queries';

/** "Send BoringTalks to a call": a Recall.ai bot joins the Zoom/Meet/Teams/Webex link and records it. */
export function SendBotPanel() {
  const router = useRouter();
  const send = useSendBot();
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const valid = BOT_MEETING_URL.test(url.trim());

  return (
    <section id="bot" className="sticker scroll-mt-24 p-5 sm:p-6" aria-labelledby="bot-title">
      <h2 id="bot-title" className="font-display text-2xl leading-none">
        Send a notetaker to a call
      </h2>
      <p className="mt-2 font-semibold text-ink-soft">
        For calls you can’t record yourself. A bot called “BoringTalks Notetaker” joins the meeting, everyone sees it in the call, and the notes show
        up here when it leaves.
      </p>
      <form
        className="mt-4 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          send.mutate(
            { meetingUrl: url.trim(), title: title.trim() || undefined, joinAt: later && when ? new Date(when).toISOString() : undefined },
            { onSuccess: (m) => router.push(`/meetings/${m.id}`) },
          );
        }}
      >
        <label className="block">
          <span className="text-sm font-extrabold">Meeting link</span>
          <input
            className="field mt-1"
            type="url"
            inputMode="url"
            required
            placeholder="https://zoom.us/j/… or meet.google.com/… or teams.microsoft.com/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={url.trim() !== '' && !valid}
          />
          {url.trim() !== '' && !valid && <span className="mt-1 block text-sm font-bold text-danger">Paste a Zoom, Google Meet, Microsoft Teams or Webex link.</span>}
        </label>
        <label className="block">
          <span className="text-sm font-extrabold">Title (optional)</span>
          <input className="field mt-1" maxLength={120} placeholder="Leave empty and we’ll name it from what was said" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-extrabold">
          <legend className="sr-only">When should it join?</legend>
          <label className="flex items-center gap-2">
            <input type="radio" name="bot-when" checked={!later} onChange={() => setLater(false)} /> Join now
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="bot-when" checked={later} onChange={() => setLater(true)} /> Join at
          </label>
          {later && (
            <input
              type="datetime-local"
              aria-label="Join at"
              className="field w-auto py-1.5"
              value={when}
              required
              onChange={(e) => setWhen(e.target.value)}
            />
          )}
        </fieldset>
        {send.isError && <ErrorNote>{send.error.message}</ErrorNote>}
        <button type="submit" className="btn btn-primary" disabled={!valid || send.isPending || (later && !when)}>
          {send.isPending ? 'Sending…' : later ? 'Schedule the notetaker' : 'Send the notetaker'}
        </button>
        <p className="text-xs font-semibold text-ink-soft">Let people know it’s recording, as you would with any recording.</p>
      </form>
    </section>
  );
}
