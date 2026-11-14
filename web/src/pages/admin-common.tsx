import type { ReactNode } from 'react'
import { Button, Modal } from '@heroui/react'

export const adminDate = (value: string) => new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
}).format(new Date(value))

export function AdminDialog({ open, title, onClose, children, footer, busy = false, wide = false }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean; wide?: boolean;
}) {
  return <Modal.Backdrop isOpen={open} isDismissable={!busy} isKeyboardDismissDisabled={busy} onOpenChange={value => { if (!value && !busy) onClose() }}><Modal.Container><Modal.Dialog className={wide ? 'sm:max-w-xl' : 'sm:max-w-md'}>
      <Modal.CloseTrigger isDisabled={busy} />
      <Modal.Header><Modal.Heading>{title}</Modal.Heading></Modal.Header>
      <Modal.Body>{children}</Modal.Body>
      <Modal.Footer>{footer}</Modal.Footer>
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
