import { createSupabaseServerClient } from '@/lib/supabase-server'
import { chatMode, getMenuAccess } from '@/lib/auth/menuAccess'

export async function POST(request: Request) {
  // 프로젝트 등록·수정 — UI·RLS만 믿지 않고 서버에서 프로젝트 List 쓰기 권한을 확인한다
  if (chatMode(await getMenuAccess()) !== 'write') {
    return Response.json({ success: false, message: '프로젝트 List 쓰기 권한이 없어요.' }, { status: 403 })
  }

  const { action } = await request.json() as {
    action: { name: string; args: Record<string, unknown> }
  }

  const supabase = await createSupabaseServerClient()

  if (action.name === 'create_project') {
    const { error } = await supabase.from('projects').insert(action.args)
    if (error) return Response.json({ success: false, message: `저장 실패: ${error.message}` })
    return Response.json({ success: true, message: `새 프로젝트가 등록됐어요! 🎉` })
  }

  if (action.name === 'update_project') {
    const { project_number, ...fields } = action.args
    const { error } = await supabase
      .from('projects')
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq('project_number', project_number)
    if (error) return Response.json({ success: false, message: `수정 실패: ${error.message}` })
    return Response.json({ success: true, message: `#${project_number} 프로젝트가 수정됐어요! ✅` })
  }

  return Response.json({ success: false, message: '알 수 없는 작업이에요.' })
}
