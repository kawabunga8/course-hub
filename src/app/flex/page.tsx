import { Suspense } from 'react';
import FlexClient from './FlexClient';

export const dynamic = 'force-dynamic';

export default function FlexPage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}><FlexClient /></Suspense>;
}
