// 前置仓履约纯函数逻辑层：仓库校验、就近分配、订单状态机、取消与库存释放
import type {
  ActorRole,
  DeliveryAddress,
  Order,
  OrderItem,
  OrderStatus,
  Point,
  StockItem,
  StockShortage,
  Warehouse,
  WarehouseDraft,
} from "./types";

/** 假设 B：固定预计送达时效（分钟），对应需求待确认问题 4 */
export const ETA_MINUTES = 30;

/** 假设 C：配送超时判定时限（分钟），最小实现不做真实计时器 */
export const DELIVERY_TIMEOUT_MINUTES = 20;

/** 新建前置仓时的初始库存（演示用） */
export const DEFAULT_NEW_WAREHOUSE_STOCK = 6;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const WAREHOUSE_FIELD_LABELS = {
  name: "仓名称",
  address: "服务地址",
  radius: "服务半径",
  openHours: "营业时间",
} as const;

export type WarehouseField = keyof typeof WAREHOUSE_FIELD_LABELS;

export type WarehouseValidationResult =
  | { ok: true }
  | { ok: false; errors: Partial<Record<WarehouseField, string>> };

/** 地址与仓的平面欧氏距离（服务单位） */
export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function parseMinutes(value: string): number | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** DES-03：仓档案必填与合法性校验 */
export function validateWarehouse(draft: WarehouseDraft): WarehouseValidationResult {
  const errors: Partial<Record<WarehouseField, string>> = {};

  if (!draft.name || !draft.name.trim()) {
    errors.name = `${WAREHOUSE_FIELD_LABELS.name}不能为空`;
  }
  if (!draft.address || !draft.address.trim()) {
    errors.address = `${WAREHOUSE_FIELD_LABELS.address}不能为空`;
  }

  const radius = typeof draft.radius === "string" ? Number(draft.radius.trim()) : draft.radius;
  if (!Number.isFinite(radius) || radius <= 0) {
    errors.radius = `${WAREHOUSE_FIELD_LABELS.radius}必须为正数`;
  }

  const start = parseMinutes(draft.openHours.start);
  const end = parseMinutes(draft.openHours.end);
  if (start === null || end === null) {
    errors.openHours = `${WAREHOUSE_FIELD_LABELS.openHours}需为 HH:MM 格式`;
  } else if (end <= start) {
    errors.openHours = `${WAREHOUSE_FIELD_LABELS.openHours}结束时间需晚于开始时间`;
  }

  return Object.keys(errors).length === 0 ? { ok: true } : { ok: false, errors };
}

/** 把校验通过的草稿转成仓档案；新建仓补齐演示初始库存，编辑保留原库存 */
export function normalizeWarehouseDraft(
  draft: WarehouseDraft,
  existing: Warehouse | undefined,
  catalog: StockItem[],
): Warehouse {
  const radius = typeof draft.radius === "string" ? Number(draft.radius.trim()) : draft.radius;
  return {
    id: draft.id ?? existing?.id ?? `WH-${Date.now()}`,
    name: draft.name.trim(),
    address: draft.address.trim(),
    x: draft.x ?? existing?.x ?? 0,
    y: draft.y ?? existing?.y ?? 0,
    radius,
    openHours: { start: draft.openHours.start.trim(), end: draft.openHours.end.trim() },
    isOpen: existing?.isOpen ?? true,
    stock: existing
      ? existing.stock
      : catalog.map((item) => ({ ...item, stock: DEFAULT_NEW_WAREHOUSE_STOCK })),
  };
}

export type AllocationFailureCode = "EMPTY_CART" | "OUT_OF_RANGE" | "OUT_OF_STOCK";

export type PlaceOrderResult =
  | { ok: true; order: Order; warehouses: Warehouse[] }
  | {
      ok: false;
      code: AllocationFailureCode;
      reason: string;
      missing?: StockShortage[];
    };

export interface PlaceOrderInput {
  address: DeliveryAddress;
  items: OrderItem[];
  warehouses: Warehouse[];
  orderId: string;
  at: string;
}

/**
 * DES-04：按地址就近分配前置仓并锁库存生成订单。
 * 规则优先级：① 营业中且地址在服务半径内 ② 命中多个取距离最近（假设 A）
 * ③ 全部 SKU 库存充足则逐 SKU 扣减锁定并生成 PAID_WAIT_PICK 订单
 */
export function placeOrder(input: PlaceOrderInput): PlaceOrderResult {
  const { address, items, warehouses, orderId, at } = input;

  if (items.length === 0) {
    return { ok: false, code: "EMPTY_CART", reason: "请先选择要购买的商品" };
  }

  const candidates = warehouses
    .filter((warehouse) => warehouse.isOpen && distance(address, warehouse) <= warehouse.radius)
    .map((warehouse) => ({ warehouse, meters: distance(address, warehouse) }))
    .sort((a, b) => a.meters - b.meters);

  if (candidates.length === 0) {
    return {
      ok: false,
      code: "OUT_OF_RANGE",
      reason: "超出服务范围或前置仓休息中，暂无可用前置仓",
    };
  }

  const nearest = candidates[0].warehouse;
  const missing: StockShortage[] = [];
  for (const item of items) {
    const stockItem = nearest.stock.find((entry) => entry.sku === item.sku);
    const available = stockItem?.stock ?? 0;
    if (available < item.qty) {
      missing.push({ sku: item.sku, name: item.name, required: item.qty, available });
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      code: "OUT_OF_STOCK",
      reason: `库存不足：${missing.map((entry) => `${entry.name}（需 ${entry.required}，剩 ${entry.available}）`).join("、")}`,
      missing,
    };
  }

  const warehousesAfterLock = warehouses.map((warehouse) =>
    warehouse.id === nearest.id
      ? {
          ...warehouse,
          stock: warehouse.stock.map((stockItem) => {
            const ordered = items.find((item) => item.sku === stockItem.sku);
            return ordered ? { ...stockItem, stock: stockItem.stock - ordered.qty } : stockItem;
          }),
        }
      : warehouse,
  );

  const order: Order = {
    id: orderId,
    address,
    items: items.map((item) => ({ ...item })),
    warehouseId: nearest.id,
    warehouseName: nearest.name,
    status: "PAID_WAIT_PICK",
    etaMinutes: ETA_MINUTES,
    events: [
      {
        status: "PAID_WAIT_PICK",
        role: "系统",
        at,
        note: `下单成功，分配至 ${nearest.name}，预计 ${ETA_MINUTES} 分钟送达`,
      },
    ],
  };

  return { ok: true, order, warehouses: warehousesAfterLock };
}

export type OrderActionType =
  | "START_PICK"
  | "FINISH_PICK"
  | "REPORT_OUT_OF_STOCK"
  | "ACCEPT_DELIVERY"
  | "CONFIRM_DELIVERED"
  | "REDISPATCH";

export const ORDER_ACTION_ROLES: Record<OrderActionType, ActorRole> = {
  START_PICK: "仓内作业",
  FINISH_PICK: "仓内作业",
  REPORT_OUT_OF_STOCK: "仓内作业",
  ACCEPT_DELIVERY: "配送员",
  CONFIRM_DELIVERED: "配送员",
  REDISPATCH: "配送员",
};

export type TransitionResult =
  | { ok: true; order: Order }
  | { ok: false; reason: string };

interface ActionRule {
  from: OrderStatus;
  to: OrderStatus;
  note: string;
}

/** DES-02/05/06：状态机允许的迁移（非法迁移统一返回带原因的拒绝结果） */
const TRANSITIONS: Record<OrderActionType, ActionRule> = {
  START_PICK: { from: "PAID_WAIT_PICK", to: "PICKING", note: "开始拣货" },
  FINISH_PICK: { from: "PICKING", to: "WAIT_DELIVERY", note: "完成拣货并打包，等待配送接单" },
  REPORT_OUT_OF_STOCK: { from: "PICKING", to: "OUT_OF_STOCK", note: "拣货缺货上报，整单取消并释放库存" },
  ACCEPT_DELIVERY: { from: "WAIT_DELIVERY", to: "DELIVERING", note: "配送员接单，开始配送" },
  CONFIRM_DELIVERED: { from: "DELIVERING", to: "DELIVERED", note: "确认送达，订单完结" },
  REDISPATCH: { from: "DELIVERING", to: "DELIVERING", note: "配送超时，重新配送" },
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  PAID_WAIT_PICK: "已支付待拣货",
  PICKING: "拣货中",
  WAIT_DELIVERY: "待配送",
  DELIVERING: "配送中",
  DELIVERED: "已送达",
  CANCELLED: "已取消",
  OUT_OF_STOCK: "缺货取消",
};

/** 执行一步状态迁移，返回新订单（纯函数，不修改入参） */
export function transition(order: Order, action: OrderActionType, at: string): TransitionResult {
  const rule = TRANSITIONS[action];
  if (order.status !== rule.from) {
    return {
      ok: false,
      reason: `当前订单状态为「${STATUS_LABELS[order.status]}」，无法执行该操作`,
    };
  }

  const next: Order = {
    ...order,
    status: rule.to,
    events: [
      ...order.events,
      { status: rule.to, role: ORDER_ACTION_ROLES[action], at, note: rule.note },
    ],
  };

  if (rule.to === "OUT_OF_STOCK") next.cancelReason = "拣货缺货，整单取消";
  return { ok: true, order: next };
}

/** DES-07：取消规则——仅「已支付待拣货」允许取消（假设 D：拣货开始后不可取消） */
export function requestCancel(order: Order, at: string): TransitionResult {
  if (order.status === "PAID_WAIT_PICK") {
    return {
      ok: true,
      order: {
        ...order,
        status: "CANCELLED",
        cancelReason: "用户取消订单",
        events: [
          ...order.events,
          {
            status: "CANCELLED",
            role: "消费者",
            at,
            note: "订单已取消，库存已释放，已原路退款（模拟）",
          },
        ],
      },
    };
  }

  const reason =
    order.status === "PICKING"
      ? "拣货已开始，不允许取消"
      : order.status === "WAIT_DELIVERY" || order.status === "DELIVERING"
        ? "订单已进入配送环节，不允许取消"
        : order.status === "DELIVERED"
          ? "订单已送达，不允许取消"
          : order.status === "CANCELLED"
            ? "订单已取消，无需重复取消"
            : "订单已因缺货取消";

  return { ok: false, reason };
}

/** 释放订单锁定库存（取消、缺货取消时调用） */
export function releaseStock(warehouses: Warehouse[], items: OrderItem[]): Warehouse[] {
  return warehouses.map((warehouse) => {
    const relevant = items.filter((item) => warehouse.stock.some((entry) => entry.sku === item.sku));
    if (relevant.length === 0) return warehouse;
    return {
      ...warehouse,
      stock: warehouse.stock.map((stockItem) => {
        const released = relevant.find((item) => item.sku === stockItem.sku);
        return released ? { ...stockItem, stock: stockItem.stock + released.qty } : stockItem;
      }),
    };
  });
}

/** 配送超时判定：配送中且已超过模拟时限 */
export function isDeliveryTimeout(order: Order, now: Date, timeoutMinutes = DELIVERY_TIMEOUT_MINUTES): boolean {
  if (order.status !== "DELIVERING") return false;
  const accepted = [...order.events].reverse().find((event) => event.role === "配送员");
  if (!accepted) return false;
  const handled = order.events.filter((event) => event.role === "配送员");
  const lastEvent = handled[handled.length - 1];
  const at = parseTimeOfDay(lastEvent.at, now);
  return now.getTime() - at.getTime() >= timeoutMinutes * 60 * 1000;
}

/** 把 HH:MM:SS 解析到 now 当天；跨零点时按前一天处理 */
function parseTimeOfDay(value: string, now: Date): Date {
  const parts = value.split(":").map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const seconds = parts[2] ?? 0;
  const parsed = new Date(now);
  parsed.setHours(hours, minutes, seconds, 0);
  if (parsed.getTime() - now.getTime() > 12 * 60 * 60 * 1000) {
    parsed.setDate(parsed.getDate() - 1);
  }
  return parsed;
}

/** 当前时间格式化为 HH:MM:SS，用于时间轴与测试注入 */
export function formatTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
