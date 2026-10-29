// MOBA item roster. All numbers come from specs/moba-spec.md section 6.

export type ItemStats = {
  ad: number;
  armor: number;
  moveSpeed: number;
  attackSpeed: number;
  maxHp: number;
  demolish: boolean;
};

export type ItemDef = {
  id: string;
  cost: number;
  stats: ItemStats;
  consumable: boolean;
};

const S = (p: Partial<ItemStats>): ItemStats => ({
  ad: p.ad ?? 0,
  armor: p.armor ?? 0,
  moveSpeed: p.moveSpeed ?? 0,
  attackSpeed: p.attackSpeed ?? 0,
  maxHp: p.maxHp ?? 0,
  demolish: p.demolish ?? false,
});

// The table holds the 6 base items.
export const BASE_ITEMS: Record<string, ItemDef> = {
  scrap_blade: { id: "scrap_blade", cost: 250, stats: S({ ad: 8 }), consumable: false },
  cloth_weave: { id: "cloth_weave", cost: 250, stats: S({ armor: 15 }), consumable: false },
  worn_treads: { id: "worn_treads", cost: 250, stats: S({ moveSpeed: 0.4 }), consumable: false },
  overclock_chip: { id: "overclock_chip", cost: 300, stats: S({ attackSpeed: 0.15 }), consumable: false },
  hull_patch: { id: "hull_patch", cost: 300, stats: S({ maxHp: 100 }), consumable: false },
  repair_cell: { id: "repair_cell", cost: 50, stats: S({}), consumable: true },
};

export type Recipe = {
  id: string;
  parts: string[];
  fee: number;
  stats: ItemStats;
};

// Recipe order: tier 2 by id, then tier 3 in spec tie order.
// Shared parts resolve to the first matchable recipe in this order.
export const RECIPES: Recipe[] = [
  { id: "bulwark_plate", parts: ["cloth_weave"], fee: 350, stats: S({ armor: 35 }) },
  { id: "rapid_cycler", parts: ["overclock_chip"], fee: 350, stats: S({ attackSpeed: 0.35 }) },
  { id: "reinforced_hull", parts: ["hull_patch"], fee: 350, stats: S({ maxHp: 250 }) },
  { id: "tempered_edge", parts: ["scrap_blade"], fee: 350, stats: S({ ad: 18 }) },
  { id: "turbo_treads", parts: ["worn_treads"], fee: 350, stats: S({ moveSpeed: 0.9 }) },
  { id: "siege_breaker", parts: ["tempered_edge", "rapid_cycler"], fee: 400, stats: S({ ad: 35, attackSpeed: 0.3, demolish: true }) },
  { id: "aegis_core", parts: ["bulwark_plate", "reinforced_hull"], fee: 400, stats: S({ armor: 70, maxHp: 400 }) },
  { id: "phantom_drive", parts: ["turbo_treads", "rapid_cycler"], fee: 400, stats: S({ moveSpeed: 1.0, attackSpeed: 0.5 }) },
  { id: "warlord_frame", parts: ["tempered_edge", "reinforced_hull"], fee: 400, stats: S({ ad: 25, maxHp: 450 }) },
];

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(
  RECIPES.map((r) => [r.id, r]),
);

// The set holds every buyable id, base plus built.
export const ALL_ITEM_IDS: Set<string> = new Set([
  ...Object.keys(BASE_ITEMS),
  ...RECIPES.map((r) => r.id),
]);

export const MAX_SLOTS = 6;
export const REPAIR_HEAL = 120;

// Auto-buy scans base items in this fixed order.
export const AUTO_BUY_ORDER = [
  "scrap_blade",
  "cloth_weave",
  "overclock_chip",
  "hull_patch",
  "worn_treads",
];

// The helper sums one stat across held items.
export function sumStat(items: string[], pick: (s: ItemStats) => number): number {
  let total = 0;
  for (const id of items) {
    const base = BASE_ITEMS[id];
    if (base) {
      total += pick(base.stats);
      continue;
    }
    const recipe = RECIPE_BY_ID[id];
    if (recipe) total += pick(recipe.stats);
  }
  return total;
}

// The helper reports the base parts folded into held items.
export function coveredBases(items: string[]): Set<string> {
  const out = new Set<string>();
  const walk = (id: string): void => {
    if (BASE_ITEMS[id]) {
      out.add(id);
      return;
    }
    const recipe = RECIPE_BY_ID[id];
    if (!recipe) return;
    for (const part of recipe.parts) walk(part);
  };
  for (const id of items) walk(id);
  return out;
}

export type BuyPlan = {
  id: string;
  cost: number;
  consumed: string[];
};

// The planner prices one buy with auto-bought missing parts.
// It returns null when the id is unknown.
export function planBuy(id: string, held: string[]): BuyPlan | null {
  if (!ALL_ITEM_IDS.has(id)) return null;
  if (BASE_ITEMS[id]) {
    if (BASE_ITEMS[id].consumable) return { id, cost: BASE_ITEMS[id].cost, consumed: [] };
    return { id, cost: BASE_ITEMS[id].cost, consumed: [] };
  }
  const recipe = RECIPE_BY_ID[id];
  const have = new Set(held);
  let cost = recipe.fee;
  const consumed: string[] = [];
  const missing: string[] = [];
  for (const part of recipe.parts) {
    if (have.has(part)) {
      consumed.push(part);
    } else {
      missing.push(part);
    }
  }
  for (const part of missing) {
    const sub = RECIPE_BY_ID[part];
    if (sub) {
      const subPlan = planBuy(part, held);
      if (!subPlan) return null;
      cost += subPlan.cost;
      consumed.push(...subPlan.consumed);
    } else if (BASE_ITEMS[part]) {
      cost += BASE_ITEMS[part].cost;
    } else {
      return null;
    }
  }
  return { id, cost, consumed };
}
