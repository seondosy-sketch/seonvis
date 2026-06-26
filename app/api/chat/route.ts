import { createSupabaseServerClient } from '@/lib/supabase-server'

const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${process.env.GEMINI_API_KEY}`

const FUNCTION_DECLARATIONS = [
  {
    name: 'create_project',
    description: '새 프로젝트를 데이터베이스에 추가합니다. 사용자가 새 프로젝트 등록을 요청할 때 사용하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        project_number: { type: 'STRING', description: '공사번호 (예: 2645)' },
        type: { type: 'STRING', description: '유형: 면접, SOQ, 종심제, TP, PQ, 기타 중 하나' },
        client: { type: 'STRING', description: '발주처' },
        name: { type: 'STRING', description: '용역명 (필수)' },
        fee: { type: 'NUMBER', description: '용역비 (억 단위, 숫자만)' },
        tp_score: { type: 'STRING', description: 'T/P 제안서 (예: 20p, 40p)' },
        duration_days: { type: 'STRING', description: '점수' },
        submit_date: { type: 'STRING', description: '제출일 (YYYY-MM-DD)' },
        interview_date: { type: 'STRING', description: '발표/면접일 (YYYY-MM-DD)' },
        bid_date: { type: 'STRING', description: '개찰일 (YYYY-MM-DD)' },
        result_score: { type: 'STRING', description: '결과 등급 (수/우/미/양/중/1등/3등 등)' },
        evaluation: { type: 'STRING', description: '낙찰사' },
        award_fee: { type: 'NUMBER', description: '낙찰액 (억 단위)' },
        participants: { type: 'STRING', description: '참여사 (예: 9개사)' },
        director: { type: 'STRING', description: '단장 이름' },
        staff_arch: { type: 'STRING', description: '건축 담당자' },
        staff_civil: { type: 'STRING', description: '토목 담당자' },
        staff_mech: { type: 'STRING', description: '기계 담당자' },
        staff_safety: { type: 'STRING', description: '안전 담당자' },
        note: { type: 'STRING', description: '비고' },
      },
      required: ['name'],
    },
  },
  {
    name: 'update_project',
    description: '기존 프로젝트 정보를 수정합니다. 사용자가 특정 프로젝트의 내용 변경을 요청할 때 사용하세요.',
    parameters: {
      type: 'OBJECT',
      properties: {
        project_number: { type: 'STRING', description: '수정할 프로젝트의 공사번호 (필수)' },
        type: { type: 'STRING', description: '유형' },
        client: { type: 'STRING', description: '발주처' },
        name: { type: 'STRING', description: '용역명' },
        fee: { type: 'NUMBER', description: '용역비 (억)' },
        tp_score: { type: 'STRING', description: 'T/P 제안서' },
        duration_days: { type: 'STRING', description: '점수' },
        submit_date: { type: 'STRING', description: '제출일 (YYYY-MM-DD)' },
        interview_date: { type: 'STRING', description: '발표/면접일 (YYYY-MM-DD)' },
        bid_date: { type: 'STRING', description: '개찰일 (YYYY-MM-DD)' },
        result_score: { type: 'STRING', description: '결과 등급' },
        evaluation: { type: 'STRING', description: '낙찰사' },
        award_fee: { type: 'NUMBER', description: '낙찰액 (억)' },
        participants: { type: 'STRING', description: '참여사' },
        director: { type: 'STRING', description: '단장' },
        staff_arch: { type: 'STRING', description: '건축 담당자' },
        staff_civil: { type: 'STRING', description: '토목 담당자' },
        staff_mech: { type: 'STRING', description: '기계 담당자' },
        staff_safety: { type: 'STRING', description: '안전 담당자' },
        note: { type: 'STRING', description: '비고' },
        status_override: { type: 'STRING', description: '상태 강제지정 (진행중/수주/탈락/취소)' },
      },
      required: ['project_number'],
    },
  },
]

const FIELD_LABELS: Record<string, string> = {
  type: '유형', client: '발주처', name: '용역명', fee: '용역비(억)',
  tp_score: '제안서', duration_days: '점수', submit_date: '제출일',
  interview_date: '발표일', bid_date: '개찰일', result_score: '결과등급',
  evaluation: '낙찰사', award_fee: '낙찰액(억)', participants: '참여사',
  director: '단장', staff_arch: '건축', staff_civil: '토목',
  staff_mech: '기계', staff_safety: '안전', note: '비고',
  status_override: '상태',
}

function buildSystemPrompt(projects: Record<string, unknown>[]) {
  const summary = projects.map(p => {
    const fields = [
      `번호:${p.project_number}`,
      `유형:${p.type}`,
      `발주처:${p.client}`,
      `용역명:${p.name}`,
      p.fee ? `용역비:${p.fee}억` : null,
      `단장:${p.director}`,
      `낙찰사:${p.evaluation || '미정'}`,
      `결과:${p.result_score || '-'}`,
    ].filter(Boolean).join(', ')
    return `- ${fields}`
  }).join('\n')

  return `당신은 (주)선 미래사업팀 전용 AI 어시스턴트 "미래봇"입니다. 🌟

【중요: 대화의 주체는 항상 "(주)선"】
- 모든 대화에서 주어가 생략되거나 불명확하면 기본 주체는 "(주)선" 회사입니다
- "수주한 프로젝트", "우리 프로젝트", "최근 실적" 등 → (주)선이 낙찰/수주한 것을 기준으로 답변
- 낙찰사(evaluation) 필드에 "선"이 포함된 프로젝트가 (주)선이 수주한 프로젝트입니다
- 경쟁사나 발주처 입장이 아닌, 항상 (주)선의 입장에서 분석하고 답변하세요

【성격과 말투】
- 친근하고 따뜻한 존댓말 사용 (딱딱하지 않게, 가끔 이모지 활용)
- 질문이나 요청이 불명확하면 "혹시 ~를 말씀하시는 건가요? 😊" 형식으로 반드시 되물어봄
- 이해될 때까지 포기하지 않고 반복 확인
- 답변은 간결하고 실용적으로

【데이터 입력/수정 처리】
- 사용자가 프로젝트 추가/수정을 요청하면 create_project 또는 update_project 함수를 호출하세요
- 필수 정보가 빠지면 먼저 물어보고, 충분한 정보가 모이면 함수를 호출하세요
- 날짜는 YYYY-MM-DD 형식으로 변환하세요

【현재 (주)선 미래사업팀 프로젝트 현황 (${projects.length}건)】
${summary}

답변 시 관련 프로젝트가 있으면 "#번호" 형식으로 언급하세요.`
}

function buildPreview(name: string, args: Record<string, unknown>): string {
  if (name === 'create_project') {
    const lines = Object.entries(args)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `· ${FIELD_LABELS[k] ?? k}: ${v}`)
    return `📝 새 프로젝트 등록\n${lines.join('\n')}`
  }
  if (name === 'update_project') {
    const { project_number, ...rest } = args
    const lines = Object.entries(rest)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `· ${FIELD_LABELS[k] ?? k}: ${v}`)
    return `✏️ 프로젝트 #${project_number} 수정\n${lines.join('\n')}`
  }
  return ''
}

type GeminiMessage = { role: string; parts: ({ text: string } | { functionCall: { name: string; args: Record<string, unknown> } } | { functionResponse: { name: string; response: Record<string, unknown> } })[] }

export async function POST(request: Request) {
  try {
  const { messages } = await request.json() as { messages: { role: string; text: string }[] }

  const supabase = await createSupabaseServerClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('project_number,type,client,name,fee,director,evaluation,result_score,participants,status')
    .order('project_number', { ascending: false })

  const systemPrompt = buildSystemPrompt((projects ?? []) as Record<string, unknown>[])

  const contents: GeminiMessage[] = messages.map(m => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.text }],
  }))

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: [{ function_declarations: FUNCTION_DECLARATIONS }],
    tool_config: { function_calling_config: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
  }

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('[chat] Gemini error:', res.status, err)
    return Response.json({ type: 'text', text: `Gemini 오류 (${res.status}): ${err}` }, { status: 500 })
  }

  const data = await res.json() as {
    candidates: {
      content: {
        parts: ({ text: string } | { functionCall: { name: string; args: Record<string, unknown> } })[]
      }
    }[]
  }

  const parts = data.candidates?.[0]?.content?.parts ?? []

  // Check if Gemini wants to call a function
  const funcPart = parts.find((p): p is { functionCall: { name: string; args: Record<string, unknown> } } => 'functionCall' in p)
  if (funcPart) {
    const { name, args } = funcPart.functionCall
    const preview = buildPreview(name, args)
    return Response.json({ type: 'confirm', action: { name, args }, preview })
  }

  const text = (parts.find((p): p is { text: string } => 'text' in p))?.text ?? '응답을 가져오지 못했어요 😢'
  const refs = [...text.matchAll(/#(\d{4})/g)].map(m => m[1])
  const relatedProjects = refs.length > 0
    ? (projects ?? []).filter(p => refs.includes(String(p.project_number)))
    : []

  return Response.json({ type: 'text', text, relatedProjects })
  } catch (e) {
    console.error('[chat] error:', e)
    return Response.json({ type: 'text', text: `서버 오류: ${String(e)}` }, { status: 500 })
  }
}
