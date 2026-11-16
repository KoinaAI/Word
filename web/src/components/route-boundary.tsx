import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card } from '@heroui/react'

type Props = { children: ReactNode }

/** Lazy chunk failures need a reload: retrying the same rejected import cannot recover it. */
export class RouteBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('Page rendering failed', error, info.componentStack) }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="route-error" tabIndex={-1}><Card><Card.Header><Card.Title>页面暂时没有打开</Card.Title><Card.Description>网络可能中断，或网站已更新。重新加载后可继续，已保存的学习记录会保留。</Card.Description></Card.Header><Card.Footer className="flex flex-wrap gap-3"><Button onPress={() => window.location.reload()}>重新加载</Button><Button variant="outline" onPress={() => window.location.assign('/')}>返回学习空间</Button></Card.Footer></Card></main>
  }
}
