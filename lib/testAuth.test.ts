import { describe, expect, it } from 'vitest'
import { isTestAuthAvailable, resolveTestAuth, type TestAuthEnv } from './testAuth'

/** 개발환경에서 정상적으로 켜진 상태. */
const DEV: TestAuthEnv = {
  NODE_ENV: 'development',
  TEST_AUTH_ENABLED: 'true',
  TEST_AUTH_EMAIL: 'Fixture-User@Example.invalid',
  TEST_AUTH_PASSWORD: 'irrelevant-for-this-unit-test',
}

describe('resolveTestAuth — production 차단', () => {
  it('production NODE_ENV 이면 환경변수가 다 갖춰져도 404', () => {
    const d = resolveTestAuth({ ...DEV, NODE_ENV: 'production' })
    expect(d).toEqual({ ok: false, status: 404, reason: 'production-node-env' })
  })

  it('Vercel production 배포는 NODE_ENV 와 무관하게 404', () => {
    // 실수로 production 프로젝트에 TEST_AUTH_ENABLED=true 가 들어간 상황을 가정한다.
    const d = resolveTestAuth({ ...DEV, NODE_ENV: 'development', VERCEL_ENV: 'production' })
    expect(d).toEqual({ ok: false, status: 404, reason: 'deployed-environment' })
  })

  it('Vercel preview 배포도 404', () => {
    expect(resolveTestAuth({ ...DEV, VERCEL_ENV: 'Preview' }))
      .toEqual({ ok: false, status: 404, reason: 'deployed-environment' })
  })

  it('production 판정이 다른 모든 조건보다 먼저다', () => {
    // 이메일을 지목했더라도 production 이면 403(allowlist)이 아니라 404가 나와야 한다 —
    // 경로의 존재 자체를 알리지 않기 위함이다.
    const d = resolveTestAuth({ ...DEV, NODE_ENV: 'production' }, 'someone-else@example.com')
    expect(d).toMatchObject({ ok: false, status: 404 })
  })
})

describe('resolveTestAuth — 명시적으로 켜야 동작', () => {
  it('TEST_AUTH_ENABLED 가 없으면 404 (기본값은 꺼짐)', () => {
    const env: TestAuthEnv = { ...DEV }
    delete env.TEST_AUTH_ENABLED
    expect(resolveTestAuth(env)).toEqual({ ok: false, status: 404, reason: 'not-enabled' })
  })

  it("'true' 이외의 값은 모두 꺼짐으로 본다", () => {
    for (const value of ['false', '1', 'yes', 'TRUE', 'True', '']) {
      expect(resolveTestAuth({ ...DEV, TEST_AUTH_ENABLED: value }))
        .toMatchObject({ ok: false, reason: 'not-enabled' })
    }
  })

  it('공백은 무시하고 true 로 본다', () => {
    expect(resolveTestAuth({ ...DEV, TEST_AUTH_ENABLED: ' true ' }).ok).toBe(true)
  })
})

describe('resolveTestAuth — 계정 정보가 없으면 동작하지 않는다', () => {
  it('TEST_AUTH_EMAIL 없으면 404', () => {
    expect(resolveTestAuth({ ...DEV, TEST_AUTH_EMAIL: undefined }))
      .toEqual({ ok: false, status: 404, reason: 'missing-email' })
    expect(resolveTestAuth({ ...DEV, TEST_AUTH_EMAIL: '   ' }))
      .toMatchObject({ reason: 'missing-email' })
  })

  it('TEST_AUTH_PASSWORD 없으면 404', () => {
    expect(resolveTestAuth({ ...DEV, TEST_AUTH_PASSWORD: undefined }))
      .toEqual({ ok: false, status: 404, reason: 'missing-password' })
    expect(resolveTestAuth({ ...DEV, TEST_AUTH_PASSWORD: '' }))
      .toMatchObject({ reason: 'missing-password' })
  })
})

describe('resolveTestAuth — 이메일 allowlist', () => {
  it('설정된 이메일만 허용한다', () => {
    const d = resolveTestAuth(DEV, 'attacker@example.com')
    expect(d).toEqual({ ok: false, status: 403, reason: 'email-not-allowlisted' })
  })

  it('실제 사용자 이메일을 지목해도 거부한다', () => {
    expect(resolveTestAuth(DEV, 'someone@seon.co.kr'))
      .toMatchObject({ ok: false, status: 403, reason: 'email-not-allowlisted' })
  })

  it('대소문자·공백 차이는 같은 이메일로 본다', () => {
    const d = resolveTestAuth(DEV, '  fixture-user@example.invalid ')
    expect(d).toEqual({ ok: true, email: 'fixture-user@example.invalid', password: DEV.TEST_AUTH_PASSWORD })
  })

  it('이메일을 지목하지 않으면 설정된 이메일을 쓴다', () => {
    expect(resolveTestAuth(DEV)).toMatchObject({ ok: true, email: 'fixture-user@example.invalid' })
    expect(resolveTestAuth(DEV, null)).toMatchObject({ ok: true })
    expect(resolveTestAuth(DEV, '')).toMatchObject({ ok: true })
  })

  it('허용된 경우 이메일을 소문자로 정규화해서 준다 (JWT email 매칭과 allowed_users 조회에 쓰인다)', () => {
    const d = resolveTestAuth(DEV)
    expect(d.ok && d.email).toBe('fixture-user@example.invalid')
  })
})

describe('isTestAuthAvailable — proxy 예외를 여는 조건', () => {
  it('개발환경에서 켜져 있으면 true', () => {
    expect(isTestAuthAvailable(DEV)).toBe(true)
  })

  it('production 이면 false — 로그인 리다이렉트 예외가 아예 생기지 않는다', () => {
    expect(isTestAuthAvailable({ ...DEV, NODE_ENV: 'production' })).toBe(false)
    expect(isTestAuthAvailable({ ...DEV, VERCEL_ENV: 'production' })).toBe(false)
  })

  it('환경변수가 비어 있으면 false', () => {
    expect(isTestAuthAvailable({})).toBe(false)
    expect(isTestAuthAvailable({ NODE_ENV: 'development' })).toBe(false)
  })
})

describe('비밀은 판정 결과에만 담기고 거부 응답에는 담기지 않는다', () => {
  it('거부 결과에는 password 필드가 없다', () => {
    for (const env of [
      { ...DEV, NODE_ENV: 'production' },
      { ...DEV, TEST_AUTH_ENABLED: 'false' },
      { ...DEV, VERCEL_ENV: 'production' },
    ]) {
      const d = resolveTestAuth(env, 'attacker@example.com')
      expect(d.ok).toBe(false)
      expect(JSON.stringify(d)).not.toContain(DEV.TEST_AUTH_PASSWORD)
    }
  })
})
