/**
 * NDJSON (Newline Delimited JSON) 파서
 *
 * Node.js Transform 스트림으로 구현되어, stdout 출력을 줄 단위로 버퍼링하고
 * 완전한 JSON 라인을 파싱하여 객체로 downstream에 push합니다.
 *
 * `claude -p --output-format stream-json` 의 출력을 파싱하는 데 사용됩니다.
 *
 * 동작 방식:
 *   1. 수신된 chunk를 내부 버퍼에 축적
 *   2. 개행 문자('\n')로 분할하여 완전한 줄만 처리
 *   3. 마지막 불완전한 줄은 버퍼에 유지 (다음 chunk에서 이어짐)
 *   4. 빈 줄과 JSON 파싱 실패 줄은 무시
 */

import { Transform, TransformCallback } from 'stream'

export class NdjsonParser extends Transform {
  /** 아직 개행으로 끝나지 않은 불완전한 마지막 줄 */
  private buffer = ''

  constructor() {
    super({ readableObjectMode: true, writableObjectMode: false })
  }

  /**
   * 수신된 chunk를 줄 단위로 분할하여 JSON 파싱 후 push합니다.
   *
   * @param chunk - stdout에서 수신된 바이너리/문자열 데이터
   * @param _encoding - 인코딩 (사용하지 않음)
   * @param callback - Transform 완료 콜백
   */
  _transform(chunk: Buffer | string, _encoding: string, callback: TransformCallback): void {
    this.buffer += chunk.toString()
    const lines = this.buffer.split('\n')
    // 마지막 요소는 불완전한 줄일 수 있으므로 버퍼에 유지
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        this.push(JSON.parse(trimmed))
      } catch {
        // 잘못된 형식의 줄은 무시
      }
    }
    callback()
  }

  /**
   * 스트림 종료 시 버퍼에 남은 데이터를 처리합니다.
   *
   * @param callback - flush 완료 콜백
   */
  _flush(callback: TransformCallback): void {
    if (this.buffer.trim()) {
      try {
        this.push(JSON.parse(this.buffer.trim()))
      } catch {
        // 무시
      }
    }
    callback()
  }
}
