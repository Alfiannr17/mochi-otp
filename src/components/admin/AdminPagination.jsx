export default function AdminPagination({ page, totalPages, total, pageSize, onPageChange }) {
  if (totalPages <= 1) return null;

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);

  return (
    <div className="mt-5 border-2 border-black rounded-xl bg-white p-3 shadow-neo">
      <p className="mb-3 text-xs font-black text-center text-gray-600">
        Menampilkan {start}-{end} dari {total} data
      </p>
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
