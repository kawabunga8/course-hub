import { Suspense } from 'react';
import DocumentsClient from './DocumentsClient';

export const dynamic = 'force-dynamic';

export default function DocumentsPage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}><DocumentsClient /></Suspense>;
}
