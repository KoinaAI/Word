import { toast } from 'sonner'
/** Uses the browser's installed English voices; no third-party audio request. */
export function pronounce(text: string, accent = 'en-US') {
  if (!('speechSynthesis' in window)) { toast.error('当前浏览器不支持发音，请换用 Chrome、Edge 或 Safari。'); return }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = accent
  utterance.rate = 0.85
  const voice = window.speechSynthesis.getVoices().find(item => item.lang === accent)
  if (voice) utterance.voice = voice
  utterance.onerror = (event) => { if (!['canceled', 'interrupted'].includes(event.error)) toast.error('发音暂不可用，请检查系统语音设置。') }
  window.speechSynthesis.speak(utterance)
}
