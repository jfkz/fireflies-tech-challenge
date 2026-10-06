import { expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export function uniqueEmail(tag = 'user'): string {
  return `${tag}-${randomUUID().slice(0, 8)}@example.com`;
}

export const PASSWORD = 'correct-horse-battery';

/** Signs up through the real form against the Firebase Auth emulator. */
export async function signUp(page: Page, email = uniqueEmail(), next?: string): Promise<string> {
  await page.goto(next ? `/signup?next=${encodeURIComponent(next)}` : '/signup');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(next ? new RegExp(next.replace(/[?]/g, '\\?')) : /\/meetings$/);
  return email;
}
