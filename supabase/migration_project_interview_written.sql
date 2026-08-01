-- 발표/면접일 "서면평가" 표시 컬럼 — projects.interview_written
--
-- 배경: 일부 공고는 발표(면접) 없이 서면으로만 평가한다. 예전에는 이걸 발표일 칸에
-- "서면"이라는 글자로 적어뒀고(lib/projectStatus.ts의 categorizeProject가 아직 그 문자열을
-- 분기 처리한다), 월간보고는 project_tooltips.interview_time에 "서면평가"라고 적힌 걸 보고
-- 판정했다. 그런데 projects.interview_date는 실제로는 date 타입이라 "서면" 같은 텍스트를
-- 아예 저장할 수 없다 — 즉 예전 규칙은 현재 스키마에서 동작하지 않는 죽은 분기이고,
-- 월간 쪽 판정은 "면접시간" 칸을 용도 밖으로 빌려 쓰는 우회였다.
--
-- 그래서 "서면평가 여부"를 날짜 칸에서 분리해 전용 boolean으로 둔다. 이러면
--   - 프로젝트 List 입력 폼에서 날짜 대신 서면평가를 명시적으로 고를 수 있고,
--   - 주간보고 분류(categorizeProject)가 "제출일이 지났고 서면평가면 곧장 개찰"을
--     날짜 파싱 없이 판정할 수 있으며,
--   - 월간보고도 interview_time을 빌려 쓰지 않고 이 값만 보면 된다.
--
-- interview_date는 그대로 둔다(서면평가면 null). 발표가 없는 건이므로 구글 캘린더 발표일
-- 일정·연장근무 종료일 등 interview_date를 쓰는 기존 로직은 "날짜 없음"으로 자연스럽게 처리된다.

alter table projects
  add column if not exists interview_written boolean not null default false;

comment on column projects.interview_written is
  '발표(면접) 없이 서면으로만 평가하는 공고면 true. true일 때 interview_date는 비워 둔다.';

-- 기존 데이터 이관: 발표일이 비어 있고 project_tooltips.interview_time에 "서면평가"라고
-- 적어둔 건들이 지금까지의 서면평가 표시였다. 같은 뜻이므로 새 컬럼으로 옮긴다.
-- (interview_time 원문은 지우지 않는다 — 사람이 적어둔 메모라 남겨두는 편이 안전하다.)
update projects p
set interview_written = true
from project_tooltips t
where t.project_number = p.project_number
  and p.interview_date is null
  and t.interview_time like '%서면평가%';
