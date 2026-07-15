import { createSupabaseAdminClient } from '@/lib/supabase-admin'
import { createSupabaseServerClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '').split(',').map(e => e.trim()).filter(Boolean)
}

async function assertAdmin() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) return null
  const adminEmails = getAdminEmails()
  if (!adminEmails.includes(user.email)) return null
  return user
}

export async function GET() {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('allowed_users').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, is_admin } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('allowed_users')
    .upsert({ email: email.toLowerCase().trim(), is_admin: !!is_admin, added_by_email: user.email }, { onConflict: 'email' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, menu_permissions } = await request.json()
  if (!email || typeof menu_permissions !== 'object' || menu_permissions === null || Array.isArray(menu_permissions)) {
    return NextResponse.json({ error: 'email, menu_permissions required' }, { status: 400 })
  }
  const valid = ['none', 'read', 'write']
  for (const v of Object.values(menu_permissions)) {
    if (!valid.includes(v as string)) {
      return NextResponse.json({ error: `invalid permission value: ${v}` }, { status: 400 })
    }
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('allowed_users')
    .update({ menu_permissions })
    .eq('email', email.toLowerCase().trim())
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: Request) {
  const user = await assertAdmin()
  if (!user) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email } = await request.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('allowed_users').delete().eq('email', email.toLowerCase().trim())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
