export function HistoryFilter({ value, onChange, options, resultCount }) {
  return (
    <div className="mb-6 border-2 border-black rounded-xl bg-white p-3 shadow-neo">
      <label htmlFor="history-status-filter" className="block text-xs font-black mb-2">
        Filter Status
      </label>
      <select
        id="history-status-filter"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border-2 border-black rounded-lg bg-white px-3 py-2 font-black text-sm outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <p className="mt-2 text-[10px] font-bold text-gray-600">
        Menampilkan {resultCount} transaksi
      </p>
    </div>
  );
}

export function HistoryPagination({ page, totalPages, onPageChange }) {
  if (totalPages <= 1) return null;

  return (
    <div className="mt-6 border-2 border-black rounded-xl bg-white p-3 shadow-neo">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="border-2 border-black rounded-lg bg-white px-3 py-2 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none disabled:opacity-40 disabled:shadow-none"
        >
          Sebelumnya
        </button>
        <span className="text-xs font-black whitespace-nowrap">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="border-2 border-black rounded-lg bg-mochi-green px-3 py-2 text-xs font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-y-1 active:shadow-none disabled:opacity-40 disabled:shadow-none"
        >
          Berikutnya
        </button>
      </div>
    </div>
  );
}
