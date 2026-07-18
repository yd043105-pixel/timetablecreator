// 방문자 수 집계 — Netlify Functions + Blobs (개인 식별 없이 숫자만 저장).
// GET /api/visit          → 현재 수치만 조회
// GET /api/visit?count=1  → 오늘·누적 1 증가 후 조회 (클라이언트가 하루 1회만 호출)
import { getStore } from '@netlify/blobs';

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export default async (req) => {
  const store = getStore('visits');
  const today = kstToday();
  const count = new URL(req.url).searchParams.get('count') === '1';

  let total = Number(await store.get('total')) || 0;
  let daily = Number(await store.get(`day-${today}`)) || 0;
  if (count) {
    total += 1;
    daily += 1;
    await store.set('total', String(total));
    await store.set(`day-${today}`, String(daily));
  }
  return Response.json({ today: daily, total });
};

export const config = { path: '/api/visit' };
