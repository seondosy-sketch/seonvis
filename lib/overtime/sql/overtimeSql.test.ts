/**
 * 연장근무 Supabase SQL 정적 검사 — 파일 내용만 읽는다(DB에 접속하지 않는다).
 *
 * - Migration C의 함수 본문 = 신규 설치용 A·B의 정의(공백 정규화 후 글자 그대로)
 * - 초안 트리거는 상태 전이에서 달력 값을 다시 계산하지 않고, 확정 RPC는 기록 생성 전에 한 번 다시 계산한다
 * - 되돌리기 순서: 격리수준 되돌리기 → 월 목표 되돌리기 (체크리스트·activation·문서·되돌리기 파일 머리말 모두 같은 줄)
 * - 격리수준 되돌리기는 월 목표 함수를 있을 때만 다시 만든다
 * - 직원 분리 방지: preflight p10·p11 동시 STOP, sync_team_employees가 데이터 변경 전에 OVERTIME_EMPLOYEE_LINK_REQUIRED
 * - 새 dev SQL은 개발 DB 안전장치를 갖고, 새 verify·dev SQL은 check_name / status / detail로 결과를 낸다
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { bodyFingerprint, finalFunctions, fnKey, functionsIn, identityArgs, normalizeType } from './migrationFunctions'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n')
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

const A = 'supabase/migration_overtime_planning_a_base.sql'
const B = 'supabase/migration_overtime_planning_b_activate.sql'
const C = 'supabase/migration_overtime_planning_c_corrections.sql'

const H_GUARD = 'create or replace function private.overtime_drafts_guard()'
const H_SAVE = 'create or replace function public.overtime_save_assignment_run(p_run jsonb, p_drafts jsonb)'
const H_CONF = 'create or replace function public.overtime_confirm_run(p_run_id uuid, p_employee_ids uuid[] default null)'
const H_SYNC = 'create or replace function public.sync_team_employees()'

/** header부터 그 함수의 끝(`end $$;`)까지. 없으면 테스트 실패. */
function fnBlock(src: string, header: string): string {
  const i = src.indexOf(header)
  expect(i, `함수 없음: ${header}`).toBeGreaterThanOrEqual(0)
  const j = src.indexOf('\nend $$;', i)
  expect(j).toBeGreaterThan(i)
  return src.slice(i, j + '\nend $$;'.length)
}

/** 순서대로 나타나는지(앞 문자열의 첫 위치 < 뒤 문자열의 첫 위치) */
function expectOrder(text: string, parts: string[]) {
  let last = -1
  for (const p of parts) {
    const k = text.indexOf(p, last + 1)
    expect(k, `순서 어긋남 또는 없음: ${p}`).toBeGreaterThan(last)
    last = k
  }
}

const ORDER_LINE =
  '되돌리기 순서: overtime_planning_c_rollback → overtime_cap_isolation_guard_rollback → overtime_monthly_target_rollback → overtime_planning_rollback_b → overtime_project_sync_rpc_rollback → overtime_planning_rollback_a'

describe('Migration C = A·B 신규 설치 정의', () => {
  const a = read(A)
  const b = read(B)
  const c = read(C)

  it.each([
    ['초안 트리거', b, H_GUARD],
    ['저장 RPC', b, H_SAVE],
    ['확정 RPC', b, H_CONF],
    ['직원 동기화', a, H_SYNC],
  ])('%s 본문이 같다', (_name, src, header) => {
    expect(norm(fnBlock(c, header))).toBe(norm(fnBlock(src, header)))
  })

  it('C는 정확히 함수 4개만 create or replace 하고 같은 권한문을 다시 적용한다', () => {
    const creates = c.match(/^create or replace function [^\n]+/gm) ?? []
    expect(creates.map(s => s.trim())).toEqual([H_GUARD, H_SAVE, H_CONF, H_SYNC])
    for (const line of [
      'revoke all on function private.overtime_drafts_guard() from public, anon, authenticated, service_role;',
      'grant execute on function public.overtime_save_assignment_run(jsonb, jsonb) to authenticated;',
      'grant execute on function public.overtime_confirm_run(uuid, uuid[]) to authenticated;',
      'grant execute on function public.sync_team_employees() to authenticated, service_role;',
    ]) {
      expect(c).toContain(line)
    }
    expect(c).not.toMatch(/\b(drop|create) trigger\b/i)
    // 함수 본문을 뺀 나머지(전제 확인·권한문·확인 SELECT)에는 데이터 변경이 없다
    let outside = c
    for (const h of [H_GUARD, H_SAVE, H_CONF, H_SYNC]) outside = outside.replace(fnBlock(c, h), '')
    expect(outside).not.toMatch(/\b(update|delete from|insert into)\s+public\./i)
  })

  it('C는 begin/commit 한 트랜잭션이고 전제 확인(A·B)이 함수 교체보다 먼저다', () => {
    expectOrder(c, ['\nbegin;\n', 'Migration A가 적용되지 않았다', 'Migration B가 적용되지 않았다', H_GUARD, '\ncommit;\n'])
  })
})

describe('MAJOR 6 — 상태 전이에서 달력 값 유지, 확정 직전 재계산', () => {
  const guard = fnBlock(read(B), H_GUARD)
  const confirm = fnBlock(read(B), H_CONF)
  const save = fnBlock(read(B), H_SAVE)

  it('초안 트리거: 상태 전이·draft 아닌 행은 재계산 전에 return', () => {
    const skip = "if tg_op = 'UPDATE' and (old.status <> 'draft' or new.status <> 'draft') then"
    expectOrder(guard, [skip, 'return new;', "new.start_time := '18:00'", 'new.is_weekend :=', 'new.is_holiday := exists'])
    const between = guard.slice(guard.indexOf(skip), guard.indexOf('new.is_holiday := exists'))
    const skipBody = between.slice(0, between.indexOf('end if;'))
    expect(skipBody).not.toMatch(/new\.(is_weekend|is_holiday|exception_reason|start_time|end_time|hours|break_hours)\s*:=/)
    // 비소유자 금지 규칙은 그대로
    expect(guard).toContain("raise exception 'OVERTIME_DRAFT_NOT_EDITABLE'")
    expect(guard).toContain("raise exception 'OVERTIME_DRAFT_STATUS_RPC_ONLY'")
  })

  it('확정 RPC: 재계산 UPDATE → 재조회 → 그 값으로 기록 INSERT → 상태만 UPDATE', () => {
    expectOrder(confirm, [
      'update public.overtime_assignment_drafts x',
      "then coalesce(x.exception_reason, '확정 시 공휴일 변경 반영')",
      'select * into v_fresh from public.overtime_assignment_drafts x where x.id = d.id;',
      'insert into public.overtime_work_records',
      'v_fresh.exception_reason',
      "update public.overtime_assignment_drafts set status = 'confirmed', confirmed_at = v_now where id = d.id;",
    ])
    const insert = confirm.slice(confirm.indexOf('insert into public.overtime_work_records'), confirm.indexOf("set status = 'confirmed'"))
    expect(insert).not.toMatch(/\bd\.exception_reason\b/)
  })

  it('저장 RPC: is_holiday가 공휴일 표와 다르면 아무것도 쓰기 전에 OVERTIME_HOLIDAY_CHANGED(55000)', () => {
    expectOrder(save, [
      'as x(work_date date, is_holiday boolean)',
      "raise exception 'OVERTIME_HOLIDAY_CHANGED: % 공휴일 여부가 다름', v_changed using errcode = '55000';",
      'insert into public.overtime_assignment_runs',
    ])
    expect(save).toContain('where x.is_holiday is not null')
  })

  it('확정취소 비교는 그대로(초안 사유 = 기록 사유)', () => {
    const unconfirm = read(B).slice(read(B).indexOf('create or replace function public.overtime_unconfirm_drafts'))
    expect(unconfirm).toContain('r.assignment_exception_reason, r.confirmed_at)')
    expect(unconfirm).toContain('d.exception_reason, d.confirmed_at) then')
  })
})

describe('MAJOR 7 — 되돌리기 순서', () => {
  const files = [
    'supabase/prod/overtime_prod_checklist.md',
    'supabase/prod/overtime_monthly_target_activation.sql',
    'docs/overtime-planning-db.md',
    C,
    'supabase/verify/overtime_planning_c_rollback.sql',
    'supabase/verify/overtime_cap_isolation_guard_rollback.sql',
    'supabase/verify/overtime_monthly_target_rollback.sql',
    'supabase/verify/overtime_planning_rollback_b.sql',
    'supabase/verify/overtime_project_sync_rpc_rollback.sql',
    'supabase/verify/overtime_planning_rollback_a.sql',
  ]

  it.each(files)('%s 에 같은 순서 줄이 있다', f => {
    expect(read(f)).toContain(ORDER_LINE)
  })

  it.each(files)('%s 에 월 목표 → 격리수준(반대) 순서가 없다', f => {
    for (const line of read(f).split('\n')) {
      const m = line.indexOf('overtime_monthly_target_rollback')
      const iso = line.indexOf('overtime_cap_isolation_guard_rollback')
      if (m >= 0 && iso >= 0) expect(iso, line).toBeLessThan(m)
    }
  })

  it('격리수준 되돌리기는 월 목표·주 12시간 함수를 있을 때만 다시 만든다', () => {
    const s = read('supabase/verify/overtime_cap_isolation_guard_rollback.sql')
    const body = s.slice(s.indexOf('\nbegin;\n'))
    for (const fn of ['overtime_assert_monthly_target', 'overtime_assert_weekly_cap']) {
      const create = body.indexOf(`create or replace function private.${fn}(`)
      const cond = body.indexOf(`if to_regprocedure('private.${fn}(uuid, date, numeric, uuid, numeric)') is not null then`)
      expect(cond, fn).toBeGreaterThanOrEqual(0)
      expect(create, fn).toBeGreaterThan(cond)
      expect(body.slice(cond, create)).toContain('execute $fn$')
      // 조건문 밖(맨 앞)에서 바로 만드는 문장이 없다
      expect(body.match(new RegExp(`^create or replace function private\\.${fn}\\(`, 'gm'))?.length ?? 0).toBe(1)
    }
    expect(body.indexOf('do $do$')).toBeLessThan(body.indexOf('create or replace function'))
  })

  it('A·B 되돌리기는 월 목표 강제조건이 남아 있으면 멈춘다', () => {
    expect(read('supabase/verify/overtime_planning_rollback_a.sql')).toContain("tgname = 'overtime_work_records_ab_monthly_target'")
    expect(read('supabase/verify/overtime_planning_rollback_b.sql')).toContain("tgname = 'overtime_work_records_ab_monthly_target'")
  })

  it('리허설 단계 파일은 되돌리기 파일 본문을 글자 그대로 담는다', () => {
    const inner = (rel: string) => {
      const lines = read(rel).split('\n')
      const b = lines.indexOf('begin;')
      const c = lines.lastIndexOf('commit;')
      return lines.slice(b + 1, c).join('\n').trim()
    }
    const pairs: Array<[string, string]> = [
      ['supabase/dev/overtime_rollback_rehearsal_2_c.sql', 'supabase/verify/overtime_planning_c_rollback.sql'],
      ['supabase/dev/overtime_rollback_rehearsal_3_isolation.sql', 'supabase/verify/overtime_cap_isolation_guard_rollback.sql'],
      ['supabase/dev/overtime_rollback_rehearsal_4_monthly.sql', 'supabase/verify/overtime_monthly_target_rollback.sql'],
      ['supabase/dev/overtime_rollback_rehearsal_6_b.sql', 'supabase/verify/overtime_planning_rollback_b.sql'],
      ['supabase/dev/overtime_rollback_rehearsal_7_sync_rpc.sql', 'supabase/verify/overtime_project_sync_rpc_rollback.sql'],
      ['supabase/dev/overtime_rollback_rehearsal_8_a.sql', 'supabase/verify/overtime_planning_rollback_a.sql'],
    ]
    for (const [step, src] of pairs) {
      const s = read(step)
      expect(norm(s), step).toContain(norm(inner(src)))
      // 안전장치(확인 표지·개발 DB)가 본문보다 먼저
      expectOrder(s, ["current_setting('overtime.rehearsal_ack', true)", '개발용 DB가 아닌 것 같습니다', `↓ ${src} 본문 시작`])
    }
  })

  it('activation: 맨 앞에서 월 목표 선입력을 다시 확인하고, precheck 파일을 안내한다', () => {
    const s = read('supabase/prod/overtime_monthly_target_activation.sql')
    expect(s).toContain('supabase/verify/overtime_monthly_target_precheck.sql')
    expectOrder(s, ['\nbegin;\n', "at time zone 'Asia/Seoul'", 'between 14 and 20', 'activation 중단: 월 목표 미입력', 'create or replace function private.overtime_pay_period_label'])
  })
})

describe('MAJOR 8 — 직원 분리 방지', () => {
  it('preflight: p10·p11이 둘 다 0보다 크면 둘 다 STOP', () => {
    const s = read('supabase/verify/overtime_planning_preflight.sql')
    const p10 = s.slice(s.indexOf("select 'p10_unlinked_active_employees'"), s.indexOf("select 'p11_unlinked_team_contacts'"))
    const p11 = s.slice(s.indexOf("select 'p11_unlinked_team_contacts'"), s.indexOf("select 'p12_"))
    expect(p10).toContain("when l.unlinked_employees = 0 then 'OK' when l.unlinked_contacts > 0 then 'STOP'")
    expect(p11).toContain("when l.unlinked_contacts = 0 then 'OK' when l.unlinked_employees > 0 then 'STOP'")
  })

  it('sync_team_employees: 데이터를 바꾸기 전에 OVERTIME_EMPLOYEE_LINK_REQUIRED', () => {
    const sync = fnBlock(read(A), H_SYNC)
    expectOrder(sync, [
      'if v_unlinked_contacts > 0 and v_unlinked_employees > 0 then',
      "raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED",
      'insert into public.overtime_employees',
    ])
    const raiseAt = sync.indexOf('OVERTIME_EMPLOYEE_LINK_REQUIRED')
    expect(sync.slice(0, raiseAt)).not.toMatch(/\b(insert into|update public\.|delete from)\b/)
    expect(sync).not.toMatch(/e\.name\s*=\s*rec\.name/)   // 이름 자동 매칭 없음
  })

  it.each([A, C])('%s: 0단계 안전장치가 데이터·스키마 변경보다 먼저', f => {
    const s = read(f)
    const raiseAt = s.indexOf("raise exception 'OVERTIME_EMPLOYEE_LINK_REQUIRED")
    const firstChange = s.search(/^(create|alter|drop|insert|update|delete|revoke|grant)\b/m)
    expect(raiseAt).toBeGreaterThan(0)
    expect(raiseAt).toBeLessThan(firstChange)
  })

  it('연결 확인 파일은 읽기만 하고 자동 연결 SQL이 없다', () => {
    const s = read('supabase/verify/overtime_employee_link_check.sql')
    const code = s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(update|insert|delete|alter|drop|create)\b/i)
    expect(code).not.toMatch(/mobile_phone|office_phone|email|address/)
  })

  it('postflight A는 직원 UUID 보존을 확인한다', () => {
    const s = read('supabase/verify/overtime_planning_postflight_a.sql')
    for (const k of ['a16_records_employee_exists', 'a17_targets_employee_exists', 'a18_tasks_employee_exists',
      'a19_members_employee_exists', 'a20_split_suspects', 'a21_employee_link_required']) {
      expect(s).toContain(k)
    }
  })
})

describe('새 dev·verify SQL 형식', () => {
  const devDir = path.join(ROOT, 'supabase/dev')
  const newDev = [
    'overtime_confirm_holiday_test.sql',
    'overtime_employee_link_test.sql',
    // 기준 상태 기록(_baseline)은 읽기 전용 SELECT 한 문장 + check_name / detail 두 열 — 아래 별도 describe에서 확인
    ...readdirSync(devDir).filter(f => f.startsWith('overtime_rollback_rehearsal_') && f !== 'overtime_rollback_rehearsal_baseline.sql'),
  ].map(f => `supabase/dev/${f}`)
  const newVerify = [
    'supabase/verify/overtime_planning_c_preflight.sql',
    'supabase/verify/overtime_planning_c_postflight.sql',
    'supabase/verify/overtime_planning_c_rollback.sql',
    'supabase/verify/overtime_employee_link_check.sql',
    'supabase/verify/overtime_monthly_target_precheck.sql',
  ]

  it('리허설 파일이 모두 있다', () => {
    expect(newDev.length).toBe(2 + 11)
  })

  it.each(newDev)('%s: 개발 DB 안전장치가 첫 변경보다 먼저', f => {
    const s = read(f)
    const code = s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    const guard = code.indexOf('개발용 DB가 아닌 것 같습니다')
    expect(guard).toBeGreaterThan(0)
    expect(code).toContain('(select count(*) from public.projects) > 10')
    const firstChange = code.search(/^\s*(insert into public|update public|delete from public|drop |create view|create table private|alter )/m)
    if (firstChange >= 0) expect(guard).toBeLessThan(firstChange)
  })

  it.each([...newDev, ...newVerify])('%s: 마지막 결과가 check_name / status / detail', f => {
    const s = read(f)
    const lastSelect = s.slice(s.lastIndexOf('\nselect '))
    expect(lastSelect).toMatch(/check_name/)
    expect(lastSelect).toMatch(/status/)
    expect(lastSelect).toMatch(/detail/)
  })

  it.each([...newDev, ...newVerify])('%s: TRUNCATE·운영 표 drop table 없음(되돌리기 본문 제외)', f => {
    const code = read(f).split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\btruncate\s+(table\s+)?public\./i)
    if (!/rollback/.test(f)) expect(code).not.toMatch(/\bdrop table\s+(if exists\s+)?public\./i)
  })
})

describe('현재 상태 사후확인(overtime_planning_current_postflight.sql)', () => {
  const CUR = 'supabase/verify/overtime_planning_current_postflight.sql'
  const cur = read(CUR)
  const ROW = /\('(public|private)', '([a-z_]+)', '([^']*)', '([0-9a-f]{32})', '([a-z]+)', '([isv])', (true|false), (null|'[^']*'), '([a-z_]+\.sql)'\)/g
  const embedded = [...cur.matchAll(ROW)].map(m => ({
    key: `${m[1]}.${m[2]}(${m[3]})`, name: `${m[1]}.${m[2]}`, md5: m[4], lang: m[5], volatility: m[6],
    definer: m[7] === 'true', searchPath: m[8] === 'null' ? null : m[8].slice(1, -1), file: m[9],
  }))

  it('함수 지문·속성이 저장소 migration 체인의 최종 정의와 같다(스키마.이름 + 인자 타입 단위, 집합도 같다)', () => {
    const fns = finalFunctions(path.join(ROOT, 'supabase'))
    expect(embedded.length).toBe(21)
    expect(embedded.map(e => e.key).sort()).toEqual([...fns.keys()].sort())
    for (const e of embedded) {
      const f = fns.get(e.key)!
      expect({ ...e }).toEqual({
        key: fnKey(f), name: `${f.schema}.${f.name}`, md5: bodyFingerprint(f.body), lang: f.language, volatility: f.volatility,
        definer: f.securityDefiner, searchPath: f.searchPath, file: f.file,
      })
    }
  })

  it('C가 바꾼 함수의 지문 = 신규 설치용 A·B 정의의 지문(C 적용 후 원본과 같은 본문)', () => {
    const bySrc = (file: string) => new Map(functionsIn(read(`supabase/${file}`), file).map(f => [f.name, bodyFingerprint(f.body)]))
    const a = bySrc('migration_overtime_planning_a_base.sql')
    const b = bySrc('migration_overtime_planning_b_activate.sql')
    const md5Of = (name: string) => embedded.find(e => e.name === name)!.md5
    for (const n of ['overtime_drafts_guard', 'overtime_save_assignment_run', 'overtime_confirm_run']) expect(md5Of(`${n.startsWith('overtime_drafts') ? 'private' : 'public'}.${n}`)).toBe(b.get(n))
    expect(md5Of('public.sync_team_employees')).toBe(a.get('sync_team_employees'))
  })

  it('지문 정규화: DB 식과 같은 규칙, 리터럴 밖 공백·줄바꿈·CR은 무시, 리터럴 안 공백은 보존', () => {
    expect(cur).toContain(String.raw`regexp_replace(x.s, E'[ \t\n\r\f\013]+', ' ', 'g')`)
    expect(cur).toContain(String.raw`else replace(x.s, E'\r\n', E'\n') end, '''' order by x.n)`)
    expect(cur).toContain(`from regexp_split_to_table(p.prosrc, '''') with ordinality as x(s, n)`)
    expect(bodyFingerprint('\r\n  select 1;\t\n')).toBe(bodyFingerprint('select 1;'))
    expect(bodyFingerprint("x := 'a  b';")).not.toBe(bodyFingerprint("x := 'a b';"))          // 리터럴 안 공백은 의미
    expect(bodyFingerprint("x := 'it''s';  y")).toBe(bodyFingerprint("x := 'it''s'; y"))       // '' 이스케이프 뒤에도 짝 유지
    expect(bodyFingerprint("x := 'it''s  x';")).not.toBe(bodyFingerprint("x := 'it''s x';"))
  })

  it('$태그$ 이름·인자 표기 차이는 같은 함수로 본다(본문은 태그 사이만, 인자는 identity 형식으로 정규화)', () => {
    const one = functionsIn('create or replace function private.f(p_a public.uuid, out o int, p_b int default 1)\nreturns void language plpgsql\nas $$\nbegin null; end $$;', 'x')[0]
    const two = functionsIn('create or replace function private.f(p_a uuid,OUT o int4, p_b integer = 1)\nreturns void language plpgsql\nas $fn$ begin null; end $fn$;', 'x')[0]
    // pg_get_function_identity_arguments처럼 OUT 표시는 남기고(IN 생략) 기본값은 뺀다 — overtime_pay_period(p_label text, out …) 회귀
    expect(one.identityArgs).toBe('p_a uuid, out o integer, p_b integer')
    expect(identityArgs('p_label text, OUT period_start date, out period_end date')).toBe('p_label text, out period_start date, out period_end date')
    expect(two.identityArgs).toBe(one.identityArgs)
    expect(bodyFingerprint(two.body)).toBe(bodyFingerprint(one.body))
    expect(normalizeType('pg_catalog.int4[]')).toBe('integer[]')
    // DB 쪽도 인자 타입의 스키마 수식을 지운다
    expect(cur).toContain(String.raw`regexp_replace(lower(pg_catalog.pg_get_function_identity_arguments(p.oid)), '\m(public|pg_catalog)\.', '', 'g')`)
  })

  it('오버로드는 이름이 아니라 인자 타입까지로 구분하고, 예상하지 않은 오버로드는 별도 FAIL', () => {
    expect(cur).toMatch(/d\.schema_name = b\.schema_name and d\.fn_name = b\.fn_name and d\.identity_args = b\.identity_args/)
    expect(cur).toContain("'cur_fn_overload'")
    expect(cur).toContain("'cur_fn_attr:'")
  })

  it('보안 기대값이 지문 목록의 함수 전부를 다룬다', () => {
    const sec = [...cur.matchAll(/\('(public|private)', '([a-z_]+)', (true|false), '([a-z_,]*)'\)/g)].map(m => ({ name: `${m[1]}.${m[2]}`, definer: m[3] === 'true' }))
    expect(sec.map(x => x.name).sort()).toEqual(embedded.map(e => e.name).sort())
    // 보안 기대값의 DEFINER 여부가 저장소 정의와 같다
    for (const x of sec) expect({ ...x }).toEqual({ name: x.name, definer: embedded.find(e => e.name === x.name)!.definer })
  })

  it('결과 열은 check_name / status / detail, 판정 값은 OK·INFO·FAIL만', () => {
    expect(cur).toMatch(/checks\(check_name, status, detail\) as \(/)
    expect(cur).toMatch(/select check_name, status, detail from checks order by check_name;\s*$/)
    expect(cur.replace(/--[^\n]*/g, '')).not.toMatch(/verdict/)
    // 'PUBLIC'은 판정 값이 아니라 EXECUTE 권한 목록 표시(aclexplode grantee 0)
    const literals = new Set([...cur.matchAll(/(?:then|else) '([A-Z]+)'/g)].map(m => m[1]).filter(v => v !== 'PUBLIC'))
    expect([...literals].sort()).toEqual(['FAIL', 'OK'])
    const plain = new Set([...cur.matchAll(/^\s*select '[a-z0-9_:]+', '([A-Z]+)',/gm)].map(m => m[1]))
    expect([...plain]).toEqual(['INFO'])
  })

  it('정상 현재 상태에서 FAIL이 나오는 A 직후 전용 조건을 쓰지 않는다(예상 FAIL 없음)', () => {
    // postflight_a의 a04(새 열 비어 있음)·a10(기록 트리거 0개)·a13(새 표 비어 있음)은 B 적용 후 정상 DB에서 항상 FAIL
    expect(cur).not.toMatch(/source is not null or assignment_run_id is not null/)
    expect(cur).not.toMatch(/count\(\*\) from public\.overtime_assignment_runs\) \+ \(select count\(\*\) from public\.overtime_assignment_drafts\) = 0/)
    expect(cur).not.toMatch(/A에서는 0/)
    // FAIL은 모두 조건(case) 안에서만 — 무조건 FAIL 행 없음
    expect(cur).not.toMatch(/select '[a-z0-9_:]+', 'FAIL'/)
    // 기록 트리거는 정확히 3개(잠금 → 월 목표 → 주 12시간) 기대
    expect(cur).toContain("'overtime_work_records_a_protect → overtime_work_records_ab_monthly_target → overtime_work_records_b_weekly_cap'")
  })

  it('필수 확인 항목이 모두 있다', () => {
    for (const name of ['cur_a01_tables', 'cur_a02_rls', 'cur_a03_record_columns', 'cur_a04_constraints', 'cur_a05_indexes',
      'cur_a07_policies_expected', 'cur_a08_policies_unexpected', 'cur_fn_body:', 'cur_fn_attr:', 'cur_fn_overload', 'cur_fn_security:', 'cur_fn_unexpected',
      'cur_fn_owner_equals_table_owner', 'cur_trg_expected', 'cur_trg_unexpected', 'cur_trg_record_order',
      'cur_m03_isolation_guard:', 'cur_c01_guard_snapshot', 'cur_e01_sync_stops_before_change', 'cur_e02_link_state',
      'cur_d01_employee_refs', 'cur_d03_confirmed_snapshot_mismatch', 'cur_d06_records_without_target',
      'cur_d07_weeks_over_cap_records', 'cur_d08_weeks_over_cap_with_drafts', 'cur_r01_self_cleaning_tests', 'cur_s01_sync_source_index']) {
      expect(cur).toContain(`'${name}`)
    }
  })

  it('읽기 전용(쓰기·DDL 없음)', () => {
    const code = cur.replace(/--[^\n]*/g, '').replace(/'[^']*'/g, "''")
    expect(code).not.toMatch(/\b(insert\s+into|update\s+public|delete\s+from|create\s+(table|function|policy|trigger)|alter\s+|drop\s+|truncate)\b/i)
  })

  it('문서·체크리스트가 가리키는 supabase SQL 경로가 모두 실제로 있다', () => {
    for (const doc of ['supabase/prod/overtime_prod_checklist.md', 'docs/overtime-planning-db.md', 'docs/menu-access-control.md', CUR]) {
      for (const m of read(doc).matchAll(/supabase\/(?:verify|dev|prod)\/[a-z0-9_]+\.sql|supabase\/migration_[a-z0-9_]+\.sql/g)) {
        expect({ doc, path: m[0], exists: readdirSync(path.join(ROOT, path.dirname(m[0]))).includes(path.basename(m[0])) })
          .toEqual({ doc, path: m[0], exists: true })
      }
    }
  })
})

describe('개발 시험 관리자 승격·원복(overtime_test_admin_enable/restore.sql)', () => {
  const EN = 'supabase/dev/overtime_test_admin_enable.sql'
  const RE = 'supabase/dev/overtime_test_admin_restore.sql'
  const TT = 'supabase/dev/overtime_test_admin_toggle_test.sql'
  const noComments = (s: string) => s.replace(/--[^\n]*/g, '')
  const shared = (s: string) => {
    const i = s.indexOf('-- BEGIN shared:ot_test_admin')
    const j = s.indexOf('-- END shared:ot_test_admin')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(j).toBeGreaterThan(i)
    return s.slice(i, j)
  }
  const [en, re, tt] = [read(EN), read(RE), read(TT)]
  const fnSet = (s: string) => {
    const sh = shared(s)
    return sh.slice(sh.indexOf('create or replace function pg_temp.ot_test_admin_set'))
  }

  it('세 파일의 shared 블록(가드·승격·원복 함수)이 글자 그대로 같다', () => {
    expect(shared(re)).toBe(shared(en))
    expect(shared(tt)).toBe(shared(en))
  })

  it('개발 DB 가드가 어떤 UPDATE보다 먼저 — 함수 첫 동작이 가드 호출, 가드에 운영 흔적 4가지', () => {
    const f = noComments(fnSet(en))
    expect(f.indexOf('perform pg_temp.ot_test_admin_guard();')).toBeGreaterThan(0)
    expect(f.indexOf('perform pg_temp.ot_test_admin_guard();')).toBeLessThan(f.indexOf('update public.allowed_users'))
    expect(f.indexOf('perform pg_temp.ot_test_admin_guard();')).toBeLessThan(f.indexOf('select count(*) into v_rows'))
    const g = shared(en)
    for (const m of ['시험용이 아닌 연장근무 직원', '시험용이 아닌 연장근무 기록', 'projects가 10건을 넘습니다', '시험용이 아닌 승인 사용자가 3명을 넘습니다']) expect(g).toContain(m)
    // shared 밖(파일 본문)에는 데이터 변경이 없다 — 임시 결과 표와 함수 호출뿐
    for (const s of [en, re]) {
      const outside = noComments(s.replace(shared(s), ''))
      expect(outside).not.toMatch(/\b(update|delete\s+from|insert\s+into\s+public)\b/i)
    }
  })

  it('대상 이메일은 고정값 하나(shared 안 상수 1회), 정확히 1행이 아니면 중단', () => {
    for (const s of [en, re, tt]) {
      expect(noComments(s).match(/ot-ui-test@example\.com/g)).toHaveLength(1)
    }
    const f = fnSet(en)
    expect(f).toContain("c_email constant text := 'ot-ui-test@example.com';")
    expect(f).toMatch(/if v_rows <> 1 then\s+raise exception 'OVERTIME_TEST_ADMIN: 대상 행이 정확히 1개가 아님/)
  })

  it('is_admin 한 열만, 그 한 행만 바꾸고 — 다른 열·다른 행 지문을 변경 전후로 비교한다', () => {
    const f = noComments(fnSet(en))
    const updates = [...f.matchAll(/update\s+public\.allowed_users\s+set\s+([^;]+);/gi)].map(m => m[1].replace(/\s+/g, ' '))
    expect(updates).toEqual(['is_admin = p_target where email = c_email and is_admin is distinct from p_target'])
    expect(f).not.toMatch(/delete\s+from|insert\s+into\s+public/i)
    expect(f).toMatch(/if v_changed <> 1 then/)
    expect(f).toContain("(to_jsonb(u) - 'is_admin')")            // 대상 행의 다른 열
    expect(f).toMatch(/where u\.email <> c_email;/)                // 다른 행
    expect(f).toMatch(/v_self_after <> v_self_before or v_others_after <> v_others_before/)
  })

  it('예외 문구에 boolean을 그대로 넣지 않는다 — %는 t/f로 찍혀 기대 문구(true/false)와 달라진다(::text로 변환)', () => {
    const f = noComments(fnSet(en))
    expect(f).toContain("'OVERTIME_TEST_ADMIN: 변경 전 is_admin이 %여야 함 (현재 %)', (not p_target)::text, coalesce(v_before::text, 'null');")
    for (const m of f.matchAll(/raise exception '[^']*%[^']*',([^;]+);/g)) {
      for (const arg of m[1].split(/,(?![^(]*\))/).map(x => x.trim())) {
        expect(arg, `boolean 인자는 ::text로: ${arg}`).not.toMatch(/^(not\s+)?p_target$|^v_(before|after)$/)
      }
    }
  })

  it('변경 전 상태가 맞아야만 진행 — 두 번째 승격·원복은 중단, 다른 관리자가 있으면 승격하지 않음', () => {
    const f = fnSet(en)
    expect(f).toMatch(/if v_before is distinct from \(not p_target\) then\s+raise exception 'OVERTIME_TEST_ADMIN: 변경 전 is_admin이/)
    expect(f).toMatch(/if v_other_admins > 0 then\s+raise exception 'OVERTIME_TEST_ADMIN: 이미 다른 관리자/)
  })

  it('enable은 true로, restore는 false로 — 한 트랜잭션, 결과 열 check_name / status / detail', () => {
    expect(noComments(en)).toMatch(/begin;[\s\S]*select pg_temp\.ot_test_admin_set\(true\);\s*commit;/)
    expect(noComments(re)).toMatch(/begin;[\s\S]*select pg_temp\.ot_test_admin_set\(false\);\s*commit;/)
    expect(noComments(en)).not.toMatch(/ot_test_admin_set\(false\)/)
    expect(noComments(re)).not.toMatch(/ot_test_admin_set\(true\)/)
    for (const s of [en, re, tt]) expect(s.trimEnd()).toMatch(/select check_name, status, detail from pg_temp\.ot_admin(_test)?_results order by seq;$/)
  })

  it('개인정보를 출력하지 않는다 — 결과 detail에 이메일·이름을 붙이지 않음', () => {
    for (const s of [en, re, tt]) {
      const code = noComments(s)
      expect(code).not.toMatch(/\|\|\s*(c_email|u\.email|email|name)\b/)
      expect(code).not.toMatch(/raise exception '[^']*%[^']*',\s*(c_email|email)\b/)
    }
  })

  it('동작 시험: 정상 흐름·두 번 실행 중단·0행·2행·운영 흔적·다른 관리자·잔여 0을 모두 다룬다', () => {
    for (const name of ['T0 개발 DB 가드', 'T1-1 승격 후', 'T1-2 두 번째 승격 거부', 'T1-3 원복 후', 'T1-4 두 번째 원복 거부',
      'T1-5 대상 행의 다른 열 불변', 'T1-6 다른 사용자 행 불변', 'T2 대상 0행', 'T3 대상 2행', 'T4 운영 흔적', 'T5 다른 관리자 있음', 'Z 시험 후']) {
      expect(tt).toContain(`'${name}`)
    }
    // 예상 거부 시나리오 5개(T1-2·T1-4·T2·T4·T5)는 같은 방식: 오류를 v_err로 받고, 기대 오류일 때만 OK·아니면(거부 안 됨 포함) FAIL,
    // detail에 기대 오류와 실제 결과를 함께 적는다
    const rejections = [...tt.matchAll(/jsonb_build_object\('c', '(T1-2|T1-4|T2|T4|T5)[^']*', 's',\s*case when v_err like '([^']+)'[\s\S]*?then 'OK' else 'FAIL' end,\s*'d', '기대 거부: ([^']+) \/ 실제: ' \|\| coalesce\(left\(v_err, 80\), '거부되지 않음'\)\)/g)]
    expect(rejections.map(m => m[1])).toEqual(['T1-2', 'T1-4', 'T2', 'T4', 'T5'])
    expect(tt.match(/exception when others then v_err := sqlerrm;/g)).toHaveLength(5)
    expect(tt).not.toMatch(/'s', 'FAIL', 'd', '중단되지 않음'/)
    // 시나리오는 모두 하위 트랜잭션에서 되돌린다
    expect(tt.match(/raise exception '%', c_rollback;/g)?.length).toBe(5)
    // 가드가 시나리오 준비(쓰기)보다 먼저
    const body = noComments(tt.slice(tt.indexOf('do $$')))
    expect(body.indexOf('perform pg_temp.ot_test_admin_guard();')).toBeLessThan(body.search(/\b(update|delete from|insert into public)\b/))
  })
})

describe('공휴일 확정·취소 시험은 실제 DB 관리자 판정(allowed_users.is_admin + JWT email)을 지난다', () => {
  const H = read('supabase/dev/overtime_confirm_holiday_test.sql')
  it('시험 전용 관리자 행(is_admin=true)을 만들고, 그 JWT·authenticated 역할로 확정취소 RPC를 부른다', () => {
    expect(H).toMatch(/\('ot-holiday-admin@example\.invalid', true,/)
    expect(H).toContain(`c_admin constant text := '{"email":"ot-holiday-admin@example.invalid","role":"authenticated"}';`)
    // 관리자 확정취소 직전: 관리자 JWT + set local role authenticated (소유자 권한으로 우회하지 않음)
    const i = H.indexOf("perform set_config('request.jwt.claims', c_admin, true);")
    expect(i).toBeGreaterThan(0)
    expect(H.indexOf("execute 'set local role authenticated';", i)).toBeGreaterThan(i)
    expect(H.indexOf('v_res := public.overtime_unconfirm_drafts(array[v_draft]);', i)).toBeGreaterThan(i)
    // 일반 사용자 확정취소는 거부(H08)
    expect(H).toContain("'H08 일반 사용자 확정취소 거부'")
  })
  it('외부 시험 계정 승격과 충돌하지 않는다(다른 이메일) — 끝나면 역할·JWT를 되돌리고 시험 행 0', () => {
    expect(H).not.toMatch(/ot-ui-test@example\.com/)
    expect(H).toContain("execute 'reset role';")
    expect(H).toContain("perform set_config('request.jwt.claims', '', true);")
    expect(H).toMatch(/where email in \('ot-holiday-writer@example\.invalid', 'ot-holiday-admin@example\.invalid'\)\) as n/)
  })
})

describe('리허설 기준 상태 기록(overtime_rollback_rehearsal_baseline.sql)', () => {
  const BASE = 'supabase/dev/overtime_rollback_rehearsal_baseline.sql'
  const base = read(BASE)
  const code = base.replace(/--[^\n]*/g, '')
  const noLiterals = code.replace(/'[^']*'/g, "''")
  // 항목 이름 'a01 …' ~ 'e16 …' 과 그 정의(다음 항목 이름 전까지)
  const labelRe = /'([a-e]\d\d) [^']*'/g
  const labels = [...code.matchAll(labelRe)]
  const items = labels.map((m, i) => ({ id: m[1], body: code.slice(m.index! + m[0].length, labels[i + 1]?.index ?? code.length) }))

  it('정확히 58개 항목(a16·b10·c6·d10·e16), 이름 중복 없음', () => {
    const ids = items.map(x => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBe(58)
    const per = (p: string) => ids.filter(x => x.startsWith(p)).length
    expect([per('a'), per('b'), per('c'), per('d'), per('e')]).toEqual([16, 10, 6, 10, 16])
  })

  it('단일 읽기 전용 SELECT — DML·DDL·set·DO 블록 없음, 문장 하나', () => {
    expect(noLiterals).not.toMatch(/\b(insert\s+into|update\s+\w|delete\s+from|create\s|alter\s|drop\s|truncate|grant\s|revoke\s|set\s+(local\s+)?\w+\s*=|do\s+\$\$)/i)
    expect(noLiterals.trim()).toMatch(/^with\b/i)
    expect(noLiterals.split(';').filter(s => s.trim()).length).toBe(1)
  })

  it('결과 열은 check_name / detail 두 개', () => {
    const last = code.slice(code.lastIndexOf('\nselect '))
    expect(norm(last)).toMatch(/^select check_name, detail from/)
    expect(code).toContain('cnt(check_name, detail)')
    expect(code).toContain('fp(check_name, detail)')
  })

  it('출력은 건수·참거짓·md5뿐 — 이름·이메일·UUID·업무내용 원문을 detail로 내지 않는다', () => {
    for (const x of items) {
      const ok = /^[abc]/.test(x.id)
        ? /count\(\*\)|is_admin::text|is not null\)/.test(x.body)
        : /^\s*,\s*md5\(/.test(x.body)
      expect({ id: x.id, ok }).toEqual({ id: x.id, ok: true })
    }
    // 이메일 열은 md5 안이나 조건에서만
    for (const m of noLiterals.matchAll(/\bemail\b/g)) {
      const before = noLiterals.slice(Math.max(0, m.index! - 12), m.index!)
      expect(before).toMatch(/md5\(u\.$|where $|u\.$|by u\.$/)
    }
    expect(noLiterals).not.toMatch(/\b(name|task_name|task_description|note)\s*(,|\)\s*as|\s+as\s)/)
  })

  it('대상 표가 모두 들어 있다(행 수 또는 데이터 지문)', () => {
    for (const t of ['overtime_employees', 'overtime_employee_tasks', 'overtime_projects', 'overtime_project_members',
      'overtime_work_records', 'overtime_assignment_runs', 'overtime_assignment_drafts', 'overtime_monthly_targets',
      'overtime_member_tasks', 'holidays', 'engineer_contacts', 'projects', 'allowed_users', 'project_notes', 'project_tooltips',
      'performing_projects', 'expected_projects', 'weekly_meta', 'evaluation_types', 'evaluation_roles', 'evaluation_question_categories']) {
      expect({ t, present: code.includes(`from public.${t} `) || code.includes(`from public.${t})`) }).toEqual({ t, present: true })
    }
  })

  it('d03 메뉴 권한 함수 2개·d07 공용 표 9개 정책 지문, c06 리허설 객체 잔여, a16 시험 계정 is_admin', () => {
    const body = (id: string) => items.find(x => x.id === id)?.body ?? ''
    expect(body('d03')).toContain("p.proname in ('menu_permission', 'menu_any_readable')")
    for (const t of ['projects', 'project_notes', 'project_tooltips', 'performing_projects', 'expected_projects', 'weekly_meta',
      'evaluation_types', 'evaluation_roles', 'evaluation_question_categories']) expect(body('d07')).toContain(`'${t}'`)
    expect(body('c05')).toContain("policyname = 'menu_read'")
    expect(body('c06')).toContain("to_regclass('private.overtime_rehearsal_snapshot')")
    expect(body('c06')).toContain("to_regclass('private.overtime_rehearsal_catalog')")
    expect(body('a16')).toContain('is_admin::text')
  })

  it('seed가 다시 만드는 고정 행은 e01·e04 지문에서 빠진다(그 밖의 승인 사용자·입찰 프로젝트는 전후 같아야 함)', () => {
    const seed = read('supabase/dev/overtime_ui_seed.sql')
    const body = (id: string) => items.find(x => x.id === id)?.body ?? ''
    for (const email of seed.match(/test_emails text\[\] := array\[([^\]]+)\]/)![1].match(/'[^']+'/g)!) expect(body('e01')).toContain(email)
    expect(body('e04')).toContain("'f2000000-0000-4000-8000-00000000000_'")
    expect(seed).toContain("old_src uuid := 'd1000000-0000-4000-8000-000000000001'")
    expect(body('e04')).toContain("'d1000000-0000-4000-8000-000000000001'")
  })

  it('머리말: 개발 전용·운영 구분, MD5는 보안 인증이 아닌 비교용, 실행 시점 2회', () => {
    expect(base).toContain('개발용 Supabase(zaot…iyas)')
    expect(base).toContain('운영(lkvb…odrt)에서는 실행하지 않는다')
    expect(base).toContain('MD5는 보안 인증이 아니다')
    expect(base).toContain('overtime_ui_seed.sql 복원 뒤')
  })
})

describe('동기화 RPC 의존 인덱스(overtime_projects_source_project_id_key) 확인', () => {
  const RPC = 'supabase/migration_overtime_project_sync_rpc.sql'
  const rpc = read(RPC)
  const code = (src: string) => src.replace(/--[^\n]*/g, '')
  // 인덱스 속성: 대상 표·UNIQUE·열 하나(source_project_id, 식 아님)·부분 조건·valid·ready — 속성마다 coalesce(…, false)(fail-closed)
  const ALIASES = ['on_table', 'is_unique', 'on_column', 'partial_ok', 'valid_ready']
  const PROPS = [
    "i.indexrelid = to_regclass('public.overtime_projects_source_project_id_key')",
    "coalesce(i.indrelid = to_regclass('public.overtime_projects'), false) as on_table",
    'coalesce(i.indisunique, false) as is_unique',
    "coalesce(i.indnatts = 1 and i.indexprs is null and a.attname = 'source_project_id', false) as on_column",
    "coalesce(pg_catalog.pg_get_expr(i.indpred, i.indrelid) = '(source_project_id IS NOT NULL)', false) as partial_ok",
    'coalesce(i.indisvalid and i.indisready, false) as valid_ready',
  ]
  // 속성 별칭은 모두 "…, false) as 별칭" 형태로만 나온다 — coalesce 없이 NULL이 될 수 있는 판정이 끼어들면 실패
  const expectFailClosed = (block: string) => {
    for (const name of ALIASES) {
      const all = [...block.matchAll(new RegExp(`\\bas ${name}\\b`, 'g'))].length
      const closed = [...block.matchAll(new RegExp(`, false\\) as ${name}\\b`, 'g'))].length
      expect({ name, all, closed }).toEqual({ name, all: 1, closed: 1 })
    }
  }

  it('migration: 인덱스 확인은 begin; 바로 뒤의 do $$ … end $$; 블록이고, 함수 생성보다 먼저다', () => {
    const c = code(rpc)
    // 정확한 모양: begin; 다음 문장이 do $$, 블록은 end $$;로 닫히고 바로 다음 문장이 함수 생성
    const m = /\nbegin;\s*\ndo \$\$\n([\s\S]*?)\nend \$\$;\s*\ncreate or replace function public\.overtime_apply_project_sync\(/.exec(c)
    expect(m, 'begin; → do $$ … end $$; → create function 순서가 아님').not.toBeNull()
    const block = m![1]
    expect(block).toContain("to_regclass('public.overtime_projects_source_project_id_key') is null")
    expect(block).toContain('OVERTIME_SYNC_INDEX_MISSING')
    expect(block).toContain('OVERTIME_SYNC_INDEX_INVALID')
    // 블록 안에 grant·revoke·create가 없다(함수·권한을 바꾸기 전에 끝난다)
    expect(block).not.toMatch(/\b(create|grant|revoke|alter|drop)\b/i)
  })

  it('migration: 단일 달러 do $ · end $; 가 없다(PostgreSQL 문법 오류 — B-1 재발 방지)', () => {
    const c = code(rpc)
    expect(c).not.toMatch(/\bdo \$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)/)
    expect(c).not.toMatch(/\bend \$(?!\$|[A-Za-z_][A-Za-z0-9_]*\$)/)
  })

  it('migration: 인덱스 속성 판정이 NULL이면 통과하지 않는다(속성마다 coalesce, 최종 조건도 coalesce)', () => {
    const c = code(rpc)
    const block = c.slice(c.indexOf('do $$'), c.indexOf('create or replace function public.overtime_apply_project_sync'))
    for (const p of PROPS.slice(1)) expect(block).toContain(p)
    expectFailClosed(block)
    expect(block).toContain('if not found or not coalesce(v.on_table and v.is_unique and v.on_column and v.partial_ok and v.valid_ready, false) then')
    // 예외 문구의 boolean은 ::text로(%에 그대로 넣으면 t/f로 찍힌다)
    expect(block).not.toMatch(/,\s*v\.(on_table|is_unique|on_column|partial_ok|valid_ready)\s*[,;)]/)
  })

  it('migration: on conflict 대상이 확인한 인덱스와 같은 부분 조건이다', () => {
    expect(code(rpc)).toContain('on conflict (source_project_id) where source_project_id is not null')
  })

  it.each([
    ['supabase/verify/overtime_planning_preflight.sql', 'p16_sync_source_index', 'STOP'],
    ['supabase/verify/overtime_planning_current_postflight.sql', 'cur_s01_sync_source_index', 'FAIL'],
  ])('%s: %s가 같은 속성을 모두 확인하고, 하나라도 다르면 %s', (f, name, bad) => {
    const c = code(read(f))
    const i = c.indexOf(`'${name}'`)
    expect(i).toBeGreaterThan(0)
    const block = c.slice(i, c.indexOf('union all', i) > 0 ? c.indexOf('union all', i) : undefined)
    for (const p of PROPS) expect(block).toContain(p)
    expectFailClosed(block)
    expect(block).toContain(`then 'OK' else '${bad}' end`)
  })

  // 달러 인용 짝 검사 — 주석(--, /* */)·문자열('…', E'…', "식별자") 안의 $는 건너뛰고, 밖에서 만난 $만 본다.
  //   $1 같은 위치 매개변수와 식별자 안의 $(a$b)는 허용, 그 밖의 $는 $$ 또는 $태그$ 여는 표시여야 하고 같은 표시로 닫혀야 한다.
  //   한계: PostgreSQL 파서가 아니다 — 달러 인용·주석·문자열의 짝만 보고, 그 밖의 문법 오류는 잡지 못한다.
  function dollarQuoteProblems(src: string): string[] {
    const out: string[] = []
    const lineOf = (k: number) => src.slice(0, k).split('\n').length
    let i = 0
    while (i < src.length) {
      const ch = src[i]
      if (ch === '-' && src[i + 1] === '-') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue }
      if (ch === '/' && src[i + 1] === '*') {
        const j = src.indexOf('*/', i + 2)
        if (j < 0) { out.push(`${lineOf(i)}: 닫히지 않은 /* 주석`); break }
        i = j + 2; continue
      }
      if (ch === "'") {
        const escapeString = /[eE]/.test(src[i - 1] ?? '') && !/[A-Za-z0-9_]/.test(src[i - 2] ?? '')
        let j = i + 1
        for (;;) {
          if (j >= src.length) { out.push(`${lineOf(i)}: 닫히지 않은 문자열`); return out }
          if (escapeString && src[j] === '\\') { j += 2; continue }
          if (src[j] === "'") { if (src[j + 1] === "'") { j += 2; continue } break }
          j++
        }
        i = j + 1; continue
      }
      if (ch === '"') {
        const j = src.indexOf('"', i + 1)
        if (j < 0) { out.push(`${lineOf(i)}: 닫히지 않은 따옴표 식별자`); return out }
        i = j + 1; continue
      }
      if (ch === '$') {
        if (/[A-Za-z0-9_]/.test(src[i - 1] ?? '') || /[0-9]/.test(src[i + 1] ?? '')) { i++; continue }
        const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(src.slice(i))?.[0]
        if (!tag) { out.push(`${lineOf(i)}: 짝을 이룰 수 없는 단일 $`); i++; continue }
        const end = src.indexOf(tag, i + tag.length)
        if (end < 0) { out.push(`${lineOf(i)}: 닫히지 않은 달러 인용 ${tag}`); return out }
        i = end + tag.length; continue
      }
      i++
    }
    return out
  }

  it('달러 인용 검사기 자체: B-1 형태(do $ … end $;)와 닫히지 않은 $$를 잡고, 정상 형태·주석·문자열 안의 $는 통과', () => {
    expect(dollarQuoteProblems('begin;\ndo $\ndeclare v int;\nbegin\n  null;\nend $;\ncommit;\n').length).toBeGreaterThan(0)
    expect(dollarQuoteProblems('do $$ begin null;\n').length).toBeGreaterThan(0)
    expect(dollarQuoteProblems('do $x$ begin null; end $y$;').length).toBeGreaterThan(0)
    expect(dollarQuoteProblems([
      'begin;',
      'do $$ begin perform 1; end $$;',
      "do $do$ begin execute $fn$ select '$' $fn$; end $do$;",
      "select '$ 혼자', E'it\\'s $', \"col$x\", a$b, $1, $2 from t; -- 주석 안 $",
      '/* 블록 주석 $ */',
      'commit;',
    ].join('\n'))).toEqual([])
  })

  it('저장소 supabase SQL 전체의 달러 인용이 짝을 이룬다(단일 $ 없음)', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${name.name}`
        if (name.isDirectory()) walk(rel)
        else if (name.name.endsWith('.sql') && rel !== 'supabase/dev/dev_baseline_schema.sql') files.push(rel)   // 로컬 덤프(.gitignore)는 읽지 않는다
      }
    }
    walk('supabase')
    expect(files.length).toBeGreaterThan(50)
    const bad = files.flatMap(f => dollarQuoteProblems(read(f)).map(p => `${f}:${p}`))
    expect(bad).toEqual([])
  })

  it('운영 체크리스트: 동기화 RPC 단계에 의존 인덱스 확인이 필수로 적혀 있다', () => {
    const cl = read('supabase/prod/overtime_prod_checklist.md')
    expect(cl).toContain('| 2 | 동기화 RPC — **필수 확인: 의존 인덱스 `overtime_projects_source_project_id_key`**')
    expect(cl).toContain('p16_sync_source_index')
    expect(cl).toContain('cur_s01_sync_source_index')
  })
})

describe('catalog의 "char" 열을 문자열 연결에 그대로 쓰지 않는다(text || "char"는 연산자 모호 오류 42725)', () => {
  it('tgenabled·provolatile·polcmd·relkind·prokind는 연결 전에 ::text로 바꾼다', () => {
    const files = [
      ...readdirSync(path.join(ROOT, 'supabase/verify')).filter(n => n.endsWith('.sql')).map(n => `supabase/verify/${n}`),
      ...readdirSync(path.join(ROOT, 'supabase/dev')).filter(n => n.endsWith('.sql') && n !== 'dev_baseline_schema.sql').map(n => `supabase/dev/${n}`),
    ].filter(f => f !== 'supabase/verify/overtime_planning_catalog.sql')   // 기존(커밋된) 조회 파일 — 이번 범위 밖
    const bad: string[] = []
    const re = /(\|\|\s*[a-z_]+\.(tgenabled|provolatile|polcmd|relkind|prokind)(?![a-z_]|::)|(?<![a-z_])[a-z_]+\.(tgenabled|provolatile|polcmd|relkind|prokind)\s*\|\|)/
    for (const f of files) read(f).split(String.fromCharCode(10)).forEach((line, i) => { if (!line.trimStart().startsWith('--') && re.test(line)) bad.push(`${f}:${i + 1}`) })
    expect(bad).toEqual([])
  })
})

describe('읽기 전용 확인 SQL에 SQL처럼 보이는 "… into 이름" 문자열을 넣지 않는다', () => {
  // SQL Editor에서 'select * into v_fresh'라는 문자열 리터럴이 든 확인 쿼리가 relation "v_fresh" does not exist(42P01)로 실패했다.
  // 함수 본문 표지는 'select * in' || 'to v_fresh'처럼 나눠 쓴다.
  it.each(['supabase/verify/overtime_planning_c_postflight.sql', 'supabase/verify/overtime_planning_current_postflight.sql'])('%s', f => {
    const code = read(f).replace(/--[^\n]*/g, '')
    expect(code).not.toMatch(/\binto\b/i)
    expect(code).toContain("('select * in' || 'to v_fresh')")
  })
})
