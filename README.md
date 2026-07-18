# 📅 시간표 생성기 (웹판)

학교 시간표 자동 생성기 — **설치 없이 브라우저에서 바로 실행**됩니다.

시간표 계산(CP-SAT 솔버)은 서버가 아니라 **사용자 브라우저 안에서, 사용자 컴퓨터의 CPU로** 실행됩니다.
- 서버 비용 0, 동시 사용자 제한 없음 (각자 자기 컴퓨터로 계산)
- 시수표 데이터가 외부로 전송되지 않음 (보안)
- Google OR-Tools CP-SAT를 WebAssembly로 구동 ([or-tools-wasm](https://github.com/Axelwickm/or-tools-wasm))

## 기능

- 시수표 엑셀 업로드 (양식 다운로드 제공) / 묶음수업 지원
- 비수업 시간(학년별·전체학년) · 교사 불가시간(학년별 + 요일×교시 격자, 전체 체크 연동) · 유사과목 그룹 · 역할 지정(교무부장/학년부장/홍보담당1·2)
- 하드 규칙: 학급중복 / 교사중복 / 비수업 / 교사불가 / 묶음 요일분산 / 같은과목 같은날 / 2시간과목 연속요일
- 교체 난이도 기반 스트레스 가중 + 반복 개선(정체 시 쉬운 수업만 흔들기)
- 실시간 진행상황(페널티) 표시, 중단, 이어서 더 돌리기, 이어돌리기 세션(.json) 저장/열기
- 설정 저장/불러오기(.json)
- 결과 미리보기(학급별/교사별, 묶음 색상) + 엑셀 다운로드(요약/전체/학급별/교사별 시트, 묶음 색상)
- 해가 없으면 원인(어느 학년·교사가 몇 칸 부족한지) 자동 진단

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
