import { describe, expect, it } from 'vitest';
import { FAQ } from './faq';
import { DMG_URL, landingJsonLd } from './seo';

describe('landingJsonLd', () => {
  const graph = landingJsonLd()['@graph'];
  const byType = (t: string) => graph.find((n) => n['@type'] === t) as Record<string, unknown>;

  it('describes the app with a stable download link and a free offer', () => {
    const app = byType('SoftwareApplication');
    expect(app.downloadUrl).toBe(DMG_URL);
    expect(DMG_URL).toMatch(/BoringTalks-latest\.dmg$/);
    expect(app.offers).toMatchObject({ price: '0' });
  });

  it('mirrors every FAQ entry on the page', () => {
    const faq = byType('FAQPage') as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity.map((q) => q.name)).toEqual(FAQ.map((f) => f.q));
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe(FAQ[0].a);
  });

  it('links the app and site to the publisher', () => {
    expect(byType('Organization')['@id']).toBe(byType('WebSite').publisher && (byType('WebSite').publisher as { '@id': string })['@id']);
  });
});
