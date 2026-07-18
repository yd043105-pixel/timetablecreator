# 📅 시간표 생성기 (웹판)

학교 시간표 자동 생성기 — **설치 없이 브라우저에서 바로 실행**됩니다.

시간표 계산(CP-SAT 솔버)은 서버가 아니라 **사용자 브라우저 안에서, 사용자 컴퓨터의 CPU로** 실행됩니다.
- 서버 비용 0, 동시 사용자 제한 없음 (각자 자기 컴퓨터로 계산)
- 시수표 데이터가 외부로 전송되지 않음 (보안)
- Google OR-Tools CP-SAT를 WebAssembly로 구동 ([or-tools-wasm](https://github.com/Axelwickm/or-tools-wasm))

## 특징

- **설치·서버 없음** — 브라우저만 있으면 실행. 시수표가 외부로 전송되지 않고 내 컴퓨터에서만 계산됩니다.
- **자동 생성** — 하드 규칙(학급중복 / 교사중복 / 비수업 / 교사불가 / 묶음 요일분산 / 같은과목 같은날 / 2시간과목 연속요일)을 지키는 시간표를 CP-SAT 솔버가 찾아냅니다. 해가 없으면 원인(어느 학년·교사가 몇 칸 부족한지)을 자동 진단합니다.
- **장판지 편집** — 교사 × 요일·교시 전체 격자에서 수업을 직접 옮길 수 있습니다. 최하단에는 교시별 전체 수업 수 합계가 표시됩니다.
  - **드래그**: 집으면 바로 교체 가능한 칸이 초록으로 표시되고, 놓으면 이동·맞교환됩니다.
  - **우클릭 연쇄 재배치**: 목표 칸을 지정하면 밀려나는 수업까지 연쇄적으로 재배치하는 계획을 재연산 없이 즉시(수 ms) 계산해, 바뀔 수업 목록을 확인한 뒤 적용합니다.
  - 규칙 위반 칸은 붉게 표시되고, 마우스를 올리면 사유·점수가 보입니다. 편집은 언제든 취소 가능합니다.
- **이어돌리기** — 생성 중단·재개, 이어서 더 돌리기, 세션(.json) 저장/열기, 설정 저장/불러오기.
- **엑셀 입출력** — 시수표 양식 다운로드 · 묶음수업 지원 · 결과 다운로드(요약/전체/학급별/교사별 시트, 묶음 색상).
- **규칙 추가 요청 게시판** — 좌측 메뉴 "💬 규칙 추가 요청"에서 기능 요청과 댓글을 남길 수 있습니다(GitHub Issues 연동, 작성은 GitHub 로그인 필요).

## 사용 방법

1. **기본 입력** — "시수표 열기"로 엑셀 시수표를 엽니다(처음이면 "빈 양식 만들기"로 양식을 받아 채우세요). 필요하면 비수업 시간(자율·창체 등), 교사 불가시간, 유사과목 그룹을 지정합니다.
2. **규칙 · 설정** — 적용할 규칙을 확인하고 **시간표 생성**을 누릅니다. 왼쪽에 페널티가 실시간으로 표시되며, 만족스러우면 **생성 중단**을 눌러도 됩니다(그때까지의 최선 결과 사용).
3. **결과 · 장판지** — 학급별/교사별/장판지 보기로 결과를 확인하고, 드래그나 우클릭으로 미세 조정한 뒤 **엑셀 다운로드**로 저장합니다. 다음에 이어서 개선하려면 **이어돌리기 저장**을 해두세요.

## 로컬 개발

```bash
npm install
npm run dev        # 개발 서버 (COOP/COEP 헤더 자동)
npm run test       # Node에서 엔진 정합성 + 솔버 테스트
npm run build      # dist/ 생성
npm run preview    # 빌드 결과 미리보기
```

## GitHub Pages 배포

이 폴더를 GitHub 저장소로 올리면 자동으로 배포됩니다.

1. GitHub에서 새 저장소 생성 (Public)
2. 이 폴더에서:
   ```bash
   git init
   git add .
   git commit -m "시간표 생성기 웹판"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/<저장소명>.git
   git push -u origin main
   ```
3. 저장소 **Settings → Pages → Source**를 **GitHub Actions**로 설정
4. Actions 탭에서 "Deploy to GitHub Pages" 완료를 기다리면
   `https://<사용자명>.github.io/<저장소명>/` 주소가 생깁니다.

> **왜 coi-serviceworker가 필요한가** — 솔버가 멀티스레드 WASM이라
> 교차 출처 격리(COOP/COEP 헤더)가 필요한데, GitHub Pages는 커스텀 헤더를 못 붙입니다.
> `public/coi-serviceworker.min.js`가 서비스워커로 헤더를 대신 주입합니다
> (첫 접속 시 페이지가 한 번 자동 새로고침되는 것이 정상입니다).

## Netlify / Cloudflare Pages 배포 (보안 헤더 완전 적용)

GitHub Pages는 응답 헤더를 못 붙여 CSP·클릭재킹 방어 등이 meta 태그·스크립트 수준에 그칩니다.
`public/_headers`에 보안 헤더 8종이 정의되어 있어, 아래 호스팅에 연결하면 그대로 적용됩니다.

- **Netlify** — 저장소 연결만 하면 `netlify.toml`을 자동 인식합니다.
- **Cloudflare Pages** — 빌드 명령 `npm run build`, 출력 디렉터리 `dist`로 연결합니다.
  (빌드에 포함된 `scripts/prune_wasm.mjs`가 대형 WASM을 정리해 파일당 25MiB 제한을 통과합니다)

둘 다 진짜 COOP/COEP 헤더가 붙으므로 coi-serviceworker 없이도 교차 출처 격리가 됩니다(있어도 무해).

## 구조

| 파일 | 역할 |
|---|---|
| `src/engine.js` | 엑셀 파서 + 스케줄러 + 증분 페널티 State (Python `excel_parser.py`/`scheduler.py` 포팅) |
| `src/solver.js` | CP-SAT 모델 + 반복 개선 (Python `cpsat_solver.py` 포팅) |
| `src/xlsx_out.js` | 결과 엑셀 생성 (Python `output.py` 포팅, ExcelJS) |
| `src/main.js` | UI |
| `public/template.xlsx` | 시수표 양식 |
| `test/` | Node 검증 스크립트 (파이썬과 페널티 정합성 교차검증 포함) |

made by 여양고 김동욱
