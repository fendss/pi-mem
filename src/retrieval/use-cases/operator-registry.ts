import type { SearchOperatorCatalogEntry } from "../model/search-operator.js";
import type { SearchOperator } from "../ports/search-operator.js";

const OPERATOR_ID = /^[a-z][a-z0-9._-]{0,63}$/u;

function normalizedText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} must not be empty`);
  return normalized;
}

function catalogEntry(operator: SearchOperator): SearchOperatorCatalogEntry {
  return {
    id: operator.id,
    version: operator.version,
    guide: {
      summary: operator.guide.summary,
      useWhen: [...operator.guide.useWhen],
      ...(operator.guide.avoidWhen === undefined
        ? {}
        : { avoidWhen: [...operator.guide.avoidWhen] }),
      cost: operator.guide.cost,
    },
  };
}

export class SearchOperatorRegistry {
  readonly defaultOperatorId: string;

  private readonly operators = new Map<string, SearchOperator>();
  private frozen = false;

  constructor(defaultOperatorId = "hybrid") {
    this.defaultOperatorId = normalizedText(
      defaultOperatorId,
      "Default operator ID",
    );
  }

  register(operator: SearchOperator): this {
    if (this.frozen) {
      throw new Error("Search operator registry is frozen");
    }
    const id = normalizedText(operator.id, "Search operator ID");
    if (!OPERATOR_ID.test(id)) {
      throw new Error(
        `Invalid search operator ID ${JSON.stringify(id)}; expected ${String(OPERATOR_ID)}`,
      );
    }
    normalizedText(operator.version, `Search operator ${id} version`);
    normalizedText(operator.guide.summary, `Search operator ${id} summary`);
    if (operator.guide.useWhen.length === 0) {
      throw new Error(`Search operator ${id} must declare at least one useWhen rule`);
    }
    if (this.operators.has(id)) {
      throw new Error(`Search operator ${id} is already registered`);
    }
    this.operators.set(id, operator);
    return this;
  }

  freeze(): this {
    if (!this.operators.has(this.defaultOperatorId)) {
      throw new Error(
        `Default search operator ${this.defaultOperatorId} is not registered`,
      );
    }
    this.frozen = true;
    return this;
  }

  get(operatorId: string): SearchOperator {
    this.assertFrozen();
    const operator = this.operators.get(operatorId);
    if (operator === undefined) {
      const available = [...this.operators.keys()].sort().join(", ");
      throw new Error(
        `Unknown search operator ${JSON.stringify(operatorId)}. Available: ${available || "none"}`,
      );
    }
    return operator;
  }

  list(): SearchOperatorCatalogEntry[] {
    this.assertFrozen();
    return [...this.operators.values()].map(catalogEntry);
  }

  private assertFrozen(): void {
    if (!this.frozen) {
      throw new Error("Search operator registry must be frozen before use");
    }
  }
}

export function renderSearchOperatorCatalog(
  entries: readonly SearchOperatorCatalogEntry[],
): string {
  if (entries.length === 0) return "No search operators are available.";
  return [
    "Available search operators (frozen for this run):",
    ...entries.flatMap((entry) => [
      `- ${entry.id}@${entry.version} | cost=${entry.guide.cost} | ${entry.guide.summary}`,
      `  use_when=${entry.guide.useWhen.join("; ")}`,
      ...(entry.guide.avoidWhen === undefined || entry.guide.avoidWhen.length === 0
        ? []
        : [`  avoid_when=${entry.guide.avoidWhen.join("; ")}`]),
    ]),
  ].join("\n");
}
