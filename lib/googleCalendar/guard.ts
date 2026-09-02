/**
 * 캘린더 연동 API의 접근 제어.
 *
 * 연결·해제·전체 재동기화는 **관리자만** (요구사항). 반면 프로젝트를 저장·삭제한 직후 자동으로
 * 도는 단건 동기화는 그 프로젝트를 저장할 수 있었던 사용자면 되므로 승인 사용자까지 허용한다.
 * 판정 자체는 lib/access.ts 한 곳에서 가져온다 — 이 파일은 캘린더용 이름만 붙인 얇은 껍데기다.
 */
import { requireAdminAccess, resolveSessionAccess } from '@/lib/access'

/** 관리자면 정규화된 이메일, 아니면 null */
export async function requireAdmin(): Promise<string | null> {
  const access = await requireAdminAccess()
  return access?.email ?? null
}

/** 관리자이거나 allowed_users에 있는 사용자면 정규화된 이메일, 아니면 null */
export async function requireAllowedUser(): Promise<string | null> {
  const access = await resolveSessionAccess()
  return access?.email ?? null
}
