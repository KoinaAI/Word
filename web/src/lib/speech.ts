import { toast } from 'sonner'
import { readPreference } from './preferences'

let player: HTMLAudioElement | undefined
let playbackId = 0

/** Stop playback and cancel outstanding audio when changing words or leaving a page. */
export function stopPronunciation() {
  playbackId++
  if (!player) return
  player.onerror = null
  player.pause()
  player.removeAttribute('src')
  player.load()
}

/** Play Youdao pronunciation: type 0 is American English; type 1 is British English. */
export function pronounce(text: string, accent = readPreference('word-accent', 'en-US')) {
  stopPronunciation()
  const word = text.trim()
  if (!word) return

  const audio = player ??= new Audio()
  const requestId = playbackId
  const params = new URLSearchParams({ type: accent === 'en-GB' ? '1' : '0', audio: word })
  let failed = false
  const reportFailure = (error?: unknown) => {
    if (requestId !== playbackId || failed) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    failed = true
    toast.error(error instanceof DOMException && error.name === 'NotAllowedError'
      ? '浏览器已阻止自动发音，请点击发音按钮播放。'
      : '发音加载失败，请检查网络后重试。')
  }
  audio.onerror = () => reportFailure()
  audio.src = `https://dict.youdao.com/dictvoice?${params}`
  void audio.play().catch(reportFailure)
}
