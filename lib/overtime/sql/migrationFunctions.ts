import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 연장근무 migration 체인에서 함수의 "최종 정의"를 뽑는다 — 시험 전용(서버·화면에서 쓰지 않음).
 * supabase/verify/overtime_planning_current_postflight.sql은 DB 함수를 이 값과 비교한다.
 * 적용 순서대로 읽어 같은 함수(스키마.이름 + 인자 타입)는 뒤 파일 정의가 이긴다(운영·개발 모두 이 순서로 적용).
 *
 * MD5는 보안 인증이 아니다 — "DB 함수 본문이 저장소 정의와 같은가"를 짧게 비교하기 위한 지문일 뿐이다.
 */
export const MIGRATION_CHAIN = [
  'migration_team_roster_sync.sql',
  'migration_overtime_planning_a_base.sql',
  'migration_overtime_project_sync_rpc.sql',
  'migration_overtime_planning_b_activate.sql',
  'migration_overtime_monthly_target_guard.sql',
  'migration_overtime_cap_isolation_guard.sql',
  'migration_overtime_planning_c_corrections.sql',
] as const

export interface MigrationFunction {
  schema: string
  name: string
  /** pg_get_function_identity_arguments(소문자)와 같은 형식 — 이름 + 타입, OUT 등 모드 표시 포함, 기본값 없음 */
  identityArgs: string
  language: string
  /** pg_proc.provolatile: i(immutable) · s(stable) · v(volatile, 기본) */
  volatility: 'i' | 's' | 'v'
  securityDefiner: boolean
  /** pg_proc.proconfig의 search_path 항목 그대로('search_path=…'), 없으면 null */
  searchPath: string | null
  file: string
  /** $태그$와 $태그$ 사이 — pg_proc.prosrc와 같은 범위(태그 이름은 포함하지 않는다) */
  body: string
}

const FN_RE = /create or replace function\s+([a-z_]+)\.([a-z_]+)\s*\(/gi

const TYPE_ALIAS: Record<string, string> = {
  int: 'integer', int4: 'integer', int8: 'bigint', bool: 'boolean', timestamptz: 'timestamp with time zone',
  varchar: 'character varying', 'double precision': 'double precision', float8: 'double precision',
}

/**
 * 인자 목록 원문 → pg_get_function_identity_arguments(소문자)와 같은 형식.
 * PostgreSQL은 OUT·INOUT·VARIADIC 표시를 그대로 남기고(IN은 생략) 기본값은 뺀다 — 같은 규칙으로 맞춘다.
 * (2026-10 개발 DB 검증에서 OUT 인자를 뺐던 이전 규칙이 overtime_pay_period를 "없음·오버로드"로 잘못 판정했다)
 * 타입 별칭·스키마 수식(public./pg_catalog.)도 정규화한다.
 */
export function identityArgs(rawArgs: string): string {
  const parts: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of rawArgs) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
    .map(p => p.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(p => p)
    .map(p => p.replace(/\s+default\s+[\s\S]*$/, '').replace(/\s*=\s*[\s\S]*$/, ''))
    .map(p => {
      const mode = p.match(/^(out|inout|variadic)\s+/)?.[1] ?? null
      const rest = p.replace(/^(in|out|inout|variadic)\s+/, '')
      const m = rest.match(/^([a-z_][a-z0-9_]*)\s+(.+)$/)
      const arg = m ? `${m[1]} ${normalizeType(m[2])}` : normalizeType(rest)
      return mode ? `${mode} ${arg}` : arg
    })
    .join(', ')
}

export function normalizeType(t: string): string {
  const s = t.trim().toLowerCase().replace(/\b(public|pg_catalog)\./g, '')
  const arr = s.endsWith('[]')
  const base = arr ? s.slice(0, -2).trim() : s
  return (TYPE_ALIAS[base] ?? base) + (arr ? '[]' : '')
}

/** 파일 안의 함수 정의 */
export function functionsIn(sql: string, file: string): MigrationFunction[] {
  const out: MigrationFunction[] = []
  for (const m of sql.matchAll(FN_RE)) {
    const afterOpen = m.index! + m[0].length
    let depth = 1
    let i = afterOpen
    for (; i < sql.length && depth > 0; i++) {
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
    }
    const rawArgs = sql.slice(afterOpen, i - 1)
    const rest = sql.slice(i)
    const as = rest.match(/\bas\s+(\$[A-Za-z_]*\$)/i)
    if (!as) throw new Error(`본문 시작을 못 찾음: ${file} ${m[1]}.${m[2]}`)
    const attrs = rest.slice(0, as.index!).toLowerCase()
    const start = as.index! + as[0].length
    const end = rest.indexOf(as[1], start)
    if (end < 0) throw new Error(`본문 끝을 못 찾음: ${file} ${m[1]}.${m[2]}`)
    const sp = attrs.match(/set\s+search_path\s*(?:=|to)\s*([^\n]+)/)
    out.push({
      schema: m[1].toLowerCase(),
      name: m[2].toLowerCase(),
      identityArgs: identityArgs(rawArgs),
      language: attrs.match(/language\s+([a-z]+)/)?.[1] ?? '',
      volatility: /\bimmutable\b/.test(attrs) ? 'i' : /\bstable\b/.test(attrs) ? 's' : 'v',
      securityDefiner: /security\s+definer/.test(attrs),
      searchPath: sp ? `search_path=${sp[1].trim().replace(/\s*,\s*/g, ', ')}` : null,
      file,
      body: rest.slice(start, end),
    })
  }
  return out
}

export const fnKey = (f: Pick<MigrationFunction, 'schema' | 'name' | 'identityArgs'>) => `${f.schema}.${f.name}(${f.identityArgs})`

/** 함수 키(스키마.이름(인자)) → 체인의 최종 정의 */
export function finalFunctions(supabaseDir: string): Map<string, MigrationFunction> {
  const fns = new Map<string, MigrationFunction>()
  for (const file of MIGRATION_CHAIN) {
    for (const f of functionsIn(readFileSync(path.join(supabaseDir, file), 'utf8'), file)) fns.set(fnKey(f), f)
  }
  return fns
}

/**
 * 본문 지문 — DB 쪽 식과 같은 규칙:
 *   본문을 작은따옴표(')로 나눠, 따옴표 밖 조각(짝수 번째)만 공백 문자(스페이스·탭·LF·CR·FF·VT) 연속을 한 칸으로 줄이고
 *   따옴표 안 조각(문자열 리터럴 내부)은 CRLF → LF만 바꾼다(리터럴 안 공백은 의미가 있어 그대로 둔다). 다시 ' 로 이어 앞뒤 스페이스를 자르고 md5.
 *   '' (이스케이프된 따옴표)는 빈 조각을 만들 뿐이라 안·밖 짝이 어긋나지 않는다. 주석 안 따옴표 개수가 홀수면 이후 안·밖이 뒤바뀌지만
 *   양쪽이 같은 규칙을 같은 본문에 쓰므로 "같은 본문 → 같은 지문"은 그대로다(그 구간은 공백 정규화가 덜 될 뿐 — 허위 일치는 생기지 않는다).
 * SQL: md5(btrim(string_agg(case when n % 2 = 1 then regexp_replace(s, E'[ \t\n\r\f\013]+', ' ', 'g')
 *                               else replace(s, E'\r\n', E'\n') end, '''' order by n)))
 *      from regexp_split_to_table(prosrc, '''') with ordinality as x(s, n)
 */
export function bodyFingerprint(body: string): string {
  const normalized = body
    .split("'")
    .map((seg, i) => (i % 2 === 0 ? seg.replace(/[ \t\n\r\f\v]+/g, ' ') : seg.replace(/\r\n/g, '\n')))
    .join("'")
    .replace(/^ +| +$/g, '')
  return createHash('md5').update(normalized, 'utf8').digest('hex')
}
