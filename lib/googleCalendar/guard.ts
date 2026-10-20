/**
 * 캘린더 연동 API의 접근 제어.
 *
 * 연결·해제·전체 재동기화는 **관리자만** (요구사항). 반면 프로젝트를 저장·삭제한 직후 자동으로
 * 도는 단건 동기화는 그 프로젝트를 저장할 수 있었던 사용자면 되므로 승인 사용자까지 허용한다.
 * 판정 기준은 app/(dashboard)/layout.tsx·app/api/admin/*과 같다(lib/auth/menuAccess.ts getMenuAccess —
 * 관리자 = DB allowed_users.is_admin, 승인 = allowed_users 행 있음. 환경변수 ADMIN_EMAILS는 쓰지 않는다).
 */
import { getMenuAccess } from '@/lib/auth/menuAccess'

/** 관리자(allowed_users.is_admin)면 세션 이메일 반환, 아니면 null */
export async function requireAdmin(): Promise<string | null> {
  const access = await getMenuAccess()
  return access?.isAdmin ? access.email : null
}

/** allowed_users에 있는 사용자(관리자 포함)면 세션 이메일 반환, 아니면 null */
export async function requireAllowedUser(): Promise<string | null> {
  const access = await getMenuAccess()
  return access?.approved ? access.email : null
}
