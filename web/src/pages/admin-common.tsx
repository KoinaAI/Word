import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@heroui/react'

export const adminDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
}).format(new Date(value))

export function AdminDialog({ open, title, onClose, children, footer, busy = false, wide = false, dirty = false, onDiscard }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean; wide?: boolean;
  dirty?: boolean; onDiscard?: () => void;
}) {
  const [confirmClose, setConfirmClose] = useState(false)
  const close = () => {
    if (busy) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  return <Modal.Backdrop isOpen={open} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={value => { if (!value) close() }}><Modal.Container><Modal.Dialog className={wide ? 'sm:max-w-xl' : 'sm:max-w-md'}>
      <Modal.CloseTrigger isDisabled={busy} />
      <Modal.Header className="pr-10"><Modal.Heading>{title}</Modal.Heading></Modal.Header>
      <Modal.Body>{confirmClose ? <div className="space-y-3" role="alert"><p className="font-medium">还有未保存的修改</p><p className="text-sm leading-6 text-muted">继续编辑，或关闭并保留草稿。草稿仅保存在当前标签页，重新打开可继续。</p></div> : children}</Modal.Body>
      <Modal.Footer>{confirmClose ? <><Button variant="secondary" onPress={() => setConfirmClose(false)}>继续编辑</Button>{onDiscard && <Button variant="danger-soft" onPress={() => { onDiscard(); onClose() }}>丢弃草稿</Button>}<Button onPress={onClose}>保留草稿并关闭</Button></> : footer}</Modal.Footer>
    </Modal.Dialog></Modal.Container></Modal.Backdrop>
}

export function DeleteDialog({ title, description, busy, onCancel, onConfirm }: {
  title: string; description: string; busy: boolean; onCancel: () => void; onConfirm: () => void;
}) {
  return <AdminDialog open title={title} onClose={onCancel} busy={busy} footer={<>
    <Button variant="secondary" isDisabled={busy} onPress={onCancel}>取消</Button>
    <Button variant="danger-soft" isPending={busy} onPress={onConfirm}>确认删除</Button>
  </>}><p className="text-sm leading-6 text-muted">{description}</p></AdminDialog>
}
