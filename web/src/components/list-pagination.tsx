import { Pagination } from '@heroui/react'

/** Keep rendered lists bounded while exposing the server's filtered result count. */
export function ListPagination({ offset, limit, total, busy = false, onChange }: {
  offset: number; limit: number; total: number; busy?: boolean; onChange: (offset: number) => void
}) {
  if (total <= limit && offset === 0) return null
  return <Pagination aria-label="列表分页" className="list-pagination">
    <Pagination.Summary aria-live="polite">第 {total ? offset + 1 : 0}–{Math.min(offset + limit, total)} 项，共 {total} 项</Pagination.Summary>
    <Pagination.Content>
      <Pagination.Item><Pagination.Previous isDisabled={busy || offset === 0} onPress={() => onChange(Math.max(0, offset - limit))}><Pagination.PreviousIcon />上一页</Pagination.Previous></Pagination.Item>
      <Pagination.Item><Pagination.Next isDisabled={busy || offset + limit >= total} onPress={() => onChange(offset + limit)}>下一页<Pagination.NextIcon /></Pagination.Next></Pagination.Item>
    </Pagination.Content>
  </Pagination>
}
