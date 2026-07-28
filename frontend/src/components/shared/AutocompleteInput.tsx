import React, { useEffect, useRef, useState } from 'react';
import { useAutocomplete } from '@/hooks/useAutocomplete';
import { searchOptionKey, type SearchOption } from '@/lib/searchResults';
import { cn } from '@/lib/utils';

interface Props {
  label?: string;
  placeholder?: string;
  error?: string;
  required?: boolean;
  value?: number | string;
  displayLabel?: string;
  queryKey?: string;
  minChars?: number;
  onChange?: (v: number) => void;
  onBlur?: () => void;
  fetchFn: (q: string) => Promise<SearchOption[]>;
  onCreateNew?: (query: string) => void;
  createLabel?: string;
  resolveSelection?: (item: SearchOption) => Promise<number>;
}

export function AutocompleteInput({
  label,
  placeholder,
  error,
  required,
  value,
  displayLabel,
  queryKey = 'autocomplete',
  minChars = 2,
  onChange,
  onBlur,
  fetchFn,
  onCreateNew,
  createLabel = 'Create',
  resolveSelection,
}: Props) {
  const [query, setQuery] = useState(displayLabel ?? '');
  const [showList, setShowList] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (displayLabel !== undefined) {
      setQuery(displayLabel);
    }
  }, [displayLabel]);

  const {
    data: items = [],
    isFetching,
    isError,
    enabled: searchEnabled,
  } = useAutocomplete<SearchOption>(queryKey, query, fetchFn, {
    debounceMs: 300,
    minChars,
  });

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setShowList(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const trimmed = query.trim();
  const showPanel = showList && trimmed.length > 0;
  const isEmptyState =
    searchEnabled &&
    !isFetching &&
    !selecting &&
    !isError &&
    items.length === 0;

  const handleSelect = async (item: SearchOption) => {
    setSelecting(true);
    try {
      const resolvedId = resolveSelection
        ? await resolveSelection(item)
        : item.id;
      if (resolvedId == null) {
        throw new Error('Invalid selection');
      }
      setQuery(item.name);
      setShowList(false);
      onChange?.(resolvedId);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      {label ? (
        <label className="text-xs font-medium text-slate-700">
          {label}
          {required ? <span className="text-red-500 ml-0.5">*</span> : null}
        </label>
      ) : null}

      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setShowList(true);
          if (!e.target.value.trim() && value) {
            onChange?.(0);
          }
        }}
        onFocus={() => setShowList(true)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        className={cn(
          'h-8 w-full rounded-sm border border-slate-500 bg-white px-2.5 text-sm text-slate-900',
          'placeholder:text-slate-400 focus:border-black focus:outline-none focus:ring-0',
          error && 'border-red-500 focus:border-red-500',
        )}
      />

      {showPanel ? (
        <div
          className={cn(
            'absolute z-[60] mt-1 overflow-hidden rounded border border-slate-300 bg-white shadow-md',
            isEmptyState
              ? 'w-max min-w-[13rem] max-w-[17rem]'
              : 'max-h-48 w-full overflow-auto',
          )}
        >
          {!searchEnabled ? (
            <div className="p-2 text-sm text-slate-500">
              Type at least {minChars} characters to search
            </div>
          ) : isFetching || selecting ? (
            <div className="p-2 text-sm text-slate-500">
              {selecting ? 'Importing...' : 'Searching...'}
            </div>
          ) : isError ? (
            <div className="p-2 text-sm text-red-500">
              Search failed. Please try again.
            </div>
          ) : items.length > 0 ? (
            items.map((item) => (
              <button
                key={searchOptionKey(item)}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleSelect(item)}
              >
                <div className="font-medium">{item.name}</div>
                {item.subtitle ? (
                  <div className="text-xs text-slate-400">{item.subtitle}</div>
                ) : null}
              </button>
            ))
          ) : (
            <div className="px-3 py-3">
              <p className="text-sm text-slate-600">No results found</p>
              {onCreateNew ? (
                <button
                  type="button"
                  className="mt-2.5 w-full rounded bg-[#0f7d8e] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0d6e7e]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setShowList(false);
                    onCreateNew(trimmed);
                  }}
                >
                  {createLabel}
                </button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}

export default AutocompleteInput;
