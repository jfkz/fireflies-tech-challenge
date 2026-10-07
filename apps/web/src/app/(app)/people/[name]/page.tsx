import type { Metadata } from 'next';
import { PersonView } from '@/components/app/PersonView';
import { nameFromParam } from '@/lib/people';

export async function generateMetadata({ params }: PageProps<'/people/[name]'>): Promise<Metadata> {
  const { name } = await params;
  return { title: nameFromParam(name) };
}

export default async function PersonPage({ params }: PageProps<'/people/[name]'>) {
  const { name } = await params;
  return <PersonView name={nameFromParam(name)} />;
}
