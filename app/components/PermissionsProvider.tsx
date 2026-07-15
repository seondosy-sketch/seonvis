'use client'

import { createContext, useContext } from 'react'
import { MenuPermission, permissionFor } from '@/lib/menuConfig'

/**
 * 로그인한 사용자의 메뉴 항목별 권한을 페이지들에 내려주는 컨텍스트.
 * layout.tsx가 서버에서 allowed_users.menu_permissions를 한 번 읽어
 * SidebarContainer → 여기로 전달한다 (페이지마다 다시 조회하지 않음).
 *
 * 사용: const perm = useMenuPermission('projects') → 'read' | 'write'
 *   ('none'인 페이지는 사이드바에서 이미 숨겨지지만, 직접 주소로 들어오면 read로 취급)
 * 관리자는 항상 'write'.
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
