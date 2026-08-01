/**
 * 숙박관리 — 월 경계 처리 핵심 유틸.
 *
 * 체크인~체크아웃이 달력 월 경계를 걸치는 숙박(예: 1/31 체크인 ~ 2/2 체크아웃)은 1월/2월 화면에
 * 모두 나타나야 한다. 캘린더·리스트·현재투숙·중복검사·정산·출력 전부가 반드시 이 파일의 함수만
 * 통해 겹침/재실 여부를 판정한다 — 화면마다 기준이 달라지는 것을 막기 위함(사용자 확정 원칙).
 *
 * 날짜는 YYYY-MM-DD 문자열이므로 사전순 비교가 곧 시간순 비교와 같다 — 범위 겹침 판정에
 * Date 파싱이 필요 없다. 박수 계산(연산이 필요한 경우)에만 lib/lodging/period.ts를 함께 쓴다.
 *
 * month는 사람이 읽는 1~12 라벨이다(연장근무처럼 0-indexed로 받지 않는다 — 새 모듈이라 혼란의
 * 여지가 없게 애초에 1~12로 통일).
 */

import { parseLocalDate } from '@/lib/projectStatus'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** year/month(1~12 라벨)의 [이 달 1일, 다음달 1일) 문자열. */
export function monthBounds(year: number, month: number): { monthStart: string; nextMonthStart: string } {
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return {
    monthStart: `${year}-${pad2(month)}-01`,
    nextMonthStart: `${nextYear}-${pad2(nextMonth)}-01`,
  }
}

/**
 * Supabase 쿼리 조건 — 이 달과 "겹치는" 모든 레코드를 가져온다(걸치는 예약도 포함).
 * 사용: supabase.from('lodging_records').select('*').lt('check_in', nextMonthStart).gt('check_out', monthStart)
 */
export function monthOverlapQuery(year: number, month: number): { monthStart: string; nextMonthStart: string } {
  return monthBounds(year, month)
}

/** 특정 날짜에 재실 중인지 — 체크인일은 포함, 체크아웃일은 미포함. */
export function isDateOccupied(record: { check_in: string; check_out: string }, dateStr: string): boolean {
  return record.check_in <= dateStr && dateStr < record.check_out
}

/** [check_in, check_out)과 [monthStart, nextMonthStart)의 겹치는 구간 길이(박수). */
export function nightsOverlappingMonth(
  record: { check_in: string; check_out: string },
  year: number,
  month: number,
): number {
  const { monthStart, nextMonthStart } = monthBounds(year, month)
  const start = record.check_in > monthStart ? record.check_in : monthStart
  const end = record.check_out < nextMonthStart ? record.check_out : nextMonthStart
  if (start >= end) return 0
  const startDate = parseLocalDate(start)
  const endDate = parseLocalDate(end)
  if (!startDate || !endDate) return 0
  return Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
}

/** 이 레코드의 check_in이 해당 월(1~12 라벨)에 속하는지 — 재무 집계(체크인월 전액 귀속)용. */
export function checkInIsInMonth(record: { check_in: string }, year: number, month: number): boolean {
  const { monthStart, nextMonthStart } = monthBounds(year, month)
  return record.check_in >= monthStart && record.check_in < nextMonthStart
}
