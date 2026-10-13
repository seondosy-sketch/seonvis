import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { normalizeEmail, requireAdminAccess } from '@/lib/access'
import { NextResponse } from 'next/server'

export async function GET() {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('allowed_users').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, is_admin, note } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('allowed_users')
    .upsert(
      {
        email: normalizeEmail(email),
        is_admin: !!is_admin,
        added_by_email: actor.email,
        note: typeof note === 'string' ? note.trim() : '',
      },
      { onConflict: 'email' },
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // menu_permissions와 note는 각각 따로 저장한다 — 메모를 고칠 때 권한을 함께 보내지 않아도 되고,
  // 그 반대도 마찬가지다. 넘어온 필드만 반영한다.
  const { email, menu_permissions, note } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const patch: { menu_permissions?: unknown; note?: string } = {}

  if (menu_permissions !== undefined) {
    if (typeof menu_permissions !== 'object' || menu_permissions === null || Array.isArray(menu_permissions)) {
      return NextResponse.json({ error: 'menu_permissions must be an object' }, { status: 400 })
    }
    const valid = ['none', 'read', 'write']
    for (const v of Object.values(menu_permissions)) {
      if (!valid.includes(v as string)) {
        return NextResponse.json({ error: `invalid permission value: ${v}` }, { status: 400 })
      }
    }
    patch.menu_permissions = menu_permissions
  }

  if (note !== undefined) {
    if (typeof note !== 'string') return NextResponse.json({ error: 'note must be a string' }, { status: 400 })
    patch.note = note.trim()
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'menu_permissions or note required' }, { status: 400 })
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('allowed_users')
    .update(patch)
    .eq('email', normalizeEmail(email))
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const actor = await requireAdminAccess()
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('allowed_users').delete().eq('email', normalizeEmail(email))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
