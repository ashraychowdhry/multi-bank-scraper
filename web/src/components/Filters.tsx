interface FiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  monthFilter: string;
  onMonthFilterChange: (v: string) => void;
  institutionFilter?: string;
  onInstitutionFilterChange?: (v: string) => void;
  accountOptions: string[];
  monthOptions: string[];
  institutionOptions?: string[];
}

export function Filters({
  search,
  onSearchChange,
  accountFilter,
  onAccountFilterChange,
  monthFilter,
  onMonthFilterChange,
  institutionFilter,
  onInstitutionFilterChange,
  accountOptions,
  monthOptions,
  institutionOptions,
}: FiltersProps) {
  return (
    <div className="filters">
      <input
        type="text"
        placeholder="Search..."
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        className="filter-search"
      />
      {institutionOptions && institutionOptions.length > 1 && onInstitutionFilterChange && (
        <select
          value={institutionFilter || "all"}
          onChange={(e) => onInstitutionFilterChange(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Institutions</option>
          {institutionOptions.map((name) => (
            <option key={name} value={name}>
              {name.charAt(0).toUpperCase() + name.slice(1)}
            </option>
          ))}
        </select>
      )}
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
