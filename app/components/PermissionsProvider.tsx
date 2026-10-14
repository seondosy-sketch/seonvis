'use client'

import { createContext, useContext } from 'react'
import { MenuPermission, permissionFor } from '@/lib/menuConfig'

/**
 * 로그인한 사용자의 메뉴 항목별 권한을 페이지들에 내려주는 컨텍스트 — 화면 표시용(버튼 활성 여부)이다.
 * layout.tsx가 서버에서 allowed_users(is_admin·menu_permissions)를 매 요청 읽어(lib/auth/menuAccess.ts)
 * SidebarContainer → 여기로 전달한다 (페이지마다 다시 조회하지 않음). 실제 허용은 서버·RLS가 다시 확인한다.
 *
 * 사용: const perm = useMenuPermission('projects') → 'read' | 'write'
 *   ('none'인 페이지는 메뉴 layout의 requireMenu가 화면 렌더 전에 막는다. 여기서는 read로 취급)
 * 해석은 lib/menuConfig.ts permissionFor 한 곳(키 없으면 write, 무효값 none). 관리자는 항상 'write'.
 */
const PermissionsContext = createContext<{
  isAdmin: boolean
  permissions: Record<string, MenuPermission>
}>({ isAdmin: false, permissions: {} })

export function PermissionsProvider({
  isAdmin,
  permissions,
  children,
}: {
  isAdmin: boolean
  permissions: Record<string, MenuPermission>
  children: React.ReactNode
}) {
  return (
    <PermissionsContext.Provider value={{ isAdmin, permissions }}>
      {children}
    </PermissionsContext.Provider>
  )
}

export function useMenuPermission(key: string): 'read' | 'write' {
  const { isAdmin, permissions } = useContext(PermissionsContext)
  if (isAdmin) return 'write'
  const p = permissionFor(permissions, key)
  return p === 'write' ? 'write' : 'read'
}

/** 화면 표시용 관리자 여부 — 서버가 DB allowed_users.is_admin을 읽어 내려준 값. 실제 권한은 서버·DB가 다시 확인한다. */
export function useIsAdmin(): boolean {
  return useContext(PermissionsContext).isAdmin
}
