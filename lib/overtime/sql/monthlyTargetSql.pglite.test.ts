/**
 * 월 목표 선입력 운영 SQL을 PGlite(메모리 안 PostgreSQL)에서 실제로 실행해 본다 — 운영·개발 DB에는 접속하지 않는다.
 *
 * - supabase/prod/overtime_monthly_targets_2_apply.sql: 검사만(기본) / 적용 / 두 번째 적용 중단 / 검사 실패 사례
 * - supabase/prod/overtime_monthly_targets_3_rollback.sql: 검사만(기본) / 삭제 / 강제조건이 있으면 중단
 * - supabase/verify/overtime_monthly_target_precheck.sql: mt01(<> all 배열 비교)이 오류 없이 OK·FAIL을 가른다
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
    expect(rows['t01 2026-10 대상 직원 목표 행']).toMatchObject({ verdict: 'NONE', detail: '0 / 8명' })
    expect(rows['t01 2026-11 대상 직원 목표 행']).toMatchObject({ verdict: 'NONE', detail: '0 / 8명' })
    expect(rows['t04 월 목표 강제조건 트리거']).toMatchObject({ detail: '없음(activation 전)' })
  })

  it('적용: 8명 × 2기간 = 16행, t01 OK·t02 분포, 두 번째 적용은 c11로 중단', async () => {
    const sql = withApply(withIds(APPLY, ACTIVE))
    const rows = await run(sql)
    expect(await targetCount()).toBe(16)
    const r = byName(rows)
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

  it('파일 그대로(자리표시 ID)는 r03으로 중단', async () => {
    await expect(run(ROLLBACK)).rejects.toThrow(/r03 자리표시 ID 남음/)
    expect(await targetCount()).toBe(16)
  })

  it('기본 검사 모드는 지우지 않고, v_apply = true면 지정 기간·ID만 지운다', async () => {
    const preview = byName(await run(withIds(ROLLBACK, ACTIVE)))
    expect(await targetCount()).toBe(16)
    expect(preview['r01 2026-10 남은 목표 행']).toMatchObject({ detail: '8행' })

    await db.query("insert into public.overtime_monthly_targets (employee_id, period_label, target_hours) values ($1, '2026-12', 10)", [ACTIVE[0]])
    const after = byName(await run(withApply(withIds(ROLLBACK, ACTIVE))))
    expect(after['r01 2026-10 남은 목표 행']).toMatchObject({ detail: '0행' })
    expect(after['r01 2026-11 남은 목표 행']).toMatchObject({ detail: '0행' })
    expect(after['r02 전체 목표 행(모든 기간)']).toMatchObject({ detail: '1행' })
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
