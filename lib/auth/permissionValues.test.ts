import { describe, expect, it } from 'vitest'
import { MENU_PERMISSION_VALUES, RESTRICTABLE_MENU_ITEMS, isMenuPermission, normalizeMenuPermissions, permissionFor } from '@/lib/menuConfig'
import { hasMenuPermission, resolveMenuAccess } from './accessRules'

// 메뉴 권한 값 해석 — 키 없음은 write(문서화된 기본값), 정확한 none/read/write만 그 값, 나머지는 none(fail-closed)
describe('permissionFor — 무효값 기본 거부', () => {
  it('키 없음 → write (기본값 유지)', () => {
    expect(permissionFor({}, 'projects')).toBe('write')
    expect(permissionFor({ weekly: 'none' }, 'projects')).toBe('write')
    expect(permissionFor({ projects: undefined }, 'projects')).toBe('write')   // JSON 저장 시 키가 사라지는 값
  })
  it('menu_permissions 자체가 null/undefined → 키 없음과 같다(write)', () => {
    expect(permissionFor(null, 'projects')).toBe('write')
    expect(permissionFor(undefined, 'projects')).toBe('write')
  })
  it.each(MENU_PERMISSION_VALUES)('정확한 값 %s → 그대로', v => {
    expect(permissionFor({ projects: v }, 'projects')).toBe(v)
  })
  it.each(['NONE', 'Read', 'WRITE', '', ' read', 'read ', 'admin', 'hidden', null, true, false, 0, 1, ['write'], { v: 'write' }])(
    '무효값 %j → none',
    bad => {
      expect(permissionFor({ projects: bad }, 'projects')).toBe('none')
    },
  )
  it.each([['write'], 'write', 1, true])('menu_permissions가 객체가 아님(%j) → 모든 키 none', raw => {
    expect(permissionFor(raw, 'projects')).toBe('none')
    expect(permissionFor(raw, 'weekly')).toBe('none')
  })
  it('프로토타입 키(toString 등)는 "키 있음"으로 보지 않는다', () => {
    expect(permissionFor({}, 'toString')).toBe('write')
    expect(permissionFor({}, '__proto__')).toBe('write')
  })
  it('isMenuPermission은 정확한 세 값만', () => {
    expect(MENU_PERMISSION_VALUES).toEqual(['none', 'read', 'write'])
    expect(['none', 'read', 'write'].every(isMenuPermission)).toBe(true)
    expect(['NONE', '', null, undefined, 1].some(isMenuPermission)).toBe(false)
  })
})

describe('normalizeMenuPermissions — 서버가 화면에 내려보내는 확정값', () => {
  it('모든 메뉴 키를 채우고 무효값은 none, 키 없음은 write', () => {
    const n = normalizeMenuPermissions({ projects: 'NONE', leave: 'read', sites: 'none' })
    expect(Object.keys(n).sort()).toEqual(RESTRICTABLE_MENU_ITEMS.map(m => m.key).sort())
    expect(n.projects).toBe('none')
    expect(n.leave).toBe('read')
    expect(n.sites).toBe('none')
    expect(n.weekly).toBe('write')
  })
  it('클라이언트에서 permissionFor를 다시 불러도 같은 결과(PermissionsProvider와 일치)', () => {
    const raw = { projects: 'Read', weekly: 'read', trip: '' }
    const n = normalizeMenuPermissions(raw)
    for (const { key } of RESTRICTABLE_MENU_ITEMS) expect(permissionFor(n, key)).toBe(permissionFor(raw, key))
  })
})

describe('resolveMenuAccess · hasMenuPermission — 주입한 DB 행으로 판정', () => {
  it('행 없음 → 미승인, 관리자 아님, 모든 API 거부', () => {
    const a = resolveMenuAccess('x@example.com', null)
    expect(a).toEqual({ email: 'x@example.com', isAdmin: false, approved: false, permissions: {} })
    expect(hasMenuPermission(a, 'projects', 'read')).toBe(false)
  })
  it('is_admin=true → 모든 메뉴 write(무효값·none 무시)', () => {
    const a = resolveMenuAccess('a@example.com', { is_admin: true, menu_permissions: { projects: 'none', weekly: 'NONE' } })
    expect(a.isAdmin).toBe(true)
    expect(hasMenuPermission(a, 'projects', 'write')).toBe(true)
    expect(hasMenuPermission(a, 'weekly', 'write')).toBe(true)
  })
  it('is_admin=false → menu_permissions 적용(read는 read만, write는 write만)', () => {
    const a = resolveMenuAccess('u@example.com', { is_admin: false, menu_permissions: { projects: 'read', overtime: 'write', leave: 'Read' } })
    expect(hasMenuPermission(a, 'projects', 'read')).toBe(true)
    expect(hasMenuPermission(a, 'projects', 'write')).toBe(false)
    expect(hasMenuPermission(a, 'overtime', 'write')).toBe(true)
    expect(hasMenuPermission(a, 'leave', 'read')).toBe(false)
  })
  it('비로그인(null) → 거부', () => {
    expect(hasMenuPermission(null, 'projects', 'read')).toBe(false)
  })
})
