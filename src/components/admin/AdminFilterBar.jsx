import { SearchIcon } from '../Icons';

export default function AdminFilterBar({
  search,
  onSearchChange,
  placeholder,
  filter,
  onFilterChange,
  options,
  resultCount,
}) {
  return (
    <div className="mb-5 border-2 border-black rounded-xl bg-white p-4 shadow-neo">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
        <div className="relative">
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={placeholder}
            className="w-full border-2 border-black rounded-lg py-3 pl-4 pr-11 font-bold outline-none focus:bg-mochi-bg"
          />
          <SearchIcon className="absolute right-3 top-3.5 w-5 h-5" />
        </div>
        <select
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          className="w-full border-2 border-black rounded-lg px-3 py-3 bg-white font-black outline-none"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
      <p className="mt-3 text-xs font-black text-gray-600">{resultCount} data ditemukan</p>
    </div>
  );
}
