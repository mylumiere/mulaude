/**
 * afterPack — Ad-hoc 코드 서명
 *
 * electron-builder의 identity: null (서명 스킵) 이후 실행되어
 * ad-hoc 서명(-s -)을 적용합니다.
 *
 * 효과: macOS Gatekeeper가 "손상되었습니다" 대신
 * "확인되지 않은 개발자" 경고를 표시하며,
 * 시스템 설정 > 보안에서 "그래도 열기" 버튼이 나타납니다.
 */

const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  // macOS만 처리
  if (process.platform !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  )
  const entitlements = path.join(context.packager.projectDir, 'resources', 'entitlements.mac.plist')

  console.log(`[afterPack] Ad-hoc signing: ${appPath}`)
  try {
    execSync(
      `codesign --force --deep -s - --entitlements "${entitlements}" "${appPath}"`,
      { stdio: 'inherit' }
    )
    console.log('[afterPack] Ad-hoc signing complete')
  } catch (err) {
    console.warn('[afterPack] Ad-hoc signing failed (non-fatal):', err.message)
  }
}
