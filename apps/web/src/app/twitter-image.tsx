import { socialImage, SOCIAL_ALT, SOCIAL_SIZE } from './_og/social-image';

export const alt = SOCIAL_ALT;
export const size = SOCIAL_SIZE;
export const contentType = 'image/png';

export default function TwitterImage() {
  return socialImage();
}
