// 履约纯函数单测：覆盖 REQ-001~005 的验收要点
import { describe, expect, it } from "vitest";
import { SEED_WAREHOUSES } from "./data";
import {
  ETA_MINUTES,
  isDeliveryTimeout,
  placeOrder,
  releaseStock,
  requestCancel,
  transition,
  validateWarehouse,
} from "./engine";
import type { DeliveryAddress, OrderItem, Warehouse } from "./types";

function warehouses(): Warehouse[] {
  return structuredClone(SEED_WAREHOUSES);
}

const ADDRESS_IN_RANGE: DeliveryAddress = { label: "静安寺门店", x: 1, y: 1 };
const ADDRESS_TWO_CANDIDATES: DeliveryAddress = { label: "徐汇中心", x: 4, y: 2 };
const ADDRESS_OUT_OF_RANGE: DeliveryAddress = { label: "浦东机场", x: 20, y: 18 };
const ADDRESS_ONLY_CLOSED: DeliveryAddress = { label: "世纪大道", x: 12, y: 1 };

const APPLES: OrderItem = { sku: "SKU-AP01", name: "红富士苹果 500g", price: 12.9, qty: 2 };
const MILK: OrderItem = { sku: "SKU-MK01", name: "鲜牛奶 950ml", price: 15.5, qty: 1 };

function stockOf(list: Warehouse[], warehouseId: string, sku: string): number {
  const target = list.find((item) => item.id === warehouseId);
  return target?.stock.find((item) => item.sku === sku)?.stock ?? -1;
}

describe("REQ-001 前置仓档案校验", () => {
  const valid = {
    name: "长宁前置仓",
    address: "长宁区仙霞路 99 号",
    radius: "5" as const,
    openHours: { start: "07:00", end: "22:00" },
  };

  it("合法档案通过校验", () => {
    expect(validateWarehouse(valid)).toEqual({ ok: true });
  });

  it("名称与服务地址不能为空", () => {
    const result = validateWarehouse({ ...valid, name: "  ", address: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.name).toBeTruthy();
      expect(result.errors.address).toBeTruthy();
    }
  });

  it("服务半径必须为正数", () => {
    for (const radius of ["0", "-1", "abc"] as const) {
      const result = validateWarehouse({ ...valid, radius });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors.radius).toContain("正数");
    }
  });

  it("营业时间需合法且结束晚于开始", () => {
    const badFormat = validateWarehouse({ ...valid, openHours: { start: "7:00", end: "22:00" } });
    expect(badFormat.ok).toBe(false);

    const reversed = validateWarehouse({ ...valid, openHours: { start: "22:00", end: "07:00" } });
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) expect(reversed.errors.openHours).toContain("晚于");
  });
});

describe("REQ-002 下单与前置仓自动分配", () => {
  it("范围内地址命中营业仓、锁定库存并生成已支付待拣货订单", () => {
    const list = warehouses();
    const result = placeOrder({
      address: ADDRESS_IN_RANGE,
      items: [APPLES, MILK],
      warehouses: list,
      orderId: "PP-0001",
      at: "10:00:00",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.status).toBe("PAID_WAIT_PICK");
    expect(result.order.warehouseId).toBe("WH-SH-01");
    expect(result.order.warehouseName).toBe("静安前置仓");
    expect(result.order.etaMinutes).toBe(ETA_MINUTES);
    expect(result.order.events[0].role).toBe("系统");
    expect(stockOf(result.warehouses, "WH-SH-01", "SKU-AP01")).toBe(6);
    expect(stockOf(result.warehouses, "WH-SH-01", "SKU-MK01")).toBe(1);
  });

  it("多个仓命中时取距离最近的仓", () => {
    const result = placeOrder({
      address: ADDRESS_TWO_CANDIDATES,
      items: [APPLES],
      warehouses: warehouses(),
      orderId: "PP-0002",
      at: "10:00:00",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.warehouseId).toBe("WH-SH-02");
  });

  it("范围外地址被拦截并给出原因", () => {
    const result = placeOrder({
      address: ADDRESS_OUT_OF_RANGE,
      items: [APPLES],
      warehouses: warehouses(),
      orderId: "PP-0003",
      at: "10:00:00",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("OUT_OF_RANGE");
    expect(result.reason).toContain("超出服务范围");
  });

  it("闭店仓不参与分配，拦截并提示", () => {
    const result = placeOrder({
      address: ADDRESS_ONLY_CLOSED,
      items: [APPLES],
      warehouses: warehouses(),
      orderId: "PP-0004",
      at: "10:00:00",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("OUT_OF_RANGE");
    expect(result.reason).toContain("休息");
  });

  it("库存不足时返回具体 SKU 且不生成订单、不扣减库存", () => {
    const result = placeOrder({
      address: ADDRESS_IN_RANGE,
      items: [{ ...MILK, qty: 3 }],
      warehouses: warehouses(),
      orderId: "PP-0005",
      at: "10:00:00",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("OUT_OF_STOCK");
    expect(result.missing?.[0]).toMatchObject({ sku: "SKU-MK01", required: 3, available: 2 });
    expect(result.reason).toContain("鲜牛奶");
  });

  it("空购物车被拒绝", () => {
    const result = placeOrder({
      address: ADDRESS_IN_RANGE,
      items: [],
      warehouses: warehouses(),
      orderId: "PP-0006",
      at: "10:00:00",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("EMPTY_CART");
  });
});

function placedOrder(items: OrderItem[] = [APPLES, MILK]) {
  const result = placeOrder({
    address: ADDRESS_IN_RANGE,
    items,
    warehouses: warehouses(),
    orderId: "PP-0100",
    at: "10:00:00",
  });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe("REQ-003 仓内拣货打包", () => {
  it("开始拣货 → 完成拣货打包，状态与时间轴记录正确", () => {
    const { order } = placedOrder();

    const picking = transition(order, "START_PICK", "10:00:30");
    expect(picking.ok).toBe(true);
    if (!picking.ok) return;
    expect(picking.order.status).toBe("PICKING");
    const pickEvent = picking.order.events[picking.order.events.length - 1];
    expect(pickEvent).toMatchObject({ status: "PICKING", role: "仓内作业", at: "10:00:30" });

    const packed = transition(picking.order, "FINISH_PICK", "10:03:00");
    expect(packed.ok).toBe(true);
    if (!packed.ok) return;
    expect(packed.order.status).toBe("WAIT_DELIVERY");
    expect(packed.order.events[packed.order.events.length - 1].note).toContain("完成拣货");
    expect(packed.order.events).toHaveLength(3);
  });

  it("上报缺货转缺货取消并释放锁定库存", () => {
    const { order, warehouses: locked } = placedOrder();
    const picking = transition(order, "START_PICK", "10:00:30");
    if (!picking.ok) throw new Error(picking.reason);

    const shortage = transition(picking.order, "REPORT_OUT_OF_STOCK", "10:01:00");
    if (!shortage.ok) throw new Error(shortage.reason);
    expect(shortage.order.status).toBe("OUT_OF_STOCK");
    expect(shortage.order.cancelReason).toContain("缺货");

    const released = releaseStock(locked, shortage.order.items);
    expect(stockOf(released, "WH-SH-01", "SKU-MK01")).toBe(2);
    expect(stockOf(released, "WH-SH-01", "SKU-AP01")).toBe(8);
  });
});

describe("REQ-004 即时配送与履约跟踪", () => {
  it("全链路按序迁移并保留全程时间轴", () => {
    const { order } = placedOrder();
    const steps: Array<Parameters<typeof transition>[1]> = [
      "START_PICK",
      "FINISH_PICK",
      "ACCEPT_DELIVERY",
      "CONFIRM_DELIVERED",
    ];
    let current = order;
    const times = ["10:00:30", "10:03:00", "10:05:00", "10:26:00"];
    steps.forEach((action, index) => {
      const result = transition(current, action, times[index]);
      if (!result.ok) throw new Error(result.reason);
      current = result.order;
    });

    expect(current.status).toBe("DELIVERED");
    expect(current.events.map((event) => event.status)).toEqual([
      "PAID_WAIT_PICK",
      "PICKING",
      "WAIT_DELIVERY",
      "DELIVERING",
      "DELIVERED",
    ]);
    expect(current.events.map((event) => event.role)).toContain("配送员");
    expect(current.events[current.events.length - 1].at).toBe("10:26:00");
  });

  it("非法迁移被拒并返回原因", () => {
    const { order } = placedOrder();
    let current = order;
    for (const [action, at] of [
      ["START_PICK", "10:00:30"],
      ["FINISH_PICK", "10:03:00"],
      ["ACCEPT_DELIVERY", "10:05:00"],
      ["CONFIRM_DELIVERED", "10:26:00"],
    ] as const) {
      const result = transition(current, action, at);
      if (!result.ok) throw new Error(result.reason);
      current = result.order;
    }
    expect(current.status).toBe("DELIVERED");

    const afterDelivered = transition(current, "START_PICK", "10:27:00");
    expect(afterDelivered.ok).toBe(false);

    const wrongAction = transition(order, "ACCEPT_DELIVERY", "10:05:00");
    expect(wrongAction.ok).toBe(false);
    if (!wrongAction.ok) expect(wrongAction.reason).toContain("已支付待拣货");
  });

  it("配送超过模拟时限标记超时", () => {
    const { order } = placedOrder();
    let current = order;
    for (const [action, at] of [
      ["START_PICK", "10:00:30"],
      ["FINISH_PICK", "10:03:00"],
      ["ACCEPT_DELIVERY", "10:05:00"],
    ] as const) {
      const result = transition(current, action, at);
      if (!result.ok) throw new Error(result.reason);
      current = result.order;
    }

    expect(current.status).toBe("DELIVERING");
    expect(isDeliveryTimeout(current, new Date(2026, 10, 27, 10, 10, 0))).toBe(false);
    expect(isDeliveryTimeout(current, new Date(2026, 10, 27, 10, 30, 0))).toBe(true);
    expect(isDeliveryTimeout(order, new Date(2026, 10, 27, 10, 30, 0))).toBe(false);
  });
});

describe("REQ-005 订单取消与库存释放", () => {
  it("待拣货订单取消成功且库存恢复", () => {
    const { order, warehouses: locked } = placedOrder();
    expect(stockOf(locked, "WH-SH-01", "SKU-AP01")).toBe(6);

    const cancelled = requestCancel(order, "10:01:00");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.order.status).toBe("CANCELLED");
    expect(cancelled.order.events[cancelled.order.events.length - 1].note).toContain("原路退款");

    const released = releaseStock(locked, cancelled.order.items);
    expect(stockOf(released, "WH-SH-01", "SKU-AP01")).toBe(8);
    expect(stockOf(released, "WH-SH-01", "SKU-MK01")).toBe(2);
  });

  it("拣货开始后取消被拒并返回明确原因", () => {
    const { order } = placedOrder();
    const picking = transition(order, "START_PICK", "10:00:30");
    if (!picking.ok) throw new Error(picking.reason);

    const rejected = requestCancel(picking.order, "10:01:00");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("拣货已开始，不允许取消");
  });

  it("已送达订单取消被拒", () => {
    const { order } = placedOrder();
    let current = order;
    for (const [action, at] of [
      ["START_PICK", "10:00:30"],
      ["FINISH_PICK", "10:03:00"],
      ["ACCEPT_DELIVERY", "10:05:00"],
      ["CONFIRM_DELIVERED", "10:26:00"],
    ] as const) {
      const result = transition(current, action, at);
      if (!result.ok) throw new Error(result.reason);
      current = result.order;
    }
    expect(current.status).toBe("DELIVERED");

    const rejected = requestCancel(current, "10:27:00");
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toContain("已送达");
  });
});
