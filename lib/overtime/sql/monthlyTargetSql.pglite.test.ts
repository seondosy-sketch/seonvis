/**
 * 월 목표 선입력 운영 SQL을 PGlite(메모리 안 PostgreSQL)에서 실제로 실행해 본다 — 운영·개발 DB에는 접속하지 않는다.
 *
 * - supabase/prod/overtime_monthly_targets_2_apply.sql: 검사만(기본) / 적용 / 두 번째 적용 중단 / 검사 실패 사례
 * - supabase/prod/overtime_monthly_targets_3_rollback.sql: 검사만(기본) / 정확히 16행 삭제 / 범위·행 수가 어긋나면 삭제 전·후 중단
 * - 두 파일의 결과 SELECT만 단독 실행하면 t00·r00이 FAIL(성공처럼 INFO만 나오지 않는다)
 * - supabase/verify/overtime_monthly_target_precheck.sql: mt01(<> all 배열 비교)이 오류 없이 OK·FAIL을 가른다
 *
 * 엔진: @electric-sql/pglite 0.5.8 — select version()이 PostgreSQL 18.3을 보고한다. 운영 Supabase는 PostgreSQL 17.11.
 *   이 파일들이 쓰는 기능(DO·set_config·pg_current_xact_id·unnest 다중 인자)에서 의미 차이는 찾지 못했지만
 *   같은 버전 실증은 아니다 — 여기 결과를 Supabase 실행 확인으로 쓰지 않는다.
 *
 * 표는 최소 구성: overtime_monthly_targets는 migration A의 create table을 그대로 쓰고(auth.jwt() 기본값만 ''로),
 * overtime_employees·engineer_contacts는 파일이 읽는 열만 둔다. 직원은 주소록 연결 9명 중 1명 비활성(운영과 같은 모양).
 * 비활성 직원의 주소록은 일부러 '미래사업팀·재직'으로 둔다 — 그래야 대상 조건의 is_active가 실제로 시험된다(주소록만 보면 9명).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

const APPLY = read('supabase/prod/overtime_monthly_targets_2_apply.sql')
const ROLLBACK = read('supabase/prod/overtime_monthly_targets_3_rollback.sql')
const PRECHECK = read('supabase/verify/overtime_monthly_target_precheck.sql')

const ACTIVE = Array.from({ length: 8 }, (_, i) => `00000000-0000-4000-8000-00000000000${i + 1}`)
const INACTIVE = '00000000-0000-4000-8000-000000000009'

function targetsTable(): string {
  const a = read('supabase/migration_overtime_planning_a_base.sql')
  const m = /create table if not exists public\.overtime_monthly_targets \([\s\S]*?\n\);/.exec(a)
  expect(m, 'migration A에 overtime_monthly_targets 정의 없음').not.toBeNull()
  return m![0].replace(/coalesce\(auth\.jwt\(\) ->> 'email', ''\)/g, "''")
}

/** 파일의 한 부분을 바꾼다 — 바꿀 곳이 정확히 한 번 있어야 한다(파일 구조가 바뀌면 시험이 먼저 깨지게) */
function sub(src: string, re: RegExp, to: string): string {
  const hits = src.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')) ?? []
  expect(hits.length, `바꿀 곳이 한 번이 아님: ${re}`).toBe(1)
  return src.replace(re, to)
}
const uuidArray = (ids: string[]) => `array[${ids.map(i => `'${i}'`).join(', ')}]::uuid[];`
const withIds = (src: string, ids: string[]) => sub(src, /array\[\n(?:\s+'0{8}-0{4}-0{4}-0{4}-0{12}',?\n)+\s+\]::uuid\[\];/, uuidArray(ids))
const withApply = (src: string) => sub(src, /v_apply(\s+)boolean(\s+):= false;/, 'v_apply$1boolean$2:= true; ')
const withHours = (src: string, hours: string[]) =>
  sub(src, /v_hours numeric\[\] := array\[[^\]]*\]::numeric\[\];/, `v_hours numeric[] := array[${hours.join(', ')}]::numeric[];`)

type Row = Record<string, unknown>
let db: PGlite

/** 스크립트 전체 실행. 마지막 SELECT(commit 바로 앞) 결과 행을 돌려준다. 오류면 rollback 후 다시 던진다. */
async function run(sql: string): Promise<Row[]> {
  try {
    const results = await db.exec(sql)
    const withRows = results.filter(r => r.fields.length > 0)
    return (withRows.at(-1)?.rows ?? []) as Row[]
  } catch (e) {
    await db.exec('rollback;')
    throw e
  }
}
const targetCount = async () => Number(((await db.query('select count(*)::int as n from public.overtime_monthly_targets')).rows[0] as Row).n)
const byName = (rows: Row[]) => Object.fromEntries(rows.map(r => [String(r.check_name), r]))
const verdictOf = (rows: Row[], name: string) => byName(rows)[name]?.verdict
/** 파일의 맨 바깥 결과 SELECT(commit 바로 앞 with … ;)만 — 사용자가 Editor에서 그 부분만 골라 실행한 경우 */
const resultSelect = (src: string) => src.slice(src.lastIndexOf('\nwith '), src.lastIndexOf('\ncommit;'))
const withExpected = (src: string, n: number) => sub(src, /v_expected int(\s+):= 8;/, `v_expected int$1:= ${n};`)
const keyRows = (rows: Row[]) => rows.map(r => `${r.check_name}|${r.verdict}`)

beforeEach(async () => {
  db = new PGlite()
  await db.exec(`
    create table public.overtime_employees (
      id uuid primary key, name text not null, is_active boolean not null,
      sort_order int, created_at timestamptz not null default now()
    );
    create table public.engineer_contacts (
      id uuid primary key default gen_random_uuid(), employee_id uuid unique references public.overtime_employees(id),
      company text, employment_status text
    );
    ${targetsTable()}
  `)
  const all = [...ACTIVE, INACTIVE]
  for (const [i, id] of all.entries()) {
    await db.query('insert into public.overtime_employees (id, name, is_active, sort_order) values ($1, $2, $3, $4)', [id, `가짜이름${i + 1}`, id !== INACTIVE, i])
    await db.query('insert into public.engineer_contacts (employee_id, company, employment_status) values ($1, $2, $3)',
      [id, '미래사업팀', '재직'])
  }
})
afterEach(async () => { await db.close() })

describe('월 목표 2단계 적용(_2_apply.sql)', () => {
  it('파일 그대로(자리표시 ID)는 c05로 중단하고 아무것도 쓰지 않는다', async () => {
    await expect(run(APPLY)).rejects.toThrow(/c05 자리표시 ID 남음/)
    expect(await targetCount()).toBe(0)
  })

  it('기본 검사 모드: 검사 통과, 쓰지 않음, t01은 기간마다 NONE', async () => {
    const rows = byName(await run(withIds(APPLY, ACTIVE)))
    expect(await targetCount()).toBe(0)
    expect(rows['t00 파일 전체 실행 확인']).toMatchObject({ verdict: 'OK', detail: '이번 실행: 검사만(v_apply = false) — 아무것도 쓰지 않음' })
    expect(rows['t01 2026-10 대상 직원 목표 행']).toMatchObject({ verdict: 'NONE', detail: '0 / 8명' })
    expect(rows['t01 2026-11 대상 직원 목표 행']).toMatchObject({ verdict: 'NONE', detail: '0 / 8명' })
    expect(rows['t04 월 목표 강제조건 트리거']).toMatchObject({ detail: '없음(activation 전)' })
  })

  it('적용: 8명 × 2기간 = 16행, t01 OK·t02 분포, 두 번째 적용은 c11로 중단', async () => {
    const sql = withApply(withIds(APPLY, ACTIVE))
    const rows = await run(sql)
    expect(await targetCount()).toBe(16)
    const r = byName(rows)
    expect(r['t00 파일 전체 실행 확인']).toMatchObject({ verdict: 'OK', detail: '이번 실행: 적용(v_apply = true)' })
    expect(r['t01 2026-10 대상 직원 목표 행']).toMatchObject({ verdict: 'OK', detail: '8 / 8명' })
    expect(r['t01 2026-11 대상 직원 목표 행']).toMatchObject({ verdict: 'OK', detail: '8 / 8명' })
    expect(r['t02 2026-10 목표시간 분포']).toMatchObject({ detail: '20.00h×8' })
    expect(r['t03 전체 목표 행(모든 기간)']).toMatchObject({ detail: '16행' })
    // 결과에 이름·UUID가 없다
    const text = JSON.stringify(rows)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(text).not.toContain('가짜이름')

    await expect(run(sql)).rejects.toThrow(/c11 기존 목표 있음 2026-10 \/ c11 기존 목표 있음 2026-11/)
    expect(await targetCount()).toBe(16)
  })

  it.each([
    ['줄 수 부족·누락', (s: string) => withIds(s, ACTIVE.slice(0, 7)), /c02 입력 줄 수\(ID 7 \/ 시간 8\) ≠ 8 \/ c10 누락된 대상 직원/],
    ['비활성 직원 ID', (s: string) => withIds(s, [...ACTIVE.slice(0, 7), INACTIVE]), /c09 대상이 아닌 ID \/ c10 누락된 대상 직원/],
    ['중복 ID', (s: string) => withIds(s, [...ACTIVE.slice(0, 7), ACTIVE[0]]), /c08 중복 ID/],
    ['소수 셋째 자리', (s: string) => withHours(withIds(s, ACTIVE), ['20.005', ...Array(7).fill('20')]), /c07b 소수 셋째 자리 이상/],
    ['범위 밖', (s: string) => withHours(withIds(s, ACTIVE), ['301', ...Array(7).fill('20')]), /c07 범위\(0~300\) 밖/],
    ['빈칸', (s: string) => withHours(withIds(s, ACTIVE), ['null', ...Array(7).fill('20')]), /c06 빈칸/],
    ['급여기간 형식', (s: string) => sub(s, /array\['2026-10', '2026-11'\]/, "array['2026-13']"), /c01 급여기간 형식/],
  ])('apply = true여도 %s이면 중단하고 아무것도 쓰지 않는다', async (_name, edit, err) => {
    await expect(run(withApply(edit(APPLY)))).rejects.toThrow(err)
    expect(await targetCount()).toBe(0)
  })

  it('대상 인원이 v_expected와 다르면 c03', async () => {
    await db.query("update public.engineer_contacts set employment_status = '퇴사' where employee_id = $1", [ACTIVE[7]])
    await expect(run(withApply(withIds(APPLY, ACTIVE)))).rejects.toThrow(/c03 대상 인원 ≠ 재직인원/)
    expect(await targetCount()).toBe(0)
  })

  it('on conflict do nothing 등으로 한 행이라도 빠지면 적용 행 수 검사가 전체를 되돌린다', async () => {
    // 검사(c11)를 지난 뒤 끼어든 행을 흉내 낸다 — 한 행만 조용히 건너뛰게 하는 BEFORE INSERT 트리거
    await db.exec(`
      create function public.f_skip_one() returns trigger language plpgsql as $$
      begin
        if new.employee_id = '${ACTIVE[0]}' and new.period_label = '2026-11' then return null; end if;
        return new;
      end $$;
      create trigger t_skip_one before insert on public.overtime_monthly_targets for each row execute function public.f_skip_one();
    `)
    await expect(run(withApply(withIds(APPLY, ACTIVE)))).rejects.toThrow(/적용 행 수 15 ≠ 기대 16/)
    expect(await targetCount()).toBe(0)
  })
})

describe('월 목표 되돌리기(_3_rollback.sql)', () => {
  beforeEach(async () => { await run(withApply(withIds(APPLY, ACTIVE))) })
  const insertTarget = (id: string, label: string) =>
    db.query('insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values ($1, $2, 10)', [id, label])
  /** 지정 범위(ACTIVE × 2026-10·11) 밖 행 2개: 비활성 직원의 2026-10, 대상 직원의 2026-12 */
  const addUnrelated = async () => { await insertTarget(INACTIVE, '2026-10'); await insertTarget(ACTIVE[0], '2026-12') }
  const unrelatedCount = async () => Number(((await db.query(
    "select count(*)::int as n from public.overtime_monthly_targets where (employee_id = $1 and period_label = '2026-10') or (employee_id = $2 and period_label = '2026-12')",
    [INACTIVE, ACTIVE[0]])).rows[0] as Row).n)
  const RANDOM_ID = '00000000-0000-4000-8000-0000000000aa'

  it('기본값: v_expected 8, 자리표시 8줄, 급여기간 2026-10·11, 검사만 — 파일 그대로는 r03으로 중단', async () => {
    expect(ROLLBACK).toMatch(/v_expected int\s+:= 8;/)
    expect(ROLLBACK).toMatch(/v_apply\s+boolean := false;/)
    expect(ROLLBACK).toContain("v_labels   text[]  := array['2026-10', '2026-11'];")
    const ids = /v_ids uuid\[\] := array\[\n([\s\S]*?)\]::uuid\[\];/.exec(ROLLBACK)![1]
    expect(ids.match(/'0{8}-0{4}-0{4}-0{4}-0{12}'/g)).toHaveLength(8)
    await expect(run(ROLLBACK)).rejects.toThrow(/r03 자리표시 ID 남음/)
    expect(await targetCount()).toBe(16)
  })

  it('검사 모드: 0행 삭제, 원본 16행 유지, r00·r10·r11·r20 OK', async () => {
    const rows = await run(withIds(ROLLBACK, ACTIVE))
    expect(await targetCount()).toBe(16)
    const r = byName(rows)
    expect(r['r00 파일 전체 실행 확인']).toMatchObject({ verdict: 'OK', detail: '이번 실행: 검사만(v_apply = false) — 아무것도 지우지 않음' })
    expect(r['r10 삭제 전 지정 범위(ID × 급여기간) 행']).toMatchObject({ verdict: 'OK', detail: '16 / 기대 16행' })
    expect(r['r11 실제 삭제 행']).toMatchObject({ verdict: 'OK', detail: '0행 삭제 / 기대 0(검사만)행' })
    expect(r['r20 2026-10 이번 rollback 대상 ID의 남은 목표 행']).toMatchObject({ verdict: 'OK', detail: '8행 / 기대 8행' })
    expect(rows.filter(x => x.verdict === 'FAIL')).toEqual([])
  })

  it('정상 삭제: 정확히 16행, 지정 범위 잔여 0, 범위 밖 행 유지, 결과에 이름·UUID 없음', async () => {
    await addUnrelated()
    const rows = await run(withApply(withIds(ROLLBACK, ACTIVE)))
    expect(await targetCount()).toBe(2)
    expect(await unrelatedCount()).toBe(2)
    const r = byName(rows)
    expect(r['r00 파일 전체 실행 확인']).toMatchObject({ verdict: 'OK', detail: '이번 실행: 삭제(v_apply = true)' })
    expect(r['r10 삭제 전 지정 범위(ID × 급여기간) 행']).toMatchObject({ verdict: 'OK', detail: '16 / 기대 16행' })
    expect(r['r11 실제 삭제 행']).toMatchObject({ verdict: 'OK', detail: '16행 삭제 / 기대 16행' })
    expect(r['r20 2026-10 이번 rollback 대상 ID의 남은 목표 행']).toMatchObject({ verdict: 'OK', detail: '0행 / 기대 0행' })
    expect(r['r20 2026-11 이번 rollback 대상 ID의 남은 목표 행']).toMatchObject({ verdict: 'OK', detail: '0행 / 기대 0행' })
    // 전체 직원 기준은 참고(INFO) — 비활성 직원의 2026-10 행 1개가 남아 있어도 r20과 섞이지 않는다
    expect(r['r30 2026-10 전체 직원의 목표 행(참고)']).toMatchObject({ verdict: 'INFO', detail: '1행' })
    expect(r['r31 전체 목표 행(모든 기간·참고)']).toMatchObject({ verdict: 'INFO', detail: '2행' })
    expect(rows.filter(x => x.verdict === 'FAIL')).toEqual([])
    const text = JSON.stringify(rows)
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    expect(text).not.toContain('가짜이름')
  })

  it.each([
    ['ID 7개', () => ACTIVE.slice(0, 7), /r02 ID 수 7 ≠ 8/],
    ['존재하지 않는 ID', () => [...ACTIVE.slice(0, 7), RANDOM_ID], /r05 overtime_employees에 없는 ID/],
    // 비활성 직원은 2026-10 행만 있다(addUnrelated) → 7 × 2 + 1 = 15
    ['2단계 대상이 아닌(비활성) 직원 ID', () => [...ACTIVE.slice(0, 7), INACTIVE], /r06 지정 범위\(ID × 급여기간\) 목표 행 15 ≠ 기대 16/],
    ['중복 ID', () => [...ACTIVE.slice(0, 7), ACTIVE[0]], /r04 중복 ID/],
    ['자리표시 ID', () => [...ACTIVE.slice(0, 7), '00000000-0000-0000-0000-000000000000'], /r03 자리표시 ID 남음/],
  ])('v_apply = true여도 %s이면 DELETE 전에 중단하고 16행 그대로', async (_name, ids, err) => {
    await addUnrelated()
    await expect(run(withApply(withIds(ROLLBACK, ids())))).rejects.toThrow(err)
    expect(await targetCount()).toBe(18)
  })

  it('기대 행은 v_expected × 급여기간 수 — v_expected와 ID를 함께 7로 적으면 정확히 14행만 지운다', async () => {
    const rows = await run(withApply(withExpected(withIds(ROLLBACK, ACTIVE.slice(0, 7)), 7)))
    expect(byName(rows)['r11 실제 삭제 행']).toMatchObject({ verdict: 'OK', detail: '14행 삭제 / 기대 14행' })
    expect(await targetCount()).toBe(2)
  })

  it('급여기간 중복이면 DELETE 전에 중단', async () => {
    const src = sub(withApply(withIds(ROLLBACK, ACTIVE)), /array\['2026-10', '2026-11'\]/, "array['2026-10', '2026-10']")
    await expect(run(src)).rejects.toThrow(/r01 급여기간 중복/)
    expect(await targetCount()).toBe(16)
  })

  it('지정 행 1개가 미리 없는 15행 상태면 DELETE 전에 중단하고 15행 그대로', async () => {
    await db.query("delete from public.overtime_monthly_targets where employee_id = $1 and period_label = '2026-11'", [ACTIVE[0]])
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/r06 지정 범위\(ID × 급여기간\) 목표 행 15 ≠ 기대 16/)
    expect(await targetCount()).toBe(15)
  })

  it('BEFORE DELETE 트리거가 한 행을 건너뛰면 실제 삭제 행 수(15) 불일치로 전체 되돌림 — 16행 그대로', async () => {
    await db.exec(`
      create function public.f_keep_one() returns trigger language plpgsql as $$
      begin
        if old.employee_id = '${ACTIVE[0]}' and old.period_label = '2026-11' then return null; end if;
        return old;
      end $$;
      create trigger t_keep_one before delete on public.overtime_monthly_targets for each row execute function public.f_keep_one();
    `)
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/r07 실제 삭제 행 15 ≠ 기대 16/)
    expect(await targetCount()).toBe(16)
  })

  it('BEFORE DELETE 트리거가 삭제를 막으면(오류) 전체 되돌림 — 16행 그대로', async () => {
    await db.exec(`
      create function public.f_block() returns trigger language plpgsql as $$ begin raise exception 'blocked by test'; end $$;
      create trigger t_block before delete on public.overtime_monthly_targets for each row execute function public.f_block();
    `)
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/blocked by test/)
    expect(await targetCount()).toBe(16)
  })

  it('삭제 중 지정 범위 행이 다시 생기면(트리거) r08로 전체 되돌림', async () => {
    await db.exec(`
      create function public.f_reinsert() returns trigger language plpgsql as $$
      begin
        if old.employee_id = '${ACTIVE[0]}' and old.period_label = '2026-11' then
          insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values (old.employee_id, old.period_label, old.target_hours);
        end if;
        return old;
      end $$;
      create trigger t_reinsert after delete on public.overtime_monthly_targets for each row execute function public.f_reinsert();
    `)
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/r08 삭제 후 지정 범위에 남은 행 1/)
    expect(await targetCount()).toBe(16)
  })

  it('삭제 중 범위 밖 행이 함께 지워지면(트리거) r09로 전체 되돌림 — 관련 없는 행 유지', async () => {
    await addUnrelated()
    await db.exec(`
      create function public.f_cascade() returns trigger language plpgsql as $$
      begin
        if old.employee_id = '${ACTIVE[0]}' and old.period_label = '2026-10' then
          delete from public.overtime_monthly_targets where period_label = '2026-12';
        end if;
        return old;
      end $$;
      create trigger t_cascade after delete on public.overtime_monthly_targets for each row execute function public.f_cascade();
    `)
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/r09 지정 범위 밖 행 2 → 1/)
    expect(await targetCount()).toBe(18)
    expect(await unrelatedCount()).toBe(2)
  })

  it('월 목표 강제조건 트리거가 있으면 중단', async () => {
    await db.exec(`
      create table public.t_dummy (id int);
      create function public.f_dummy() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger overtime_work_records_ab_monthly_target before insert on public.t_dummy for each row execute function public.f_dummy();
    `)
    await expect(run(withApply(withIds(ROLLBACK, ACTIVE)))).rejects.toThrow(/월 목표 강제조건이 이미 켜져 있다/)
    expect(await targetCount()).toBe(16)
  })
})

describe('결과 SELECT만 단독 실행하면 t00·r00이 FAIL(성공처럼 INFO만 나오지 않는다)', () => {
  const FILES = [
    { name: 'apply', gate: 't00 파일 전체 실행 확인', prefix: 'ot_apply', full: () => withIds(APPLY, ACTIVE), setup: async () => {} },
    { name: 'rollback', gate: 'r00 파일 전체 실행 확인', prefix: 'ot_rollback', full: () => withIds(ROLLBACK, ACTIVE),
      setup: async () => { await run(withApply(withIds(APPLY, ACTIVE))) } },
  ] as const
  const SELECT_ONLY = '결과 SELECT만 단독 실행한 상태다(이 트랜잭션에 DO 블록 결과 없음) — 파일 전체를 한 번에 실행한다'
  /** FAIL이 하나 이상, 게이트는 FAIL — "INFO만 있고 FAIL 0"이 되지 않는다 */
  const expectBlocked = (rows: Row[], gate: string) => {
    expect(byName(rows)[gate]).toMatchObject({ verdict: 'FAIL', detail: SELECT_ONLY })
    expect(rows.some(r => r.verdict === 'FAIL')).toBe(true)
    expect(rows.every(r => r.verdict === 'INFO')).toBe(false)
  }

  describe.each(FILES)('$name', f => {
    beforeEach(async () => { await f.setup() })
    const select = () => resultSelect(f.name === 'apply' ? APPLY : ROLLBACK)

    it('전체 정상 실행: 게이트 OK, FAIL 0, 기대 결과 행 모두 있음', async () => {
      const rows = await run(f.full())
      expect(verdictOf(rows, f.gate)).toBe('OK')
      expect(rows.filter(r => r.verdict === 'FAIL')).toEqual([])
      expect(keyRows(rows).map(k => k.split(' ')[0])).toEqual(f.name === 'apply'
        ? ['t00', 't01', 't01', 't02', 't02', 't03', 't04']
        : ['r00', 'r10', 'r11', 'r20', 'r20', 'r30', 'r30', 'r31', 'r32'])
    })

    it('같은 세션에서 결과 SELECT만 다시 실행하면 FAIL', async () => {
      await run(f.full())
      expectBlocked(await run(select()), f.gate)
    })

    it('새 세션(아무것도 실행하지 않은 연결)에서 결과 SELECT만 실행하면 FAIL', async () => {
      const other = new PGlite()
      try {
        await other.exec(`create table public.overtime_employees (id uuid primary key, name text, is_active boolean);
          create table public.engineer_contacts (id uuid primary key default gen_random_uuid(), employee_id uuid, company text, employment_status text);
          ${targetsTable()}`)
        const rows = (await other.exec(select())).filter(r => r.fields.length > 0).at(-1)!.rows as Row[]
        expectBlocked(rows, f.gate)
      } finally { await other.close() }
    })

    it('설정값이 빈 문자열이면 FAIL', async () => {
      const keys = ['state', 'labels', 'xact', 'ids', 'want', 'found', 'deleted']
      const blank = keys.map(k => `select pg_catalog.set_config('${f.prefix}.${k}', '', true);`).join('\n')
      expectBlocked(await run(`begin;\n${blank}\n${select()};\ncommit;`), f.gate)
    })

    it('설정 키가 다르면(오타) 전체 실행이어도 FAIL', async () => {
      const typo = sub(f.full(), new RegExp(`set_config\\('${f.prefix}\\.state'`), `set_config('${f.prefix}.stat'`)
      expectBlocked(await run(typo), f.gate)
    })

    it('설정값을 손으로 맞춰도 이 트랜잭션의 DO 블록 결과가 아니면 FAIL', async () => {
      // 직전 정상 실행의 값을 세션 단위로 그대로 흉내 낸다 — 트랜잭션 번호가 달라 통과하지 못한다
      await run(f.full())
      const forged = [
        `select pg_catalog.set_config('${f.prefix}.state', 'checked', false)`,
        `select pg_catalog.set_config('${f.prefix}.labels', '2026-10,2026-11', false)`,
        `select pg_catalog.set_config('${f.prefix}.ids', '${ACTIVE.join(',')}', false)`,
        `select pg_catalog.set_config('${f.prefix}.want', '16', false)`,
        `select pg_catalog.set_config('${f.prefix}.found', '16', false)`,
        `select pg_catalog.set_config('${f.prefix}.deleted', '0', false)`,
        `select pg_catalog.set_config('${f.prefix}.xact', pg_catalog.pg_current_xact_id()::text, false)`,
      ].join(';\n')
      await db.exec(`${forged};`)
      expectBlocked(await run(select()), f.gate)
      expectBlocked(await run(`begin;\n${select()};\ncommit;`), f.gate)
    })
  })
})

describe('월 목표 선입력 확인(overtime_monthly_target_precheck.sql)', () => {
  // 오늘 날짜에 기대지 않도록: 전월~3개월 뒤 라벨을 모두 넣으면 mt01은 반드시 OK, 1999-01 하나면 반드시 FAIL
  const around = () => {
    const now = new Date()
    return [-1, 0, 1, 2, 3].map(k => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1))
      return `'${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}'`
    })
  }
  const withLabels = (labels: string[]) => sub(PRECHECK, /array\['2026-10', '2026-11'\]::text\[\]/, `array[${labels.join(', ')}]::text[]`)

  it('mt01은 오류(42883) 없이 실행되고, 라벨이 모자라면 FAIL·충분하면 OK', async () => {
    const fail = byName((await db.query(withLabels(["'1999-01'"]))).rows as Row[])
    expect(fail['mt01_required_labels_in_settings']).toMatchObject({ status: 'FAIL' })
    const ok = byName((await db.query(withLabels(around()))).rows as Row[])
    expect(ok['mt01_required_labels_in_settings']).toMatchObject({ status: 'OK' })
  })

  it('적용 전에는 mt10 FAIL(8명 목표 없음), 적용 후에는 mt10 OK·mt20 없음·mt04 OK', async () => {
    const before = byName((await db.query(PRECHECK)).rows as Row[])
    expect(before['mt10_missing_count:2026-10']).toMatchObject({ status: 'FAIL', detail: '8명 목표 없음' })
    expect(before['mt03_active_employees']).toMatchObject({ detail: '8명 재직(is_active)' })

    await run(withApply(withIds(APPLY, ACTIVE)))
    const rows = (await db.query(PRECHECK)).rows as Row[]
    const after = byName(rows)
    expect(after['mt10_missing_count:2026-10']).toMatchObject({ status: 'OK' })
    expect(after['mt10_missing_count:2026-11']).toMatchObject({ status: 'OK' })
    expect(after['mt04_active_unlinked']).toMatchObject({ status: 'OK' })
    expect(rows.some(r => String(r.check_name).startsWith('mt20_'))).toBe(false)
  })
})
