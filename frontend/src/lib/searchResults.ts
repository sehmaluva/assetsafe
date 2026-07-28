/** Normalized option for owner/debtor/financier autocomplete fields. */
export interface SearchOption {
  id: number | null;
  name: string;
  subtitle?: string;
  source?: 'internal' | 'external';
  external_reference?: string | null;
}

export function unwrapSearchList(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const obj = data as Record<string, unknown>;

  if (Array.isArray(obj.data)) return obj.data;
  if (Array.isArray(obj.results)) return obj.results;

  if (obj.data && typeof obj.data === 'object') {
    const inner = obj.data as Record<string, unknown>;
    if (Array.isArray(inner.results)) return inner.results;
    if (Array.isArray(inner.data)) return inner.data;
  }

  return [];
}

export function mapIndividualSearchResult(
  item: Record<string, unknown>,
): SearchOption {
  const first = String(item.first_name ?? '');
  const last = String(item.last_name ?? '');
  const name =
    (typeof item.name === 'string' && item.name) ||
    `${first} ${last}`.trim() ||
    (item.id != null ? `Individual #${item.id}` : 'External individual');

  return {
    id: item.id != null ? Number(item.id) : null,
    name,
    subtitle:
      (item.identification_number as string | undefined) ??
      (item.phone as string | undefined) ??
      (item.email as string | undefined),
    source: (item.source as SearchOption['source']) ?? 'internal',
    external_reference: (item.external_reference as string | null) ?? null,
  };
}

export function mapBranchSearchResult(
  item: Record<string, unknown>,
): SearchOption {
  const company = item.company as Record<string, unknown> | undefined;
  const branchName = String(item.branch_name ?? '').trim();
  const companyName = String(
    company?.trading_name ?? company?.registration_name ?? '',
  ).trim();
  const regNo = String(company?.registration_number ?? '').trim();
  const isHq = item.is_headquarters === true;

  const branchIsDistinct =
    Boolean(branchName) &&
    Boolean(companyName) &&
    !isHq &&
    branchName.toLowerCase() !== companyName.toLowerCase() &&
    branchName.toLowerCase() !==
      String(company?.registration_name ?? '')
        .trim()
        .toLowerCase() &&
    branchName.toLowerCase() !==
      String(company?.trading_name ?? '')
        .trim()
        .toLowerCase();

  const name = branchIsDistinct
    ? `${companyName} — ${branchName}`
    : companyName || branchName || (item.id != null ? `Branch #${item.id}` : 'External company');

  return {
    id: item.id != null ? Number(item.id) : null,
    name: regNo ? `${name} (${regNo})` : name,
    subtitle: item.source === 'external' ? 'External registry' : undefined,
    source: (item.source as SearchOption['source']) ?? 'internal',
    external_reference:
      (item.external_reference as string | null) ??
      (company?.external_reference as string | null) ??
      null,
  };
}

export function mapClientSearchResult(
  item: Record<string, unknown>,
): SearchOption {
  return {
    id: Number(item.id),
    name: String(item.name ?? item.trading_name ?? `Client #${item.id}`),
    subtitle: item.external_client_id
      ? String(item.external_client_id)
      : undefined,
    source: 'internal',
  };
}

export function searchOptionKey(item: SearchOption): string {
  if (item.source === 'external' && item.external_reference) {
    return `external:${item.external_reference}`;
  }
  return `internal:${item.id ?? item.name}`;
}
