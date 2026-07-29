import { Suspense } from 'react';
import PhotosClient from './PhotosClient';

export const dynamic = 'force-dynamic';

export default function PhotosPage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}><PhotosClient /></Suspense>;
}
