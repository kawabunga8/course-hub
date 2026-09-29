import { Suspense } from 'react';
import AttendanceClient from './AttendanceClient';

export const dynamic = 'force-dynamic';

export default function AttendancePage() {
  return <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}><AttendanceClient /></Suspense>;
}
