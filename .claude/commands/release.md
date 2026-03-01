버전 릴리스를 수행합니다. 인자로 버전 번호를 받습니다 (예: `/release 1.1.7`).

다음 단계를 순서대로 실행하세요:

1. `package.json`의 `version` 필드를 지정된 버전으로 업데이트
2. `git add package.json` 및 기타 변경된 파일을 스테이징
3. 커밋 메시지 작성: 변경 내용을 분석하여 한국어로 간결한 커밋 메시지 생성
   - 형식: `fix: v{버전} — 주요 변경 요약`
   - Co-Authored-By 포함
4. `git tag v{버전}` 태그 생성
5. `git push origin main --tags` 푸시

인자가 없으면 현재 package.json 버전의 patch를 자동 증가시킵니다.
