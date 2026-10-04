// ─────────────────────────────────────────────────────────────────────────────
// Test Suite: Indian Market Session & Timezone Calculations (Phase 25)
// Verifies:
//   1. Pre-market session (09:00–09:15 IST) -> PRE_OPEN
//   2. Regular trading hours (09:15–15:30 IST) -> OPEN / LIVE
//   3. Closing session (15:30–16:00 IST) -> CLOSING
//   4. Post-market / after hours -> CLOSED
//   5. Weekend sessions -> CLOSED
//   6. Timezone conversion strictly respects Asia/Kolkata (IST = UTC+05:30)
// ─────────────────────────────────────────────────────────────────────────────

import { calculateIndianMarketStatus } from '../server/marketBackend';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`  ✓ ${msg}`);
}

console.log('============================================================');
console.log('PHASE 25 TEST: INDIAN MARKET SESSION & TIMEZONE ENGINE');
console.log('============================================================\n');

// ── 1. Weekend Detection ────────────────────────────────────────────────────
console.log('─── 1. Weekend Session Detection ───────────────────────────');
// Saturday: 2026-10-03 11:00 UTC (16:30 IST)
const saturdayDate = new Date('2026-10-03T11:00:00.000Z');
const satStatus = calculateIndianMarketStatus(saturdayDate, 'NSE');
assert(satStatus.state === 'CLOSED', 'Saturday correctly classified as CLOSED');
assert(!satStatus.isOpen, 'Market is NOT open on Saturday');
assert(satStatus.message.includes('Weekend'), 'Saturday message mentions Weekend');

// Sunday: 2026-10-04 05:00 UTC (10:30 IST)
const sundayDate = new Date('2026-10-04T05:00:00.000Z');
const sunStatus = calculateIndianMarketStatus(sundayDate, 'NSE');
assert(sunStatus.state === 'CLOSED', 'Sunday correctly classified as CLOSED');
assert(!sunStatus.isOpen, 'Market is NOT open on Sunday');

// ── 2. Trading Day (Wednesday 2026-10-07) Session Stages ───────────────────
console.log('\n─── 2. Trading Day Session Progression (IST) ───────────────');

// A. Early morning before pre-market (08:30 IST -> 03:00 UTC)
const earlyMorning = new Date('2026-10-07T03:00:00.000Z');
const earlyStatus = calculateIndianMarketStatus(earlyMorning, 'NSE');
assert(earlyStatus.state === 'CLOSED', '08:30 IST is CLOSED');
assert(!earlyStatus.isOpen, '08:30 IST is not open');

// B. Pre-market session (09:05 IST -> 03:35 UTC)
const preMarket = new Date('2026-10-07T03:35:00.000Z');
const preStatus = calculateIndianMarketStatus(preMarket, 'NSE');
assert(preStatus.state === 'PRE_OPEN', '09:05 IST is PRE_OPEN');
assert(!preStatus.isOpen, 'Pre-market session is not open for normal trading');
assert(preStatus.message.includes('Pre-market'), 'Pre-market message includes Pre-market description');

// C. Regular trading open (09:16 IST -> 03:46 UTC)
const marketOpenTime = new Date('2026-10-07T03:46:00.000Z');
const openStatus = calculateIndianMarketStatus(marketOpenTime, 'NSE');
assert(openStatus.state === 'OPEN', '09:16 IST is OPEN');
assert(openStatus.isOpen === true, 'Market is open at 09:16 IST');

// D. Mid-day regular session (12:30 IST -> 07:00 UTC)
const midDayTime = new Date('2026-10-07T07:00:00.000Z');
const midStatus = calculateIndianMarketStatus(midDayTime, 'NSE');
assert(midStatus.state === 'OPEN', '12:30 IST is OPEN');
assert(midStatus.isOpen === true, 'Market is open at 12:30 IST');

// E. Right before close (15:29 IST -> 09:59 UTC)
const beforeCloseTime = new Date('2026-10-07T09:59:00.000Z');
const beforeCloseStatus = calculateIndianMarketStatus(beforeCloseTime, 'NSE');
assert(beforeCloseStatus.state === 'OPEN', '15:29 IST is OPEN');
assert(beforeCloseStatus.isOpen === true, 'Market is open at 15:29 IST');

// F. Closing session (15:35 IST -> 10:05 UTC)
const closingTime = new Date('2026-10-07T10:05:00.000Z');
const closingStatus = calculateIndianMarketStatus(closingTime, 'NSE');
assert(closingStatus.state === 'CLOSING', '15:35 IST is CLOSING session');
assert(!closingStatus.isOpen, 'Market is not open during post-close session');

// G. Evening closed (18:00 IST -> 12:30 UTC)
const eveningTime = new Date('2026-10-07T12:30:00.000Z');
const eveningStatus = calculateIndianMarketStatus(eveningTime, 'NSE');
assert(eveningStatus.state === 'CLOSED', '18:00 IST is CLOSED');
assert(!eveningStatus.isOpen, 'Market is not open at 18:00 IST');

// ── 3. Timezone Formatting & Asia/Kolkata Awareness ────────────────────────
console.log('\n─── 3. Asia/Kolkata Timestamp Presentation ──────────────────');
assert(midStatus.istTime.includes('IST'), 'istTime includes IST label');
assert(midStatus.istTime.startsWith('12:30'), `12:30 IST correctly formatted (got ${midStatus.istTime})`);
assert(earlyStatus.istTime.startsWith('08:30'), `08:30 IST correctly formatted (got ${earlyStatus.istTime})`);

console.log('\n============================================================');
console.log('INDIAN MARKET SESSION & TIMEZONE ENGINE: ALL PASSED');
console.log('============================================================');
