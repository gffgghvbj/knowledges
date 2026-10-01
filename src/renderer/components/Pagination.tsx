export function Pagination({
  page,
  total,
  onChange,
}: {
  page: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total <= 50) return null;
  return (
    <div className="pagination">
      <button
        type="button"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        上一页
      </button>
      <span>
        {page + 1} / {Math.ceil(total / 50)}
      </span>
      <button
        type="button"
        disabled={(page + 1) * 50 >= total}
        onClick={() => onChange(page + 1)}
      >
        下一页
      </button>
    </div>
  );
}
