"""
프로젝트 List 과거 연도 이관 — "○○년 참여프로젝트 관리.xlsx"(2021~2025) → project_archive / project_archive_staff

사용법
  python scripts/import_project_archive.py                       # 미리보기만(DB 안 씀) + 검토표 생성
  python scripts/import_project_archive.py --apply --env .env.dev.local   # 개발 DB에 연도 단위로 교체 저장
  python scripts/import_project_archive.py --year 2021 ...       # 특정 연도만

표 구조와 이유는 supabase/migration_project_archive.sql 머리말 참고.

2시트(참여기술자) 셀의 줄 → 1시트 프로젝트 매칭 순서
  1. 줄 전체를 정규화해 용역명과 같거나 한쪽이 다른 쪽을 포함 → 'auto'
  2. 군 시설 코드(A462·B014 등)가 같은 용역명이 하나뿐 → 'auto'
  3. 위가 안 되면 쉼표로 나눠 각 조각을 다시 1·2로 맞춘다(2021~2022년은 줄바꿈 대신 쉼표로 구분한 셀이 많다).
     'D1,D2블록'·'용문동1,2,3구역'처럼 용역명 안의 쉼표는 숫자 조각을 앞 조각에 다시 붙여 지킨다.
  4. 글자 유사도가 충분히 높고 2등과 차이가 나면 'auto'로 잇되 검토표에 '추정'으로 남긴다.
  5. 그래도 안 되면 원문만 저장(archive_project_id = null)하고 검토표에 '미매칭'으로 남긴다.
  사람이 확정한 값은 scripts/project_archive_manual_matches.json이 위 결과보다 우선한다('manual').

1시트에 인력 칸이 없는 연도(2021~2022년은 단장도 없음, 2023~2024년은 분야 인력 없음)는 위에서 확실히 맞춘
줄('auto' 중 추정이 아닌 것 + 'manual')로 1시트의 단장·건축·토목·기계·안전 칸을 채운다 — 프로젝트 List
'인력' 보기에서 과거 연도도 같은 모양으로 보이게.
"""
import argparse
import datetime as dt
import difflib
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import openpyxl

sys.stdout.reconfigure(encoding='utf-8')

ROOT = Path(__file__).resolve().parent.parent
SHARE = r'\\192.168.0.31\Works\주간업무보고(금요일마다)\#연도별 업무계획'
# 2021년 파일은 두 개 있다 — 2021년_업무계획 폴더 것은 05/10판, 2022년_업무계획 폴더 것은 12/07판(최종).
SOURCES = {
    2021: rf'{SHARE}\2022년_업무계획\2021년 참여프로젝트 관리.xlsx',
    2022: rf'{SHARE}\2023년_업무계획\2022년 참여프로젝트 관리.xlsx',
    2023: rf'{SHARE}\2024년_업무계획\2023년 참여프로젝트 관리.xlsx',
    2024: rf'{SHARE}\2025년_업무계획\2024년 참여프로젝트 관리.xlsx',
    2025: rf'{SHARE}\2026년_업무계획\2025년 참여프로젝트 관리.xlsx',
}
MANUAL_FILE = ROOT / 'scripts' / 'project_archive_manual_matches.json'
REVIEW_FILE = ROOT / 'manual-review' / '과거연도_참여현황_매칭검토.xlsx'

NON_VALUES = {'', 'ㅡ', '-', 'None'}
FIELD_TO_COLUMN = {'건축': 'staff_arch', '토목': 'staff_civil', '기계': 'staff_mech', '안전': 'staff_safety'}


# ───────────────────────── 1시트 ─────────────────────────

def txt(v) -> str:
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def blank_dash(v) -> str:
    s = txt(v)
    return '' if s in NON_VALUES else s


def to_date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    return None


def parse_fee(v):
    """숫자 → 그대로, '70.4억'·'116억' → 숫자. 못 바꾸면 (None, 원문)."""
    if v is None:
        return None, ''
    if isinstance(v, (int, float)):
        return float(v), ''
    s = str(v).strip()
    m = re.fullmatch(r'([\d.]+)\s*억?', s.replace(',', ''))
    if m:
        try:
            return float(m.group(1)), ''
        except ValueError:
            pass
    return None, s


def read_ledger(ws, year: int, source: str) -> list[dict]:
    header = [txt(h) for h in next(ws.iter_rows(min_row=2, max_row=2, values_only=True))]

    def col(*names):
        for n in names:
            if n in header:
                return header.index(n)  # 2025년은 '단장' 열이 둘 — 첫 번째를 쓴다
        return None

    idx = {
        'seq': col('연번'), 'project_number': col('관리번호'), 'type': col('발주방식'),
        'order_basis': col('발주기준'), 'client': col('발주처'), 'name': col('용역명'),
        'fee': col('용역비(억)', '용역비'), 'tp_score': col('T P', 'TP'), 'duration_days': col('배점'),
        'submit': col('제출일'), 'interview': col('평가일'), 'result_score': col('평가결과'),
        'evaluation': col('최종 낙찰사'), 'participants': col('참가업체'), 'note': col('비고'),
        'director': col('단장'), 'staff_arch': col('건축'), 'staff_safety': col('안전'),
        'staff_civil': col('토목'), 'staff_mech': col('기계'),
    }
    get = lambda row, key: row[idx[key]] if idx[key] is not None and idx[key] < len(row) else None

    rows = []
    for r in ws.iter_rows(min_row=3, values_only=True):
        name = txt(get(r, 'name'))
        number = txt(get(r, 'project_number'))
        if not name or not number:
            continue
        fee, fee_raw = parse_fee(get(r, 'fee'))
        interview = get(r, 'interview')
        interview_txt = '' if to_date(interview) else blank_dash(interview)
        note = txt(get(r, 'note'))
        evaluation = txt(get(r, 'evaluation'))
        type_ = txt(get(r, 'type')).replace('T P', 'TP')
        seq = get(r, 'seq')
        rows.append({
            'ledger_year': year,
            'seq': int(seq) if isinstance(seq, (int, float)) else None,
            'project_number': number,
            'type': type_,
            'order_basis': txt(get(r, 'order_basis')),
            'client': txt(get(r, 'client')),
            'name': name,
            'fee': fee,
            'fee_raw': fee_raw,
            'tp_score': blank_dash(get(r, 'tp_score')),
            'duration_days': blank_dash(get(r, 'duration_days')),
            'submit_date': to_date(get(r, 'submit')),
            'interview_date': to_date(interview),
            'interview_written': interview_txt == '서면',
            'interview_raw': '' if interview_txt == '서면' else interview_txt,
            # 'ㅡ'도 그대로 둔다 — 비우면 결과가 있는 건이 '결과 없음'으로 보인다(computeProjectStatus)
            'result_score': txt(get(r, 'result_score')),
            'evaluation': evaluation,
            'participants': txt(get(r, 'participants')),
            'note': note,
            'director': blank_dash(get(r, 'director')) if idx['director'] is not None else '',
            'staff_arch': blank_dash(get(r, 'staff_arch')),
            'staff_civil': blank_dash(get(r, 'staff_civil')),
            'staff_mech': blank_dash(get(r, 'staff_mech')),
            'staff_safety': blank_dash(get(r, 'staff_safety')),
            # 비고에 '취소'(중도 취소·취소)가 적힌 미수주 건은 취소로 본다 — 결과가 비어 '진행중'으로 남지 않게
            'status_override': '취소' if '취소' in note and evaluation != '선' else None,
            'source_file': source,
        })
    has_cols = {k: idx[k] is not None for k in ('director', 'staff_arch', 'staff_civil', 'staff_mech', 'staff_safety')}
    return rows, has_cols


# ───────────────────────── 2시트 ─────────────────────────

def read_staff(ws, year: int) -> list[dict]:
    """왼쪽(A~E) = 책임기술인, 오른쪽(G~K) = 분야별. 셀 안의 줄 하나 = 1행.

    person_seq는 원본 '번호' 칸이 아니라 시트에 적힌 순서다 — 2023년 시트는 두 사람에게 같은
    번호(1)가 붙어 있어 원본 번호로는 사람을 구분할 수 없다."""
    out = []
    order = {'director': 0, 'specialist': 0}
    for r in ws.iter_rows(min_row=3, values_only=True):
        for base, section in ((0, 'director'), (6, 'specialist')):
            cells = list(r[base:base + 5]) + [None] * 5
            name, field, projects = txt(cells[1]), txt(cells[2]), cells[3]
            if not name or projects is None or not txt(projects):
                continue
            order[section] += 1
            lines = [ln.strip() for ln in str(projects).split('\n')]
            lines = [ln.rstrip(',').strip() for ln in lines if ln.strip().rstrip(',').strip()]
            for i, line in enumerate(lines, start=1):
                out.append({
                    'ledger_year': year, 'section': section,
                    'person_seq': order[section],
                    'name': name, 'field': field, 'line_no': i, 'project_text': line,
                    'excel_count': cells[4],
                })
    return out


# ───────────────────────── 매칭 ─────────────────────────

MARKER_RE = re.compile(r'\s*(?:[-–]\s*)?\(?\s*(수주|중도\s*취소|재공고)\s*\)?\s*$')
CODE_RE = re.compile(r'(?<![A-Za-z])([A-D]\d{3})(?!\d)')


def norm(s: str) -> str:
    s = MARKER_RE.sub('', s)
    s = re.sub(r'^\s*LH\s*', '', s, flags=re.I)
    return re.sub(r'[\s\-_()（）·,.\[\]/#]', '', s).lower()


def split_commas(line: str) -> list[str]:
    """쉼표로 나누되 '1,2,3구역'·'D1,D2블록'처럼 용역명 안의 쉼표는 앞 조각에 다시 붙인다."""
    parts = [p.strip() for p in line.split(',')]
    merged: list[str] = []
    for p in parts:
        if not p:
            continue
        # 숫자로 시작하는 짧은 조각('2,3구역'의 '3구역', '2차)') 또는 'D2블록' 꼴만 붙인다.
        # 'A278'처럼 군 시설 코드만 적은 조각은 그 자체가 프로젝트 하나다.
        fragment = (re.match(r'\d', p) and len(p) <= 8) or re.fullmatch(r'[A-Za-z]{1,2}\d+\s*(블록|BL)\S{0,6}', p)
        if merged and fragment:
            merged[-1] = f'{merged[-1]},{p}'
        else:
            merged.append(p)
    return merged


class Matcher:
    def __init__(self, projects: list[dict]):
        self.projects = projects
        self.keys = [(p, norm(p['name'])) for p in projects]

    def strict(self, text: str):
        q = norm(text)
        if not q:
            return None
        exact = [p for p, k in self.keys if k == q]
        if len(exact) == 1:
            return exact[0]
        if len(q) >= 3:
            contains = [p for p, k in self.keys if q in k or (len(k) >= 3 and k in q)]
            if len(contains) == 1:
                return contains[0]
        codes = set(CODE_RE.findall(text))
        if len(codes) == 1:
            code = codes.pop()
            hits = [p for p in self.projects if code in p['name']]
            if len(hits) == 1:
                return hits[0]
        return None

    def fuzzy(self, text: str):
        q = norm(text)
        if len(q) < 3:
            return None, 0.0
        scored = sorted(((difflib.SequenceMatcher(None, q, k).ratio(), p) for p, k in self.keys),
                        key=lambda x: -x[0])
        best = scored[0] if scored else (0.0, None)
        second = scored[1][0] if len(scored) > 1 else 0.0
        return best[1], best[0] if best[0] - second >= 0.1 else -best[0]

    def match_line(self, text: str):
        """[(조각 원문, 프로젝트|None, 판정)] — 판정: exact / fuzzy / none."""
        # 쉼표가 있으면 용역명과 글자 그대로 같을 때만 통째로 맞춘다 — 포함 비교를 먼저 하면
        # '동탄업무복합2블록, 대명동주거복합'이 뒤 조각 하나로 잡혀 앞 프로젝트가 사라진다.
        if ',' in text:
            exact = [p for p, k in self.keys if k == norm(text)]
            hit = exact[0] if len(exact) == 1 else None
        else:
            hit = self.strict(text)
        if hit:
            return [(text, hit, 'exact')]
        pieces = split_commas(text) if ',' in text else [text]
        if len(pieces) > 1:
            results = []
            for piece in pieces:
                h = self.strict(piece)
                if h:
                    results.append((piece, h, 'exact'))
                else:
                    results.append(self._fuzzy_or_none(piece))
            return results
        return [self._fuzzy_or_none(text)]

    def _fuzzy_or_none(self, text: str):
        p, score = self.fuzzy(text)
        if p is not None and score >= 0.55:
            return (text, p, 'fuzzy')
        return (text, None, 'none', p, abs(score))


def load_manual() -> dict:
    """확정 매칭 = JSON 파일 + 검토표의 '확정 관리번호(입력)' 열. 검토표 값이 JSON보다 우선한다.
    검토표에 '없음'을 적으면 연결하지 않는다(원문만 남김)."""
    manual = json.loads(MANUAL_FILE.read_text(encoding='utf-8')) if MANUAL_FILE.exists() else {}
    if REVIEW_FILE.exists():
        ws = openpyxl.load_workbook(REVIEW_FILE).active
        for r in ws.iter_rows(min_row=2, values_only=True):
            year, text, confirmed = r[0], r[4], r[9] if len(r) > 9 else None
            if year is None or text is None or confirmed in (None, ''):
                continue
            value = txt(confirmed)
            manual.setdefault(str(year), {})[str(text)] = None if value in ('없음', '-', 'ㅡ') else value
    return manual


def build_year(year: int, path: str, manual: dict):
    wb = openpyxl.load_workbook(path, data_only=True)
    ws1, ws2 = wb.worksheets[0], wb.worksheets[1]
    projects, has_cols = read_ledger(ws1, year, Path(path).name)
    by_number = {p['project_number']: p for p in projects}
    matcher = Matcher(projects)
    manual_year = manual.get(str(year), {})

    staff_rows, review = [], []
    for line in read_staff(ws2, year):
        results = matcher.match_line(line['project_text'])
        # 쉼표로 나뉜 줄은 조각마다 1행이 된다(줄 번호는 이어서 다시 매긴다)
        for res in results:
            piece, proj, verdict = res[0], res[1], res[2]
            method = None
            if piece in manual_year:
                target = manual_year[piece]
                proj = by_number.get(str(target)) if target else None
                verdict, method = ('manual', 'manual')
            elif proj is not None:
                method = 'auto'
            staff_rows.append({**line, 'project_text': piece, '_project': proj, '_verdict': verdict,
                               'match_method': method})
            if verdict in ('fuzzy', 'none') or (verdict == 'manual'):
                suggest = proj if verdict != 'none' else (res[3] if len(res) > 3 else None)
                review.append({
                    'year': year, 'section': '책임기술인' if line['section'] == 'director' else '분야별',
                    'name': line['name'], 'field': line['field'], 'text': piece,
                    'verdict': {'fuzzy': '추정(자동 연결됨)', 'none': '미매칭', 'manual': '확정(수동)'}[verdict],
                    'suggest_number': suggest['project_number'] if suggest else '',
                    'suggest_name': suggest['name'] if suggest else '',
                    'score': round(res[4], 2) if verdict == 'none' and len(res) > 4 else '',
                    'confirmed': ('없음' if manual_year.get(piece) is None else manual_year[piece]) if piece in manual_year else '',
                })

    # 사람별 줄 번호 다시 매기기 + 엑셀 누적(회)와 비교
    count_check = []
    seen: dict = {}
    for row in staff_rows:
        key = (row['section'], row['person_seq'], row['name'])
        seen.setdefault(key, []).append(row)
    for key, rows in seen.items():
        for i, row in enumerate(rows, start=1):
            row['line_no'] = i
        excel = rows[0]['excel_count']
        if isinstance(excel, (int, float)) and int(excel) != len(rows):
            count_check.append((key[2], int(excel), len(rows)))

    # 1시트에 없는 인력 칸을 확실한 매칭으로 채운다
    for p in projects:
        fill: dict[str, list[str]] = {}
        for row in staff_rows:
            if row['_project'] is not p or row['_verdict'] not in ('exact', 'fuzzy', 'manual'):
                continue
            if row['section'] == 'director':
                if not has_cols['director']:
                    fill.setdefault('director', []).append(row['name'])
            else:
                column = FIELD_TO_COLUMN.get(row['field'])
                if column and not has_cols[column]:
                    fill.setdefault(column, []).append(row['name'])
        for column, names in fill.items():
            p[column] = ', '.join(dict.fromkeys(names))

    return projects, staff_rows, review, count_check


# ───────────────────────── 저장 ─────────────────────────

def read_env(path: Path) -> dict:
    env = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        m = re.match(r'\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$', line)
        if m:
            env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    return env


class Rest:
    def __init__(self, url: str, key: str):
        self.url, self.key = url.rstrip('/'), key

    def call(self, method: str, path: str, body=None, prefer: str = ''):
        req = urllib.request.Request(f'{self.url}/rest/v1/{path}', method=method,
                                     data=json.dumps(body).encode('utf-8') if body is not None else None)
        req.add_header('apikey', self.key)
        req.add_header('Authorization', f'Bearer {self.key}')
        req.add_header('Content-Type', 'application/json')
        if prefer:
            req.add_header('Prefer', prefer)
        with urllib.request.urlopen(req) as res:
            text = res.read().decode('utf-8')
            return json.loads(text) if text else None


def apply_year(rest: Rest, year: int, projects: list[dict], staff_rows: list[dict]):
    # 연도 단위 교체 — staff는 project를 FK(set null)로 보므로 staff를 먼저 지운다
    rest.call('DELETE', f'project_archive_staff?ledger_year=eq.{year}')
    rest.call('DELETE', f'project_archive?ledger_year=eq.{year}')
    inserted = rest.call('POST', 'project_archive?select=id,project_number', projects, prefer='return=representation')
    ids = {r['project_number']: r['id'] for r in inserted}
    payload = []
    for row in staff_rows:
        proj = row['_project']
        payload.append({
            'ledger_year': year, 'section': row['section'], 'person_seq': row['person_seq'],
            'name': row['name'], 'field': row['field'], 'line_no': row['line_no'],
            'project_text': row['project_text'],
            'archive_project_id': ids.get(proj['project_number']) if proj else None,
            'match_method': row['match_method'] if proj else None,
        })
    if payload:
        rest.call('POST', 'project_archive_staff', payload, prefer='return=minimal')
    return len(inserted), len(payload)


def write_review(reviews: list[dict]):
    from openpyxl.styles import Font, PatternFill, Alignment
    REVIEW_FILE.parent.mkdir(exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = '매칭 검토'
    head = ['연도', '구분', '성명', '분야', '2시트 원문', '판정', '추천 관리번호', '추천 용역명', '유사도',
            '확정 관리번호(입력)']
    ws.append(head)
    for c in ws[1]:
        c.font = Font(bold=True)
        c.fill = PatternFill('solid', fgColor='F4F4F2')
    for r in reviews:
        ws.append([r['year'], r['section'], r['name'], r['field'], r['text'], r['verdict'],
                   r['suggest_number'], r['suggest_name'], r['score'], r['confirmed']])
        if r['verdict'] == '미매칭':
            for c in ws[ws.max_row]:
                c.fill = PatternFill('solid', fgColor='FEF2F2')
    for col, width in zip('ABCDEFGHIJ', (7, 11, 10, 7, 36, 16, 13, 36, 8, 18)):
        ws.column_dimensions[col].width = width
    ws.freeze_panes = 'A2'
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.alignment = Alignment(vertical='top', wrap_text=True)
    wb.save(REVIEW_FILE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, action='append')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--env', default='.env.dev.local')
    ap.add_argument('--src-dir', help='엑셀을 다른 곳에 복사해 두었을 때: 2021.xlsx ~ 2025.xlsx가 있는 폴더')
    args = ap.parse_args()

    years = args.year or sorted(SOURCES)
    manual = load_manual()
    rest = None
    if args.apply:
        env = read_env(ROOT / args.env)
        rest = Rest(env['NEXT_PUBLIC_SUPABASE_URL'], env['SUPABASE_SERVICE_ROLE_KEY'])
        ref = re.match(r'https://([a-z0-9]+)\.supabase\.co', env['NEXT_PUBLIC_SUPABASE_URL'])
        print(f'[apply] 대상 DB: {args.env} ({ref.group(1)[:4]}…{ref.group(1)[-4:]})')

    all_reviews = []
    for year in years:
        path = str(Path(args.src_dir) / f'{year}.xlsx') if args.src_dir else SOURCES[year]
        projects, staff_rows, review, count_check = build_year(year, path, manual)
        verdicts = {}
        for row in staff_rows:
            verdicts[row['_verdict']] = verdicts.get(row['_verdict'], 0) + 1
        print(f'{year}: 프로젝트 {len(projects)}건 / 참여 줄 {len(staff_rows)}개 → {verdicts}')
        for name, excel, mine in count_check:
            print(f'   누적(회) 차이: {name} 엑셀 {excel}회 / 읽은 줄 {mine}개')
        all_reviews.extend(review)
        if rest:
            n_proj, n_staff = apply_year(rest, year, projects, staff_rows)
            print(f'   저장: project_archive {n_proj}행, project_archive_staff {n_staff}행')

    write_review(all_reviews)
    print(f'검토표: {REVIEW_FILE} ({len(all_reviews)}줄)')


if __name__ == '__main__':
    main()
