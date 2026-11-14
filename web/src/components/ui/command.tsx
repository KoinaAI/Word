// Adapted from shadcn/ui Command (MIT), using cmdk and Radix Dialog.
import * as Dialog from "@radix-ui/react-dialog";
import { Command as CommandPrimitive } from "cmdk";
import type { ComponentProps, ReactNode } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";
export function CommandDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="command-overlay" />
        <Dialog.Content className="command-dialog">
          <Dialog.Title className="sr-only">快速导航</Dialog.Title>
          <Dialog.Description className="sr-only">
            搜索页面或词书，使用方向键选择并回车打开。
          </Dialog.Description>
          <CommandPrimitive className="command">{children}</CommandPrimitive>
          <Dialog.Close className="command-close" aria-label="关闭快速导航">
            Esc
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function CommandInput(
  props: ComponentProps<typeof CommandPrimitive.Input>,
) {
  return (
    <div className="command-input-wrap">
      <Icon icon="gravity-ui:magnifier" />
      <CommandPrimitive.Input {...props} className="command-input" />
    </div>
  );
}
export function CommandList(
  props: ComponentProps<typeof CommandPrimitive.List>,
) {
  return <CommandPrimitive.List {...props} className="command-list" />;
}
export function CommandEmpty(
  props: ComponentProps<typeof CommandPrimitive.Empty>,
) {
  return (
    <CommandPrimitive.Empty {...props} className="p-8 text-center text-muted" />
  );
}
export function CommandGroup(
  props: ComponentProps<typeof CommandPrimitive.Group>,
) {
  return <CommandPrimitive.Group {...props} className="command-group" />;
}
export function CommandItem({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      {...props}
      className={cn("command-item", className)}
    />
  );
}
