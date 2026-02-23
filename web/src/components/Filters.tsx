interface FiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  monthFilter: string;
  onMonthFilterChange: (v: string) => void;
  accountOptions: string[];
  monthOptions: string[];
}

export function Filters({
  search,
  onSearchChange,
  accountFilter,
  onAccountFilterChange,
  monthFilter,
  onMonthFilterChange,
  accountOptions,
  monthOptions,
}: FiltersProps) {
  return (
    <div className="filters">
      <input
        type="text"
        placeholder="Search transactions..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="filter-search"
      />
      <select
        value={accountFilter}
        onChange={(e) => onAccountFilterChange(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Accounts</option>
        {accountOptions.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
      <select
        value={monthFilter}
        onChange={(e) => onMonthFilterChange(e.target.value)}
        className="filter-select"
      >
        <option value="all">All Months</option>
        {monthOptions.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
}
